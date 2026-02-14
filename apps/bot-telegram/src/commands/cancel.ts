import { cancelRun } from "../api"
import { createRequestId } from "../request-id"
import { getChatActiveRun } from "../sessions"
import type { CommandModule } from "./types"

export const createCancelCommand = (): CommandModule => ({
  command: "cancel",
  description: "Cancel the active run",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("cancel", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const activeRun = getChatActiveRun(chatId)
      if (!activeRun) {
        await ctx.reply("No active run to cancel.")
        return
      }

      try {
        const requestId = createRequestId()
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
