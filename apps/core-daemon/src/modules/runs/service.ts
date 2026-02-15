import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"

import { schema } from "@bbot/database"
import { AUTO_RESUME_PROMPT } from "@bbot/shared"
import type { Database } from "@bbot/database"
import type { CreateRunEventBody } from "@bbot/protocol"

const { runs, runEvents, toolExecutions, sessionEntries, workspaceSessions } = schema

type RunUpdateInput = Partial<
  Pick<
    typeof runs.$inferInsert,
    "status" | "summary" | "error" | "startedAt" | "finishedAt" | "updatedAt"
  >
>

type CreateToolExecutionInput = {
  runId: string
  tool: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  status: "succeeded" | "failed"
  error?: string
  startedAt?: Date
  endedAt?: Date
}

type CreateSessionEntryInput = {
  sessionId: string
  runId?: string
  kind: "message" | "action" | "result" | "summary" | "system"
  payload: unknown
  searchText?: string
  timestamp?: Date
}

type ListSessionEntriesInput = {
  sessionId: string
  kinds?: Array<"message" | "action" | "result" | "summary" | "system">
  excludeRunId?: string
  afterSequence?: number
  limit?: number
}

type ListRunEntriesInput = {
  runId: string
  kinds?: Array<"message" | "action" | "result" | "summary" | "system">
  afterSequence?: number
  limit?: number
}

type ListRunsInput = {
  status?: typeof runs.$inferSelect.status
  sessionId?: string
  limit?: number
  offset?: number
}

type ListRunEventsSinceInput = {
  runId?: string
  sessionId?: string
  afterTimestamp?: Date
  beforeTimestamp?: Date
  order?: "asc" | "desc"
  limit?: number
}

type ListToolExecutionsSinceInput = {
  runId?: string
  sessionId?: string
  afterTimestamp?: Date
  beforeTimestamp?: Date
  order?: "asc" | "desc"
  limit?: number
}

type ListSessionEntriesSinceInput = {
  runId?: string
  sessionId?: string
  afterTimestamp?: Date
  beforeTimestamp?: Date
  order?: "asc" | "desc"
  limit?: number
}

export const getRun = async (db: Database, id: string) => {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1)

  return run ?? null
}

export const listRunEvents = async (db: Database, runId: string) => {
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.timestamp), asc(runEvents.id))
}

export const listRunEventsSince = async (
  db: Database,
  input: ListRunEventsSinceInput,
) => {
  const conditions = []
  if (input.runId) {
    conditions.push(eq(runEvents.runId, input.runId))
  }
  if (input.sessionId) {
    conditions.push(eq(runs.sessionId, input.sessionId))
  }
  if (input.afterTimestamp) {
    conditions.push(gte(runEvents.timestamp, input.afterTimestamp))
  }
  if (input.beforeTimestamp) {
    conditions.push(lte(runEvents.timestamp, input.beforeTimestamp))
  }

  const order = input.order ?? "asc"
  const ordering =
    order === "asc"
      ? [asc(runEvents.timestamp), asc(runEvents.id)]
      : [desc(runEvents.timestamp), desc(runEvents.id)]

  const baseQuery = db
    .select({
      id: runEvents.id,
      runId: runEvents.runId,
      type: runEvents.type,
      message: runEvents.message,
      payload: runEvents.payload,
      timestamp: runEvents.timestamp,
      sessionId: runs.sessionId,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .orderBy(...ordering)

  if (conditions.length > 0) {
    const filtered = baseQuery.where(and(...conditions))
    if (input.limit && input.limit > 0) {
      return filtered.limit(input.limit)
    }
    return filtered
  }

  if (input.limit && input.limit > 0) {
    return baseQuery.limit(input.limit)
  }

  return baseQuery
}

export const createRunEvent = async (
  db: Database,
  runId: string,
  input: CreateRunEventBody,
) => {
  const [event] = await db
    .insert(runEvents)
    .values({
      runId,
      type: input.type,
      message: input.message,
      payload: input.payload,
    })
    .returning()

  return event ?? null
}

export const updateRun = async (db: Database, runId: string, input: RunUpdateInput) => {
  const values = {
    ...input,
    updatedAt: input.updatedAt ?? new Date(),
  }
  const [run] = await db
    .update(runs)
    .set(values)
    .where(eq(runs.id, runId))
    .returning()

  return run ?? null
}

export const updateRunStatusIf = async (
  db: Database,
  runId: string,
  statuses: Array<typeof runs.$inferSelect.status>,
  input: RunUpdateInput,
) => {
  const values = {
    ...input,
    updatedAt: input.updatedAt ?? new Date(),
  }

  const [run] = await db
    .update(runs)
    .set(values)
    .where(and(eq(runs.id, runId), inArray(runs.status, statuses)))
    .returning()

  return run ?? null
}

export const createToolExecution = async (db: Database, input: CreateToolExecutionInput) => {
  const [execution] = await db
    .insert(toolExecutions)
    .values({
      runId: input.runId,
      tool: input.tool,
      input: input.input,
      output: input.output,
      status: input.status,
      error: input.error,
      startedAt: input.startedAt ?? new Date(),
      endedAt: input.endedAt,
    })
    .returning()

  return execution ?? null
}

export const listToolExecutions = async (db: Database, runId: string) => {
  return db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.runId, runId))
    .orderBy(asc(toolExecutions.startedAt))
}

