import { InlineKeyboard } from "grammy"

import type { ApiClient } from "../api"
import { archiveWorkspace, getWorkspace, searchWorkspaces } from "../api"
import { createRequestId } from "../request-id"
import { clearChatActiveRun, clearChatSession, getChatSession } from "../sessions"
import { LIST_CACHE_TTL_MS, LIST_PAGE_SIZE } from "./constants"
import { shortId } from "./utils"
import type { CommandModule } from "./types"

type ArchiveQuery = {
  chatId: number
  userId: number
  query?: string
  createdAt: number
}

export const createArchiveCommand = (): CommandModule => {
  const archiveQueryCache = new Map<string, ArchiveQuery>()

  const rememberArchiveQuery = (input: Omit<ArchiveQuery, "createdAt">) => {
    const now = Date.now()
    for (const [token, entry] of archiveQueryCache) {
      if (now - entry.createdAt > LIST_CACHE_TTL_MS) {
        archiveQueryCache.delete(token)
      }
    }
    const token = shortId()
    archiveQueryCache.set(token, { ...input, createdAt: now })
    return token
  }

  const getArchiveQuery = (token: string) => {
    const entry = archiveQueryCache.get(token)
    if (!entry) return null
    if (Date.now() - entry.createdAt > LIST_CACHE_TTL_MS) {
      archiveQueryCache.delete(token)
      return null
    }
    return entry
  }

  const renderArchivePage = async (input: {
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
      keyboard
        .text(
          label,
          `archive:pick:${input.token}:${input.offset}:${workspace.id}`,
        )
        .row()
    }

    if (hasPrev || hasNext) {
      if (hasPrev) {
        const prevOffset = Math.max(0, input.offset - LIST_PAGE_SIZE)
        keyboard.text("Prev", `archive:page:${input.token}:${prevOffset}`)
      }
      if (hasNext) {
        const nextOffset = input.offset + LIST_PAGE_SIZE
        keyboard.text("Next", `archive:page:${input.token}:${nextOffset}`)
      }
      keyboard.row()
    }

    return { pageItems, keyboard }
  }

  return {
    command: "archive",
    description: "Archive a workspace session",
    register: ({ bot, apiClient, ensureAllowed }) => {
      bot.command("archive", async (ctx) => {
        if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
        const chatId = ctx.chat?.id
        const userId = ctx.from?.id
        if (!chatId || !userId) return

        try {
          const query = ctx.match?.trim()
          const requestId = createRequestId()
          const token = rememberArchiveQuery({ chatId, userId, query })
          const { pageItems, keyboard } = await renderArchivePage({
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

          const hint = query ? "" : "\nTip: /archive <keyword> to search"
          await ctx.reply(`Select a session to archive:${hint}`, {
            reply_markup: keyboard,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.reply(`Failed to load sessions: ${message}`)
        }
      })

      bot.callbackQuery(/^archive:page:([a-z0-9]+):(\d+)$/i, async (ctx) => {
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

        const queryState = getArchiveQuery(token)
        if (!queryState) {
          await ctx.answerCallbackQuery({
            text: "Session list expired. Run /archive again.",
            show_alert: true,
          })
          return
        }

        try {
          const requestId = createRequestId()
          const { pageItems, keyboard } = await renderArchivePage({
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
            await ctx.editMessageText("Select a session to archive:", {
              reply_markup: keyboard,
            })
          }
          await ctx.answerCallbackQuery()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.answerCallbackQuery({ text: message, show_alert: true })
        }
      })

      bot.callbackQuery(
        /^archive:pick:([a-z0-9]+):(\d+):(.+)$/i,
        async (ctx) => {
          if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) {
            await ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true })
            return
          }
          const token = ctx.match?.[1]
          const offset = Number(ctx.match?.[2] ?? 0)
          const sessionId = ctx.match?.[3]
          if (!token || !sessionId) {
            await ctx.answerCallbackQuery({
              text: "Invalid session.",
              show_alert: true,
            })
            return
          }

          const queryState = getArchiveQuery(token)
          if (!queryState) {
            await ctx.answerCallbackQuery({
              text: "Session list expired. Run /archive again.",
              show_alert: true,
            })
            return
          }

        try {
          const requestId = createRequestId()
          const workspace = await getWorkspace(apiClient, sessionId, { requestId })
          const label = (workspace.name || workspace.id).slice(0, 60)
            const keyboard = new InlineKeyboard()
            keyboard.text("Confirm", `archive:confirm:${sessionId}`)
            keyboard.text("Back", `archive:page:${token}:${offset}`)
            keyboard.row()
            await ctx.editMessageText(`Archive session: ${label}?`, {
              reply_markup: keyboard,
            })
            await ctx.answerCallbackQuery()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await ctx.answerCallbackQuery({ text: message, show_alert: true })
          }
        },
      )

      bot.callbackQuery(/^archive:confirm:(.+)$/i, async (ctx) => {
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
          const workspace = await archiveWorkspace(apiClient, { sessionId, requestId })
          if (getChatSession(chatId) === workspace.id) {
            clearChatActiveRun(chatId)
            clearChatSession(chatId)
          }
          await ctx.answerCallbackQuery({ text: "Session archived." })
          await ctx.editMessageText(`Session archived: ${workspace.id}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.answerCallbackQuery({ text: message, show_alert: true })
        }
      })
    },
  }
}
