const chatSessions = new Map<number, string>()

export const setChatSession = (chatId: number, sessionId: string) => {
  chatSessions.set(chatId, sessionId)
}

export const getChatSession = (chatId: number) => chatSessions.get(chatId)