export const listToolExecutionsSince = async (
  db: Database,
  input: ListToolExecutionsSinceInput,
) => {
  const conditions = []
  if (input.runId) {
    conditions.push(eq(toolExecutions.runId, input.runId))
  }
  if (input.sessionId) {
    conditions.push(eq(runs.sessionId, input.sessionId))
  }

  const toolTimestamp = sql<Date>`coalesce(${toolExecutions.endedAt}, ${toolExecutions.startedAt})`
  if (input.afterTimestamp) {
    conditions.push(gte(toolTimestamp, input.afterTimestamp))
  }
  if (input.beforeTimestamp) {
    conditions.push(lte(toolTimestamp, input.beforeTimestamp))
  }

  const order = input.order ?? "asc"
  const ordering =
    order === "asc"
      ? [asc(toolTimestamp), asc(toolExecutions.id)]
      : [desc(toolTimestamp), desc(toolExecutions.id)]

  const baseQuery = db
    .select({
      id: toolExecutions.id,
      runId: toolExecutions.runId,
      tool: toolExecutions.tool,
      input: toolExecutions.input,
      output: toolExecutions.output,
      status: toolExecutions.status,
      error: toolExecutions.error,
      startedAt: toolExecutions.startedAt,
      endedAt: toolExecutions.endedAt,
      sessionId: runs.sessionId,
    })
    .from(toolExecutions)
    .innerJoin(runs, eq(toolExecutions.runId, runs.id))
    .orderBy(...ordering)

  if (conditions.length > 0) {
    const filtered = baseQuery.where(and(...conditions))
    if (input.limit && input.limit > 0) {
      return filtered.limit(input.limit)
    }
    return filtered
  }

  if (input.limit && input.limit > 0) {
    return baseQuery.limit(input.limit)
  }

  return baseQuery
}

export const createSessionEntry = async (db: Database, input: CreateSessionEntryInput) => {
  const [entry] = await db
    .insert(sessionEntries)
    .values({
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.kind,
      payload: input.payload,
      searchText: input.searchText,
      timestamp: input.timestamp ?? new Date(),
    })
    .returning()

  return entry ?? null
}

export const getLatestSessionSummary = async (
  db: Database,
  sessionId: string,
  excludeRunId?: string,
) => {
  const conditions = [eq(sessionEntries.sessionId, sessionId), eq(sessionEntries.kind, "summary")]
  if (excludeRunId) {
    const excludeCondition = or(
      isNull(sessionEntries.runId),
      ne(sessionEntries.runId, excludeRunId),
    )
    if (excludeCondition) conditions.push(excludeCondition)
  }

  const [entry] = await db
    .select()
    .from(sessionEntries)
    .where(and(...conditions))
    .orderBy(desc(sessionEntries.sequence))
    .limit(1)

  return entry ?? null
}

