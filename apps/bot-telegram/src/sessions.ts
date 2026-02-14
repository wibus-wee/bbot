import {
  clearActiveRunsById,
  clearChatSessionState,
  recordChatSession,
} from "./session-state"

type ActiveRunState = {
  runId: string
  chatId: number
  reactionMessageId?: number
}

type QueuedRun = {
  chatId: number
  prompt: string
  requestId: string
  sessionId: string
  reactionMessageId?: number
}

const chatSessions = new Map<number, string>()
const sessionRuns = new Map<string, ActiveRunState>()
const sessionRunQueues = new Map<string, QueuedRun[]>()

export const setChatSession = (chatId: number, sessionId: string) => {
  chatSessions.set(chatId, sessionId)
  void recordChatSession(chatId, sessionId)
}

export const getChatSession = (chatId: number) => chatSessions.get(chatId)

export const clearChatSession = (chatId: number) => {
  chatSessions.delete(chatId)
  void clearChatSessionState(chatId)
}

export const hydrateChatSessions = (entries: Array<{ chatId: number; sessionId: string }>) => {
  chatSessions.clear()
  for (const entry of entries) {
    chatSessions.set(entry.chatId, entry.sessionId)
  }
}

export const setSessionActiveRun = (sessionId: string, state: ActiveRunState) => {
  sessionRuns.set(sessionId, state)
}

export const getSessionActiveRun = (sessionId: string) => sessionRuns.get(sessionId)

export const clearSessionActiveRun = (sessionId: string) => {
  const active = sessionRuns.get(sessionId)
  sessionRuns.delete(sessionId)
  if (active) {
    void clearActiveRunsById([active.runId])
  }
}

export const enqueueSessionRun = (sessionId: string, run: QueuedRun) => {
  const queue = sessionRunQueues.get(sessionId) ?? []
  queue.push(run)
  sessionRunQueues.set(sessionId, queue)
  return queue.length
}

export const dequeueSessionRun = (sessionId: string) => {
  const queue = sessionRunQueues.get(sessionId)
  if (!queue || queue.length === 0) return null
  const next = queue.shift() ?? null
  if (!next) return null
  if (queue.length === 0) {
    sessionRunQueues.delete(sessionId)
  } else {
    sessionRunQueues.set(sessionId, queue)
  }
  return next
}

export const clearSessionRunQueue = (sessionId: string) => {
  sessionRunQueues.delete(sessionId)
}

export const getSessionRunQueueSize = (sessionId: string) => {
  const queue = sessionRunQueues.get(sessionId)
  return queue?.length ?? 0
}
