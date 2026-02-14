import { createWorkspace, getWorkspace } from "../api"
import { createRequestId } from "../request-id"
import { getChatSession, setChatSession } from "../sessions"
import { shortId } from "./utils"
import type { CommandModule } from "./types"

export const createForkCommand = (): CommandModule => ({
  command: "fork",
  description: "Fork the current workspace session",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("fork", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      const userId = ctx.from?.id
      if (!chatId || !userId) return

      const currentSession = getChatSession(chatId)
      if (!currentSession) {
        await ctx.reply("No active session. Use /new or /resume first.")
        return
      }

      try {
        const requestId = createRequestId()
        const baseWorkspace = await getWorkspace(apiClient, currentSession, {
          requestId,
        })
        const nameBase = baseWorkspace.name ?? `fork-${currentSession}`
        const workspace = await createWorkspace(apiClient, {
          chatId,
          userId,
          name: `${nameBase}-fork-${shortId()}`.slice(0, 200),
          forkedFromSessionId: currentSession,
          requestId,
        })
        setChatSession(chatId, workspace.id)
        await ctx.reply(`Workspace forked: ${workspace.id}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to fork workspace: ${message}`)
      }
    })
  },
})
