type ActiveRunState = {
  runId: string
  reactionMessageId?: number
}

type QueuedRun = {
  prompt: string
  requestId: string
  sessionId: string
  reactionMessageId?: number
}

const chatSessions = new Map<number, string>()
const chatRuns = new Map<number, ActiveRunState>()
const chatRunQueues = new Map<number, QueuedRun[]>()

export const setChatSession = (chatId: number, sessionId: string) => {
  chatSessions.set(chatId, sessionId)
}

export const getChatSession = (chatId: number) => chatSessions.get(chatId)

export const clearChatSession = (chatId: number) => {
  chatSessions.delete(chatId)
}

export const setChatActiveRun = (chatId: number, state: ActiveRunState) => {
  chatRuns.set(chatId, state)
}

export const getChatActiveRun = (chatId: number) => chatRuns.get(chatId)

export const clearChatActiveRun = (chatId: number) => {
  chatRuns.delete(chatId)
}

export const enqueueChatRun = (chatId: number, run: QueuedRun) => {
  const queue = chatRunQueues.get(chatId) ?? []
  queue.push(run)
  chatRunQueues.set(chatId, queue)
  return queue.length
}

export const dequeueChatRun = (chatId: number) => {
  const queue = chatRunQueues.get(chatId)
  if (!queue || queue.length === 0) return null
  const next = queue.shift() ?? null
  if (!next) return null
  if (queue.length === 0) {
    chatRunQueues.delete(chatId)
  } else {
    chatRunQueues.set(chatId, queue)
  }
  return next
}

export const clearChatRunQueue = (chatId: number) => {
  chatRunQueues.delete(chatId)
}

export const getChatRunQueueSize = (chatId: number) => {
  const queue = chatRunQueues.get(chatId)
  return queue?.length ?? 0
}
