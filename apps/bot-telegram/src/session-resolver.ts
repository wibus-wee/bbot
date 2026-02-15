import type { ApiClient } from "./api"
import { getLatestWorkspaceForChat } from "./api"
import { getChatSession, setChatSession } from "./sessions"

export const resolveChatSessionId = async (input: {
  apiClient: ApiClient
  chatId: number
  userId: number
  requestId?: string
}) => {
  const existing = getChatSession(input.chatId)
  if (existing) return existing

  const workspace = await getLatestWorkspaceForChat(input.apiClient, {
    chatId: input.chatId,
    userId: input.userId,
    requestId: input.requestId,
  })

  if (!workspace) return undefined

  setChatSession(input.chatId, workspace.id)
  return workspace.id
}
