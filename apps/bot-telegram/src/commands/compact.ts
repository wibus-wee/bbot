import { compactWorkspace } from "../api"
import { createRequestId } from "../request-id"
import { getChatSession } from "../sessions"
import type { CommandModule } from "./types"

const parseKeepRecentTokens = (value?: string) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

export const createCompactCommand = (): CommandModule => ({
  command: "compact",
  description: "Compact the current workspace session",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("compact", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const sessionId = getChatSession(chatId)
      if (!sessionId) {
        await ctx.reply("No active session. Use /new or /resume first.")
        return
      }

      const keepRecentTokens = parseKeepRecentTokens(ctx.match?.trim())

      try {
        const requestId = createRequestId()
        await ctx.reply("Compacting session...")
        const result = await compactWorkspace(apiClient, {
          sessionId,
          keepRecentTokens,
          requestId,
        })
        const length = result.summary.length
        await ctx.reply(
          `Compaction stored for ${sessionId} (summary length: ${length}).`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to compact session: ${message}`)
      }
    })
  },
})
