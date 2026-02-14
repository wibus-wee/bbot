import { resolve } from "node:path"

import { Bot, type Context } from "grammy"

import { createApiClient, createRun } from "./api"
import { createCommandModules, type CommandContext } from "./commands"
import type { BotConfig } from "./config"
import { sendChunks } from "./messages"
import { createRequestId } from "./request-id"
import { handleProviderWizardInput } from "./provider-wizard"
import {
  getChatSession,
  clearSessionActiveRun,
  dequeueSessionRun,
  enqueueSessionRun,
  getSessionActiveRun,
  setSessionActiveRun,
} from "./sessions"
import { streamRun } from "./stream"
import consola from "consola"

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
      consola.warn(`Unauthorized access attempt by user ${userId} in chat ${chatId}`)
      await bot.api.sendMessage(chatId, "Unauthorized.")
    }
    return false
  }

  const reactEyes = async (ctx: Context) => {
    try {
      await ctx.react("👀")
      return ctx.message?.message_id
    } catch {
      // Ignore reaction failures (not supported in some chats)
    }
    return ctx.message?.message_id
  }

  const clearReaction = async (chatId: number, messageId?: number) => {
    if (!messageId) return
    try {
      await bot.api.setMessageReaction(chatId, messageId, [])
    } catch {
      // Ignore reaction clear failures
    }
  }

  const startQueuedRun = async (sessionId: string) => {
    const next = dequeueSessionRun(sessionId)
    if (!next) return
    await startRun({
      chatId: next.chatId,
      sessionId,
      prompt: next.prompt,
      requestId: next.requestId,
      reactionMessageId: next.reactionMessageId,
    })
  }

  const handleRunTerminal = async (sessionId: string, runId: string) => {
    const active = getSessionActiveRun(sessionId)
    if (!active || active.runId !== runId) return
    await clearReaction(active.chatId, active.reactionMessageId)
    clearSessionActiveRun(sessionId)
    await startQueuedRun(sessionId)
  }

  const startRun = async (input: {
    chatId: number
    sessionId: string
    prompt: string
    requestId: string
    reactionMessageId?: number
  }) => {
    try {
      const run = await createRun(apiClient, {
        sessionId: input.sessionId,
        prompt: input.prompt,
        requestId: input.requestId,
      })
      setSessionActiveRun(input.sessionId, {
        runId: run.id,
        chatId: input.chatId,
        reactionMessageId: input.reactionMessageId,
      })
      void streamRun({
        apiClient,
        botApi: bot.api,
        chatId: input.chatId,
        runId: run.id,
        requestId: input.requestId,
        onTerminal: () => {
          void handleRunTerminal(input.sessionId, run.id)
        },
      })
    } catch (error) {
      await clearReaction(input.chatId, input.reactionMessageId)
      const message = error instanceof Error ? error.message : String(error)
      await bot.api.sendMessage(
        input.chatId,
        `Failed to start run: ${message}`,
      )
      await startQueuedRun(input.sessionId)
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

    const handledWizard = await handleProviderWizardInput({
      chatId,
      text: ctx.message.text,
      apiClient,
      sendMessage: (text) => ctx.reply(text),
    })

    if (handledWizard) {
      return
    }

    const sessionId = getChatSession(chatId)
    if (!sessionId) {
      await ctx.reply("No active session. Use /new or /resume first.")
      return
    }

    const reactionMessageId = await reactEyes(ctx)
    const prompt = ctx.message.text.trim()
    if (!prompt) return

    const requestId = createRequestId()
    const active = getSessionActiveRun(sessionId)
    if (active) {
      const position = enqueueSessionRun(sessionId, {
        chatId,
        prompt,
        requestId,
        sessionId,
        reactionMessageId,
      })
      await ctx.reply(
        `Session is busy. Queued your message (position ${position}). It will start automatically.`,
      )
      return
    }

    await startRun({
      chatId,
      sessionId,
      prompt,
      requestId,
      reactionMessageId,
    })
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
