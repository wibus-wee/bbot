import { InlineKeyboard } from "grammy"

import type { ApiClient } from "../api"
import { getWorkspace, searchWorkspaces } from "../api"
import { createRequestId } from "../request-id"
import { setChatSession } from "../sessions"
import { LIST_CACHE_TTL_MS, LIST_PAGE_SIZE } from "./constants"
import { shortId } from "./utils"
import type { CommandModule } from "./types"

type ResumeQuery = {
  chatId: number
  userId: number
  query?: string
  createdAt: number
}

export const createResumeCommand = (): CommandModule => {
  const resumeQueryCache = new Map<string, ResumeQuery>()

  const rememberResumeQuery = (input: Omit<ResumeQuery, "createdAt">) => {
    const now = Date.now()
    for (const [token, entry] of resumeQueryCache) {
      if (now - entry.createdAt > LIST_CACHE_TTL_MS) {
        resumeQueryCache.delete(token)
      }
    }
    const token = shortId()
    resumeQueryCache.set(token, { ...input, createdAt: now })
    return token
  }

  const getResumeQuery = (token: string) => {
    const entry = resumeQueryCache.get(token)
    if (!entry) return null
    if (Date.now() - entry.createdAt > LIST_CACHE_TTL_MS) {
      resumeQueryCache.delete(token)
      return null
    }
    return entry
  }

  const renderResumePage = async (input: {
    chatId: number
    userId: number
    query?: string
    offset: number
    token: string
    apiClient: ApiClient
    requestId?: string
  }) => {
    const results = await searchWorkspaces(input.apiClient, {
      chatId: input.chatId,
      userId: input.userId,
      query: input.query,
      status: "active",
      limit: LIST_PAGE_SIZE + 1,
      offset: Math.max(0, input.offset),
      requestId: input.requestId,
    })

    const pageItems = results.slice(0, LIST_PAGE_SIZE)
    const hasNext = results.length > LIST_PAGE_SIZE
    const hasPrev = input.offset > 0
    const keyboard = new InlineKeyboard()

    for (const workspace of pageItems) {
      const label = (workspace.name || workspace.id).slice(0, 60)
      keyboard.text(label, `resume:${workspace.id}`).row()
    }

    if (hasPrev || hasNext) {
      if (hasPrev) {
        const prevOffset = Math.max(0, input.offset - LIST_PAGE_SIZE)
        keyboard.text("Prev", `resume:page:${input.token}:${prevOffset}`)
      }
      if (hasNext) {
        const nextOffset = input.offset + LIST_PAGE_SIZE
        keyboard.text("Next", `resume:page:${input.token}:${nextOffset}`)
      }
      keyboard.row()
    }

    return { pageItems, keyboard }
  }

  return {
    command: "resume",
    description: "List or search previous sessions",
    register: ({ bot, apiClient, ensureAllowed }) => {
      bot.command("resume", async (ctx) => {
        if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
        const chatId = ctx.chat?.id
        const userId = ctx.from?.id
        if (!chatId || !userId) return

        const query = ctx.match?.trim()
        try {
          const requestId = createRequestId()
          const token = rememberResumeQuery({ chatId, userId, query })
          const { pageItems, keyboard } = await renderResumePage({
            chatId,
            userId,
            query,
            offset: 0,
            token,
            apiClient,
            requestId,
          })
          if (pageItems.length === 0) {
            await ctx.reply(
              query ? `No sessions found for "${query}".` : "No sessions found.",
            )
            return
          }

          await ctx.reply("Select a session:", { reply_markup: keyboard })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.reply(`Failed to load sessions: ${message}`)
        }
      })

      bot.callbackQuery(/^resume:page:([a-z0-9]+):(\d+)$/i, async (ctx) => {
        if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) {
          await ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true })
          return
        }

        const token = ctx.match?.[1]
        const offset = Number(ctx.match?.[2] ?? 0)
        if (!token) {
          await ctx.answerCallbackQuery({ text: "Invalid request.", show_alert: true })
          return
        }

        const queryState = getResumeQuery(token)
        if (!queryState) {
          await ctx.answerCallbackQuery({
            text: "Session list expired. Run /resume again.",
            show_alert: true,
          })
          return
        }

        try {
          const requestId = createRequestId()
          const { pageItems, keyboard } = await renderResumePage({
            chatId: queryState.chatId,
            userId: queryState.userId,
            query: queryState.query,
            offset: Number.isFinite(offset) ? offset : 0,
            token,
            apiClient,
            requestId,
          })
          if (pageItems.length === 0) {
            await ctx.editMessageText("No sessions found.", { reply_markup: keyboard })
          } else {
            await ctx.editMessageText("Select a session:", { reply_markup: keyboard })
          }
          await ctx.answerCallbackQuery()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.answerCallbackQuery({ text: message, show_alert: true })
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
          const requestId = createRequestId()
          await getWorkspace(apiClient, sessionId, { requestId })
          setChatSession(chatId, sessionId)
          await ctx.answerCallbackQuery({ text: "Session resumed." })
          await ctx.editMessageText(`Resumed session: ${sessionId}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.answerCallbackQuery({ text: message, show_alert: true })
        }
      })
    },
  }
}
