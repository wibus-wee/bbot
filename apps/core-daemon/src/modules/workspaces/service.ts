import { and, desc, eq, ne, sql } from "drizzle-orm"

import {
  buildContextMessages,
  compactMessages,
  estimateContextTokens,
  type AgentRuntimeConfig,
} from "@bbot/agent"
import { schema } from "@bbot/database"
import type { Database } from "@bbot/database"
import { getModel, KnownProvider } from "@mariozechner/pi-ai"

import { resolveAgentRuntimeConfig } from "../agent-providers/runtime"
import { getProviderStore, type StoredAgentProvider } from "../agent-providers/service"
import { mergeAgentSettings, normalizeAgentSettings } from "../agent-settings/merge"
import { getGlobalAgentSettings } from "../agent-settings/service"

import type { AgentSettings, CreateWorkspaceBody } from "@bbot/protocol"
import {
  createSessionEntry,
  getLatestSessionSummary,
  listSessionEntries,
} from "../runs/service"
import { buildSearchTextFromMessage, buildUserPromptMessage } from "../runs/session-log"
import path from "path"

const { workspaceSessions, runs, runEvents, sessionEntries } = schema

export const listWorkspaces = async (db: Database) => {
  return db
    .select()
    .from(workspaceSessions)
    .orderBy(desc(workspaceSessions.accessedAt), desc(workspaceSessions.createdAt))
}

export const getWorkspace = async (db: Database, id: string) => {
  const [workspace] = await db
    .select()
    .from(workspaceSessions)
    .where(eq(workspaceSessions.id, id))
    .limit(1)

  return workspace ?? null
}

export const getWorkspaceAgentSettings = async (db: Database, sessionId: string) => {
  const [workspace] = await db
    .select({
      agentSettings: workspaceSessions.agentSettings,
      updatedAt: workspaceSessions.updatedAt,
    })
    .from(workspaceSessions)
    .where(eq(workspaceSessions.id, sessionId))
    .limit(1)

  if (!workspace) {
    return null
  }

  const sessionSettings = normalizeAgentSettings(
    workspace.agentSettings ?? {},
    "workspace_sessions.agent_settings",
  )
  const globalSettings = await getGlobalAgentSettings(db)
  const effectiveSettings = mergeAgentSettings(globalSettings, sessionSettings)

  return {
    sessionId,
    sessionSettings,
    globalSettings,
    effectiveSettings,
    updatedAt: workspace.updatedAt?.toISOString(),
  }
}

export const updateWorkspaceAgentSettings = async (
  db: Database,
  sessionId: string,
  settings: AgentSettings,
) => {
  const normalized = normalizeAgentSettings(
    settings ?? {},
    "workspace_sessions.agent_settings",
  )
  const now = new Date()
  const [workspace] = await db
    .update(workspaceSessions)
    .set({ agentSettings: normalized, updatedAt: now })
    .where(eq(workspaceSessions.id, sessionId))
    .returning({ updatedAt: workspaceSessions.updatedAt })

  if (!workspace) {
    return null
  }

  const globalSettings = await getGlobalAgentSettings(db)
  const effectiveSettings = mergeAgentSettings(globalSettings, normalized)

  return {
    sessionId,
    sessionSettings: normalized,
    globalSettings,
    effectiveSettings,
    updatedAt: workspace.updatedAt?.toISOString(),
  }
}

export const archiveWorkspace = async (db: Database, id: string) => {
  const now = new Date()
  const [workspace] = await db
    .update(workspaceSessions)
    .set({ status: "archived", accessedAt: now, updatedAt: now })
    .where(eq(workspaceSessions.id, id))
    .returning()

  return workspace ?? null
}

export const createWorkspace = async (db: Database, input: CreateWorkspaceBody) => {
  const rootPath = input.rootPath
    ? path.resolve(input.rootPath)
    : path.resolve(process.cwd(), "..", "..")
  const [workspace] = await db
    .insert(workspaceSessions)
    .values({
      name: input.name,
      rootPath,
      telegramChatId: input.telegramChatId,
      telegramUserId: input.telegramUserId,
      forkedFromSessionId: input.forkedFromSessionId,
      metadata: input.metadata,
    })
    .returning()

  return workspace ?? null
}

