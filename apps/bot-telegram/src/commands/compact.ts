import { compactWorkspace } from "../api"
import { createRequestId } from "../request-id"
import { resolveChatSessionId } from "../session-resolver"
import type { CommandModule } from "./types"

const parseKeepRecentTokens = (value?: string) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

type CompactCommandDeps = {
  apiClient: Parameters<typeof compactWorkspace>[0]
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleCompactCommand = async (
  ctx: any,
  deps: CompactCommandDeps,
  options: { keepRecentTokens?: string } = {},
) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const chatId = ctx.chat?.id
  const userId = ctx.from?.id
  if (!chatId || !userId) return

  const requestId = createRequestId()
  const sessionId = await resolveChatSessionId({ chatId })
  if (!sessionId) {
    await ctx.reply("No active session. Use /new or /resume first.")
    return
  }

  const hasTokenOverride = Object.prototype.hasOwnProperty.call(
    options,
    "keepRecentTokens",
  )
  const tokenSource = hasTokenOverride
    ? options.keepRecentTokens
    : ctx.match?.trim()
  const keepRecentTokens = parseKeepRecentTokens(tokenSource)

  try {
    await ctx.reply("Compacting session...")
    const result = await compactWorkspace(deps.apiClient, {
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
}

export const createCompactCommand = (): CommandModule => ({
  command: "compact",
  description: "Deprecated. Use /session compact",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("compact", async (ctx) => {
      await handleCompactCommand(ctx, { apiClient, ensureAllowed })
    })
  },
})
