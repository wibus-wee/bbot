import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { consola } from "consola"

import { resolveSessionStatePath } from "@bbot/shared"

const SESSION_STATE_PATH = resolveSessionStatePath()

export type ActiveRunState = {
  runId: string
  chatId: number
  sessionId: string
  startedAt: string
}

type SessionState = {
  version: 1
  updatedAt: string
  chatSessions: Record<string, string>
  activeRuns: Record<string, ActiveRunState>
}

type SessionStateSnapshot = {
  chatSessions: Array<{ chatId: number; sessionId: string }>
  activeRuns: ActiveRunState[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const defaultState = (): SessionState => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  chatSessions: {},
  activeRuns: {},
})

const parseChatSessions = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}
  const output: Record<string, string> = {}
  for (const [chatId, sessionId] of Object.entries(value)) {
    if (typeof sessionId === "string" && sessionId.trim()) {
      output[chatId] = sessionId
    }
  }
  return output
}

const parseActiveRuns = (value: unknown): Record<string, ActiveRunState> => {
  if (!isRecord(value)) return {}
  const output: Record<string, ActiveRunState> = {}
  for (const [runId, entry] of Object.entries(value)) {
    if (!runId || !isRecord(entry)) continue
    const chatId = entry.chatId
    const sessionId = entry.sessionId
    const startedAt = entry.startedAt
    if (typeof chatId !== "number" || !Number.isFinite(chatId)) continue
    if (typeof sessionId !== "string" || !sessionId.trim()) continue
    if (typeof startedAt !== "string" || !startedAt.trim()) continue
    output[runId] = { runId, chatId, sessionId, startedAt }
  }
  return output
}

const parseState = (value: unknown): SessionState => {
  if (!isRecord(value)) return defaultState()
  if (value.version !== 1) return defaultState()

  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim()
      ? value.updatedAt
      : new Date().toISOString()

  return {
    version: 1,
    updatedAt,
    chatSessions: parseChatSessions(value.chatSessions),
    activeRuns: parseActiveRuns(value.activeRuns),
  }
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error

let state: SessionState | null = null
let writeChain: Promise<void> = Promise.resolve()

const loadState = async (): Promise<SessionState> => {
  try {
    const raw = await readFile(SESSION_STATE_PATH, "utf8")
    return parseState(JSON.parse(raw))
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return defaultState()
    }
    consola.warn({ error }, "Failed to load session state")
    return defaultState()
  }
}

const ensureState = async () => {
  if (!state) {
    state = await loadState()
  }
  return state
}

const persistState = async () => {
  if (!state) return
  const snapshot: SessionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  }
  state = snapshot
  writeChain = writeChain
    .then(async () => {
      await mkdir(dirname(SESSION_STATE_PATH), { recursive: true })
      await writeFile(SESSION_STATE_PATH, JSON.stringify(snapshot), "utf8")
    })
    .catch((error) => {
      consola.warn({ error }, "Failed to persist session state")
    })
  await writeChain
}

export const initializeSessionState = async (): Promise<SessionStateSnapshot> => {
  state = await loadState()
  const chatSessions: Array<{ chatId: number; sessionId: string }> = []
  for (const [chatId, sessionId] of Object.entries(state.chatSessions)) {
    const numericId = Number(chatId)
    if (!Number.isFinite(numericId)) continue
    chatSessions.push({ chatId: numericId, sessionId })
  }
  const activeRuns = Object.values(state.activeRuns)
  return { chatSessions, activeRuns }
}

export const recordChatSession = async (chatId: number, sessionId: string) => {
  try {
    const current = await ensureState()
    current.chatSessions[String(chatId)] = sessionId
    await persistState()
  } catch (error) {
    consola.warn({ error }, "Failed to record chat session")
  }
}

export const clearChatSessionState = async (chatId: number) => {
  try {
    const current = await ensureState()
    delete current.chatSessions[String(chatId)]
    await persistState()
  } catch (error) {
    consola.warn({ error }, "Failed to clear chat session state")
  }
}

export const recordActiveRun = async (input: {
  runId: string
  chatId: number
  sessionId: string
  startedAt?: string
}) => {
  try {
    const current = await ensureState()
    current.activeRuns[input.runId] = {
      runId: input.runId,
      chatId: input.chatId,
      sessionId: input.sessionId,
      startedAt: input.startedAt ?? new Date().toISOString(),
    }
    await persistState()
  } catch (error) {
    consola.warn({ error }, "Failed to record active run")
  }
}

export const clearActiveRunsById = async (runIds: string[]) => {
  try {
    const current = await ensureState()
    for (const runId of runIds) {
      delete current.activeRuns[runId]
    }
    await persistState()
  } catch (error) {
    consola.warn({ error }, "Failed to clear active runs")
  }
}
