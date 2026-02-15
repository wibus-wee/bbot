import { cancelRun } from "../api"
import { createRequestId } from "../request-id"
import { resolveChatSessionId } from "../session-resolver"
import { getSessionActiveRun } from "../sessions"
import type { CommandModule } from "./types"

export const createCancelCommand = (): CommandModule => ({
  command: "cancel",
  description: "Cancel the active run",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("cancel", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      const userId = ctx.from?.id
      if (!chatId || !userId) return

      const requestId = createRequestId()
      const sessionId = await resolveChatSessionId({
        apiClient,
        chatId,
        userId,
        requestId,
      })
      if (!sessionId) {
        await ctx.reply("No active session.")
        return
      }

      const activeRun = getSessionActiveRun(sessionId)
      if (!activeRun) {
        await ctx.reply("No active run to cancel.")
        return
      }

      try {
        const run = await cancelRun(apiClient, {
          runId: activeRun.runId,
          reason: "user",
          requestId,
        })
        if (run.status === "canceled") {
          await ctx.reply("Run canceled.")
        } else {
          await ctx.reply(`Run status: ${run.status}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to cancel run: ${message}`)
      }
    })
  },
})
