import { createWorkspace } from "../api"
import { createRequestId } from "../request-id"
import { setChatSession } from "../sessions"
import { formatSessionName } from "./utils"
import type { CommandModule } from "./types"

type NewCommandDeps = {
  apiClient: Parameters<typeof createWorkspace>[0]
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleNewCommand = async (ctx: any, deps: NewCommandDeps) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const chatId = ctx.chat?.id
  const userId = ctx.from?.id
  if (!chatId || !userId) return

  try {
    const requestId = createRequestId()
    const workspace = await createWorkspace(deps.apiClient, {
      chatId,
      userId,
      name: formatSessionName(chatId),
      requestId,
    })
    setChatSession(chatId, workspace.id)
    await ctx.reply(`Workspace created: ${workspace.id}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.reply(`Failed to create workspace: ${message}`)
  }
}

export const createNewCommand = (): CommandModule => ({
  command: "new",
  description: "Create a new workspace session",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("new", async (ctx) => {
      await handleNewCommand(ctx, { apiClient, ensureAllowed })
    })
  },
})
