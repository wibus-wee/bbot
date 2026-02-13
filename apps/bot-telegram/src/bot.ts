import { resolve } from "node:path"

import { Bot, type Context } from "grammy"

import { createApiClient, createRun } from "./api"
import { createCommandModules, type CommandContext } from "./commands"
import type { BotConfig } from "./config"
import { sendChunks } from "./messages"
import {
  clearChatActiveRun,
  getChatActiveRun,
  getChatSession,
  setChatActiveRun,
} from "./sessions"
import { streamRun } from "./stream"

export const createBot = (config: BotConfig) => {
  const bot = new Bot(config.botToken)
  const apiClient = createApiClient(config)
  const repoRoot = resolve(__dirname, "..", "..", "..")
  const restartScript = resolve(
    repoRoot,
    "tooling",
    "scripts",
    "restart-local.sh",
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

  const commandModules = createCommandModules()
  const commandList = commandModules.map((item) => ({
    command: item.command,
    description: item.description,
  }))
  const commandContext: CommandContext = {
    bot,
    apiClient,
    commandList,
    repoRoot,
    restartScript,
    ensureAllowed,
  }

  for (const module of commandModules) {
    module.register(commandContext)
  }

  bot.on("message:text", async (ctx) => {
    if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
    if (ctx.message.text.startsWith("/")) return

    const chatId = ctx.chat?.id
    if (!chatId) return

    const sessionId = getChatSession(chatId)
    if (!sessionId) {
      await ctx.reply("No active session. Use /new or /resume first.")
      return
    }

    void reactEyes(ctx)
    const prompt = ctx.message.text.trim()
    if (!prompt) return

    try {
      const run = await createRun(apiClient, { sessionId, prompt })
      setChatActiveRun(chatId, run.id)
      await ctx.reply("Got it. Working on it...")
      void streamRun({
        apiClient,
        botApi: bot.api,
        chatId,
        runId: run.id,
        onTerminal: () => {
          const active = getChatActiveRun(chatId)
          if (active === run.id) {
            clearChatActiveRun(chatId)
          }
        },
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
      await bot.api.setMyCommands(commandList)
    } catch {
      // Ignore command registration failures
    }
    await bot.start()
  }

  return { bot, start }
}