export const createWorkspaceRun = async (
  db: Database,
  workspaceId: string,
  prompt: string,
) => {
  const now = new Date()
  const [existingMessage] = await db
    .select({ id: sessionEntries.id })
    .from(sessionEntries)
    .where(
      and(
        eq(sessionEntries.sessionId, workspaceId),
        eq(sessionEntries.kind, "message"),
      ),
    )
    .limit(1)
  const isFirstMessage = !existingMessage
  const threadName = isFirstMessage
    ? prompt.replace(/\s+/g, " ").trim().slice(0, 200)
    : undefined
  const [run] = await db
    .insert(runs)
    .values({
      sessionId: workspaceId,
      prompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!run) {
    return null
  }

  const [queuedCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(
      and(
        eq(runs.sessionId, workspaceId),
        eq(runs.status, "queued"),
        ne(runs.id, run.id),
      ),
    )

  const [runningCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(
      and(
        eq(runs.sessionId, workspaceId),
        eq(runs.status, "running"),
        ne(runs.id, run.id),
      ),
    )

  const queuedAhead = Number(queuedCountRow?.count ?? 0)
  const runningCount = Number(runningCountRow?.count ?? 0)
  const isBusy = queuedAhead + runningCount > 0
  const queuedMessage = isBusy
    ? "Session is busy. This run is queued and will start automatically."
    : "Run queued"
  const queuedPayload = isBusy ? { reason: "session_busy", position: queuedAhead + 1 } : undefined

  await db.insert(runEvents).values({
    runId: run.id,
    type: "run.queued",
    message: queuedMessage,
    payload: queuedPayload,
  })

  const userMessage = buildUserPromptMessage(prompt)
  await db.insert(sessionEntries).values({
    sessionId: workspaceId,
    runId: run.id,
    kind: "message",
    payload: userMessage,
    searchText: buildSearchTextFromMessage(userMessage),
    timestamp: now,
  })

  await db
    .update(workspaceSessions)
    .set({ accessedAt: now, updatedAt: now })
    .where(eq(workspaceSessions.id, workspaceId))

  if (threadName) {
    await db
      .update(workspaceSessions)
      .set({ name: threadName, updatedAt: now })
      .where(
        and(
          eq(workspaceSessions.id, workspaceId),
          sql`${workspaceSessions.name} LIKE ${"telegram-%"}`,
        ),
      )
  }

  return run
}

export const searchWorkspaces = async (
  db: Database,
  input: {
    chatId: string
    userId?: string
    query?: string
    status?: typeof workspaceSessions.$inferSelect.status
    limit?: number
    offset?: number
  },
) => {
  const conditions = [eq(workspaceSessions.telegramChatId, input.chatId)]
  if (input.userId) {
    conditions.push(eq(workspaceSessions.telegramUserId, input.userId))
  }
  if (input.status) {
    conditions.push(eq(workspaceSessions.status, input.status))
  }
  const keyword = input.query?.trim()
  if (keyword) {
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM ${sessionEntries}
        WHERE ${sessionEntries.sessionId} = ${workspaceSessions.id}
          AND ${sessionEntries.kind} = 'message'
          AND ${sessionEntries.searchText} ILIKE ${`%${keyword}%`}
      )`,
    )
  }
  const where =
    conditions.length > 1 ? and(...conditions) : conditions[0]
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50))
  const offset = Math.max(0, input.offset ?? 0)

  const rows = await db
    .select()
    .from(workspaceSessions)
    .where(where)
    .orderBy(desc(workspaceSessions.accessedAt), desc(workspaceSessions.createdAt))
    .limit(limit)
    .offset(offset)

  return rows
}

type CompactWorkspaceInput = {
  sessionId: string
  keepRecentTokens?: number
  customInstructions?: string
}

type CompactWorkspaceResult = {
  didCompact: boolean
  summary?: string
}

type UsageTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

const EMPTY_USAGE_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const extractUsageFromPayload = (payload: unknown): UsageTotals | null => {
  if (!isRecord(payload)) return null
  if (payload.role !== "assistant") return null
  const usage = isRecord(payload.usage) ? payload.usage : null
  if (!usage) return null
  const cost = isRecord(usage.cost) ? usage.cost : {}

  return {
    inputTokens: toNumber(usage.input),
    outputTokens: toNumber(usage.output),
    cacheReadTokens: toNumber(usage.cacheRead),
    cacheWriteTokens: toNumber(usage.cacheWrite),
    totalTokens: toNumber(usage.totalTokens),
    cost: {
      input: toNumber(cost.input),
      output: toNumber(cost.output),
      cacheRead: toNumber(cost.cacheRead),
      cacheWrite: toNumber(cost.cacheWrite),
      total: toNumber(cost.total),
    },
  }
}

const mergeUsageTotals = (target: UsageTotals, next: UsageTotals) => {
  target.inputTokens += next.inputTokens
  target.outputTokens += next.outputTokens
  target.cacheReadTokens += next.cacheReadTokens
  target.cacheWriteTokens += next.cacheWriteTokens
  target.totalTokens += next.totalTokens
  target.cost.input += next.cost.input
  target.cost.output += next.cost.output
  target.cost.cacheRead += next.cost.cacheRead
  target.cost.cacheWrite += next.cost.cacheWrite
  target.cost.total += next.cost.total
  return target
}

const resolveActiveProvider = (
  providers: StoredAgentProvider[],
  activeProviderId?: string,
) => {
  if (activeProviderId) {
    return providers.find((item) => item.id === activeProviderId) ?? null
  }
  if (providers.length === 1) {
    return providers[0] ?? null
  }
  return null
}

const resolveActiveModelInfo = async (db: Database) => {
  const store = await getProviderStore(db)
  const activeProvider = resolveActiveProvider(store.providers, store.activeProviderId)
  if (!activeProvider) return null

  // @ts-expect-error - Provider list might include custom entries.
  const baseModel = getModel(activeProvider.provider as KnownProvider, activeProvider.model)
  return {
    provider: activeProvider.provider,
    model: activeProvider.model,
    contextWindow: baseModel?.contextWindow,
  }
}

const resolveCompactionModel = (
  config: Pick<AgentRuntimeConfig, "provider" | "model" | "baseUrl" | "headers">,
) => {
  // @ts-expect-error - Runtime config can point to any provider/model combination.
  const baseModel = getModel(config.provider as KnownProvider, config.model)
  if (!baseModel) {
    throw new Error(
      `Unknown model ${config.model} for provider ${config.provider}`,
    )
  }
  return {
    ...baseModel,
    baseUrl: config.baseUrl ?? baseModel.baseUrl,
    headers: config.headers ?? baseModel.headers,
  }
}

const runManualCompaction = async (input: {
  messages: Parameters<typeof compactMessages>[0]["messages"]
  model: Parameters<typeof compactMessages>[0]["model"]
  settings: Parameters<typeof compactMessages>[0]["settings"]
  customInstructions?: string
  apiKey?: string
}) => {
  const { messages, model, settings, customInstructions, apiKey } = input
  const initial = await compactMessages({
    messages,
    model,
    settings,
    customInstructions,
    apiKey,
    force: true,
  })

  if (initial.didCompact) {
    return initial
  }

  return compactMessages({
    messages,
    model,
    settings: { ...settings, keepRecentTokens: 0 },
    customInstructions,
    apiKey,
    force: true,
  })
}

export const compactWorkspaceSession = async (
  db: Database,
  input: CompactWorkspaceInput,
): Promise<CompactWorkspaceResult> => {
  const config = await resolveAgentRuntimeConfig(db, { sessionId: input.sessionId })
  const model = resolveCompactionModel(config)
  const summaryEntry = await getLatestSessionSummary(db, input.sessionId)
  const afterSequence =
    summaryEntry && typeof summaryEntry.sequence === "number"
      ? summaryEntry.sequence
      : undefined
  const messageEntries = await listSessionEntries(db, {
    sessionId: input.sessionId,
    kinds: ["message"],
    afterSequence,
  })

  if (messageEntries.length === 0) {
    return { didCompact: false }
  }

  const contextEntries = summaryEntry ? [summaryEntry, ...messageEntries] : messageEntries
  const contextMessages = buildContextMessages(contextEntries)

  if (contextMessages.length === 0) {
    return { didCompact: false }
  }

  const settings = {
    ...config.compaction,
    keepRecentTokens: input.keepRecentTokens ?? config.compaction.keepRecentTokens,
  }

  const result = await runManualCompaction({
    messages: contextMessages,
    model,
    settings,
    customInstructions: input.customInstructions,
    apiKey: config.apiKey,
  })

  if (!result.didCompact || !result.summary) {
    return { didCompact: false }
  }

  await createSessionEntry(db, {
    sessionId: input.sessionId,
    kind: "summary",
    payload: { summary: result.summary },
    timestamp: new Date(),
  })

  return { didCompact: true, summary: result.summary }
}

export const getWorkspaceUsage = async (db: Database, sessionId: string) => {
  const workspace = await getWorkspace(db, sessionId)
  if (!workspace) return null

  const summaryEntry = await getLatestSessionSummary(db, sessionId)
  const afterSequence =
    summaryEntry && typeof summaryEntry.sequence === "number"
      ? summaryEntry.sequence
      : undefined
  const messageEntries = await listSessionEntries(db, {
    sessionId,
    kinds: ["message"],
    afterSequence,
  })

  const contextEntries = summaryEntry ? [summaryEntry, ...messageEntries] : messageEntries
  const contextMessages = buildContextMessages(contextEntries)
  const estimatedTokens = estimateContextTokens(contextMessages)

  const usageTotals = messageEntries
    .map((entry) => extractUsageFromPayload(entry.payload))
    .filter((entry): entry is UsageTotals => Boolean(entry))
    .reduce(mergeUsageTotals, {
      ...EMPTY_USAGE_TOTALS,
      cost: { ...EMPTY_USAGE_TOTALS.cost },
    })

  const modelInfo = await resolveActiveModelInfo(db)

  return {
    sessionId,
    model: modelInfo ?? undefined,
    context: {
      estimatedTokens,
      window: modelInfo?.contextWindow,
    },
    usage: usageTotals,
  }
}
