import type { CommandModule } from "./types"
import { clearRestartReport, writeRestartReport } from "../restart-report"

export const createRestartCommand = (): CommandModule => ({
  command: "restart",
  description: "Restart local services",
  register: ({ bot, ensureAllowed }) => {
    bot.command("restart", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      let reportWarning: string | null = null
      try {
        await writeRestartReport({ chatId })
      } catch (error) {
        reportWarning = error instanceof Error ? error.message : String(error)
      }

      const replyLines = ["Restart requested. Triggering SIGUSR1..."]
      if (reportWarning) {
        replyLines.push(`Warning: failed to persist restart report: ${reportWarning}`)
      }
      await ctx.reply(replyLines.join("\n"))
      try {
        process.kill(process.pid, "SIGUSR1")
      } catch (error) {
        await clearRestartReport()
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to trigger restart: ${message}`)
      }
    })
  },
})