export const listSessionEntries = async (db: Database, input: ListSessionEntriesInput) => {
  const conditions = [eq(sessionEntries.sessionId, input.sessionId)]

  if (input.kinds && input.kinds.length > 0) {
    conditions.push(inArray(sessionEntries.kind, input.kinds))
  }

  if (input.excludeRunId) {
    const excludeCondition = or(
      isNull(sessionEntries.runId),
      ne(sessionEntries.runId, input.excludeRunId),
    )
    if (excludeCondition) conditions.push(excludeCondition)
  }

  if (typeof input.afterSequence === "number") {
    conditions.push(gt(sessionEntries.sequence, input.afterSequence))
  }

  const baseQuery = db
    .select()
    .from(sessionEntries)
    .where(and(...conditions))
    .orderBy(asc(sessionEntries.sequence))

  if (input.limit && input.limit > 0) {
    return baseQuery.limit(input.limit)
  }

  return baseQuery
}

export const listRunSessionEntries = async (db: Database, input: ListRunEntriesInput) => {
  const conditions = [eq(sessionEntries.runId, input.runId)]

  if (input.kinds && input.kinds.length > 0) {
    conditions.push(inArray(sessionEntries.kind, input.kinds))
  }

  if (typeof input.afterSequence === "number") {
    conditions.push(gt(sessionEntries.sequence, input.afterSequence))
  }

  const baseQuery = db
    .select()
    .from(sessionEntries)
    .where(and(...conditions))
    .orderBy(asc(sessionEntries.sequence))

  if (input.limit && input.limit > 0) {
    return baseQuery.limit(input.limit)
  }

  return baseQuery
}

export const listSessionEntriesSince = async (
  db: Database,
  input: ListSessionEntriesSinceInput,
) => {
  const conditions = [isNotNull(sessionEntries.runId)]
  if (input.runId) {
    conditions.push(eq(sessionEntries.runId, input.runId))
  }
  if (input.sessionId) {
    conditions.push(eq(sessionEntries.sessionId, input.sessionId))
  }
  if (input.afterTimestamp) {
    conditions.push(gte(sessionEntries.timestamp, input.afterTimestamp))
  }
  if (input.beforeTimestamp) {
    conditions.push(lte(sessionEntries.timestamp, input.beforeTimestamp))
  }

  const order = input.order ?? "asc"
  const ordering =
    order === "asc"
      ? [asc(sessionEntries.timestamp), asc(sessionEntries.id)]
      : [desc(sessionEntries.timestamp), desc(sessionEntries.id)]

  const baseQuery = db
    .select()
    .from(sessionEntries)
    .where(and(...conditions))
    .orderBy(...ordering)

  if (input.limit && input.limit > 0) {
    return baseQuery.limit(input.limit)
  }

  return baseQuery
}

export const listRuns = async (db: Database, input: ListRunsInput) => {
  const conditions = []
  if (input.status) {
    conditions.push(eq(runs.status, input.status))
  }
  if (input.sessionId) {
    conditions.push(eq(runs.sessionId, input.sessionId))
  }

  const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
  const offset = Math.max(0, input.offset ?? 0)
  const baseQuery = db.select().from(runs).orderBy(desc(runs.createdAt))
  if (conditions.length > 0) {
    return baseQuery.where(and(...conditions)).limit(limit).offset(offset)
  }

  return baseQuery.limit(limit).offset(offset)
}

export const listRunsBySessionStatus = async (
  db: Database,
  input: { sessionId: string; statuses: Array<typeof runs.$inferSelect.status> },
) => {
  return db
    .select()
    .from(runs)
    .where(
      and(eq(runs.sessionId, input.sessionId), inArray(runs.status, input.statuses)),
    )
    .orderBy(asc(runs.createdAt))
}

export const listRunsByStatus = async (
  db: Database,
  statuses: Array<typeof runs.$inferSelect.status>,
) => {
  return db
    .select({ id: runs.id, sessionId: runs.sessionId, status: runs.status })
    .from(runs)
    .where(inArray(runs.status, statuses))
    .orderBy(asc(runs.createdAt))
}

export const listAutoResumeRuns = async (db: Database) => {
  return db
    .select({
      runId: runs.id,
      sessionId: runs.sessionId,
      status: runs.status,
      prompt: runs.prompt,
      createdAt: runs.createdAt,
      telegramChatId: workspaceSessions.telegramChatId,
    })
    .from(runs)
    .innerJoin(workspaceSessions, eq(runs.sessionId, workspaceSessions.id))
    .where(
      and(
        inArray(runs.status, ["queued", "running"]),
        eq(runs.prompt, AUTO_RESUME_PROMPT),
      ),
    )
    .orderBy(asc(runs.createdAt))
}
