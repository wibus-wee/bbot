const chatSessions = new Map<number, string>()
const chatRuns = new Map<number, string>()

export const setChatSession = (chatId: number, sessionId: string) => {
  chatSessions.set(chatId, sessionId)
}

export const getChatSession = (chatId: number) => chatSessions.get(chatId)

export const clearChatSession = (chatId: number) => {
  chatSessions.delete(chatId)
}

export const setChatActiveRun = (chatId: number, runId: string) => {
  chatRuns.set(chatId, runId)
}

export const getChatActiveRun = (chatId: number) => chatRuns.get(chatId)

export const clearChatActiveRun = (chatId: number) => {
  chatRuns.delete(chatId)
}
