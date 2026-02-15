import { getChatSession } from "./sessions"

export const resolveChatSessionId = async (input: {
  chatId: number
}) => {
  const existing = getChatSession(input.chatId)
  if (existing) return existing
  return undefined
}
