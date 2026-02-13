import { Bot, InlineKeyboard, type Context } from "grammy"

import {
  createApiClient,
  createRun,
  createWorkspace,
  getWorkspace,
  searchWorkspaces,
} from "./api"
import { COMMANDS } from "./commands"
import type { BotConfig } from "./config"
import { sendChunks } from "./messages"
import { getChatSession, setChatSession } from "./sessions"
import { streamRun } from "./stream"

const formatSessionName = (chatId: number) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `telegram-${chatId}-${timestamp}`.slice(0, 200)
}

const shortId = () => Math.random().toString(36).slice(2, 8)

export const createBot = (config: BotConfig) => {
  const bot = new Bot(config.botToken)
  const apiClient = createApiClient(config)

  const commands: Array<{ command: string; description: string }> = COMMANDS.map(
    (item) => ({
      command: item.command,
      description: item.description,
    }),
  )

  const isAllowed = (userId?: number) => {
    if (!userId) return false
    if (config.allowedUserIds.length === 0) return true
    return config.allowedUserIds.includes(String(userId))
  }

  const ensureAllowed = async (userId?: number, chatId?: number) => {
    if (isAllowed(userId)) return true
    if (chatId) {
      await bot.api.sendMessage(chatId, "Unauthorized.")
    }
    return false
  }

  const reactEyes = async (ctx: Context) => {
    try {
      await ctx.react("👀")
    } catch {
      // Ignore reaction failures (not supported in some chats)
    }
  }

  bot.command("start", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    await ctx.reply("BBot is ready. Use /help to see available commands.")
  })

  bot.command("help", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    const lines = COMMANDS.map((item) => `/${item.command} - ${item.description}`)
    await ctx.reply(lines.join("\n"))
  })

  bot.command("new", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    const chatId = ctx.chat?.id
    const userId = ctx.from?.id
    if (!chatId || !userId) return

    try {
      const workspace = await createWorkspace(apiClient, {
        chatId,
        userId,
        name: formatSessionName(chatId),
      })
      setChatSession(chatId, workspace.id)
      await ctx.reply(`Workspace created: ${workspace.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.reply(`Failed to create workspace: ${message}`)
    }
  })

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
      const baseWorkspace = await getWorkspace(apiClient, currentSession)
      const nameBase = baseWorkspace.name ?? `fork-${currentSession}`
      const workspace = await createWorkspace(apiClient, {
        chatId,
        userId,
        name: `${nameBase}-fork-${shortId()}`.slice(0, 200),
        forkedFromSessionId: currentSession,
      })
      setChatSession(chatId, workspace.id)
      await ctx.reply(`Workspace forked: ${workspace.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.reply(`Failed to fork workspace: ${message}`)
    }
  })

  bot.command("resume", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    const chatId = ctx.chat?.id
    const userId = ctx.from?.id
    if (!chatId || !userId) return

    const query = ctx.match?.trim()
    try {
      const workspaces = await searchWorkspaces(apiClient, {
        chatId,
        userId,
        query,
      })
      if (workspaces.length === 0) {
        await ctx.reply(
          query ? `No sessions found for "${query}".` : "No sessions found.",
        )
        return
      }

      const keyboard = new InlineKeyboard()
      for (const workspace of workspaces.slice(0, 12)) {
        const label = (workspace.name || workspace.id).slice(0, 60)
        keyboard.text(label, `resume:${workspace.id}`).row()
      }

      await ctx.reply("Select a session:", { reply_markup: keyboard })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.reply(`Failed to load sessions: ${message}`)
    }
  })

  bot.callbackQuery(/^resume:(.+)$/i, async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) {
      await ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true })
      return
    }
    const chatId = ctx.chat?.id
    if (!chatId) return

    const sessionId = ctx.match?.[1]
    if (!sessionId) {
      await ctx.answerCallbackQuery({ text: "Invalid session.", show_alert: true })
      return
    }

    try {
      await getWorkspace(apiClient, sessionId)
      setChatSession(chatId, sessionId)
      await ctx.answerCallbackQuery({ text: "Session resumed." })
      await ctx.editMessageText(`Resumed session: ${sessionId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.answerCallbackQuery({ text: message, show_alert: true })
    }
  })

  bot.on("message:text", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    if (ctx.message.text.startsWith("/")) return
    void reactEyes(ctx)

    const chatId = ctx.chat?.id
    if (!chatId) return

    const sessionId = getChatSession(chatId)
    if (!sessionId) {
      await ctx.reply("No active session. Use /new or /resume first.")
      return
    }

    const prompt = ctx.message.text.trim()
    if (!prompt) return

    try {
      const run = await createRun(apiClient, { sessionId, prompt })
      await ctx.reply(`Run queued: ${run.id}`)
      void streamRun({
        apiClient,
        botApi: bot.api,
        chatId,
        runId: run.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.reply(`Failed to start run: ${message}`)
    }
  })

  bot.on("message", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    if (ctx.message?.text) return
    const chatId = ctx.chat?.id
    if (!chatId) return
    await sendChunks(bot.api, chatId, "Only text messages are supported right now.")
  })

  const start = async () => {
    try {
      await bot.api.setMyCommands(commands)
    } catch {
      // Ignore command registration failures
    }
    await bot.start()
  }

  return { bot, start }
}
