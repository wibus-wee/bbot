import { createWorkspace, getWorkspace } from "../api"
import { createRequestId } from "../request-id"
import { resolveChatSessionId } from "../session-resolver"
import { setChatSession } from "../sessions"
import { shortId } from "./utils"
import type { CommandModule } from "./types"

type ForkCommandDeps = {
  apiClient: Parameters<typeof createWorkspace>[0]
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleForkCommand = async (ctx: any, deps: ForkCommandDeps) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const chatId = ctx.chat?.id
  const userId = ctx.from?.id
  if (!chatId || !userId) return

  const requestId = createRequestId()
  const currentSession = await resolveChatSessionId({
    apiClient: deps.apiClient,
    chatId,
    userId,
    requestId,
  })
  if (!currentSession) {
    await ctx.reply("No active session. Use /new or /resume first.")
    return
  }

  try {
    const baseWorkspace = await getWorkspace(deps.apiClient, currentSession, {
      requestId,
    })
    const nameBase = baseWorkspace.name ?? `fork-${currentSession}`
    const workspace = await createWorkspace(deps.apiClient, {
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
}

export const createForkCommand = (): CommandModule => ({
  command: "fork",
  description: "Deprecated. Use /session fork",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("fork", async (ctx) => {
      await handleForkCommand(ctx, { apiClient, ensureAllowed })
    })
  },
})
