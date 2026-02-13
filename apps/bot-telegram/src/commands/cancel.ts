import { cancelRun } from "../api"
import { clearChatActiveRun, getChatActiveRun } from "../sessions"
import type { CommandModule } from "./types"

export const createCancelCommand = (): CommandModule => ({
  command: "cancel",
  description: "Cancel the active run",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("cancel", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const activeRunId = getChatActiveRun(chatId)
      if (!activeRunId) {
        await ctx.reply("No active run to cancel.")
        return
      }

      try {
        const run = await cancelRun(apiClient, { runId: activeRunId, reason: "user" })
        if (run.status === "canceled") {
          clearChatActiveRun(chatId)
          await ctx.reply(`Run canceled: ${activeRunId}`)
        } else {
          if (run.status === "failed" || run.status === "succeeded") {
            clearChatActiveRun(chatId)
          }
          await ctx.reply(`Run status: ${run.status}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to cancel run: ${message}`)
      }
    })
  },
})
