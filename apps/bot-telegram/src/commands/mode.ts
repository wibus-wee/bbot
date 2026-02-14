import { InlineKeyboard } from "grammy"

import {
  getAgentSettings,
  getWorkspaceAgentSettings,
  updateAgentSettings,
  updateWorkspaceAgentSettings,
  type ApiClient,
  type AgentSettings,
  type WorkspaceAgentSettingsResponse,
} from "../api"
import { createRequestId } from "../request-id"
import { getChatSession } from "../sessions"
import type { CommandModule } from "./types"

type ModeSnapshot = {
  sessionId?: string
  sessionSettings: AgentSettings
  globalSettings: AgentSettings
  effectiveSettings: AgentSettings
}

type ReplyContext = {
  reply: (text: string, options?: { reply_markup?: InlineKeyboard }) => Promise<unknown>
  editMessageText?: (
    text: string,
    options?: { reply_markup?: InlineKeyboard },
  ) => Promise<unknown>
}

const DEFAULT_PROFILE: AgentSettings["promptProfile"] = "coding"

const formatSessionProfile = (settings: AgentSettings) =>
  settings.promptProfile ?? "inherit"

const formatGlobalProfile = (settings: AgentSettings) =>
  settings.promptProfile ?? `${DEFAULT_PROFILE} (default)`

const formatEffectiveProfile = (settings: AgentSettings, global: AgentSettings) =>
  settings.promptProfile ?? global.promptProfile ?? DEFAULT_PROFILE

const buildModeText = (snapshot: ModeSnapshot) => {
  const lines = ["Mode:"]
  lines.push(`Session: ${snapshot.sessionId ?? "none"}`)
  if (snapshot.sessionId) {
    lines.push(`Session mode: ${formatSessionProfile(snapshot.sessionSettings)}`)
  }
  lines.push(`Global mode: ${formatGlobalProfile(snapshot.globalSettings)}`)
  lines.push(
    `Effective mode: ${formatEffectiveProfile(
      snapshot.effectiveSettings,
      snapshot.globalSettings,
    )}`,
  )
  lines.push("Changes apply on the next run.")
  return lines.join("\n")
}

const buildModeKeyboard = (sessionId?: string) => {
  const keyboard = new InlineKeyboard()
  if (sessionId) {
    keyboard
      .text("Session: Coding", "mode:session:coding")
      .text("Session: Free", "mode:session:free")
      .row()
      .text("Session: Use Global", "mode:session:clear")
      .row()
  }
  keyboard
    .text("Global: Coding", "mode:global:coding")
    .text("Global: Free", "mode:global:free")
    .row()
    .text("Refresh", "mode:refresh")

  return keyboard
}

const safeEditOrReply = async (
  ctx: ReplyContext,
  text: string,
  keyboard?: InlineKeyboard,
) => {
  try {
    if (!ctx.editMessageText) throw new Error("No edit method")
    await ctx.editMessageText(
      text,
      keyboard ? { reply_markup: keyboard } : undefined,
    )
  } catch {
    await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined)
  }
}

const loadModeSnapshot = async (
  apiClient: ApiClient,
  sessionId?: string,
  requestId?: string,
): Promise<ModeSnapshot> => {
  if (!sessionId) {
    const globalSettings = await getAgentSettings(apiClient, { requestId })
    return {
      sessionSettings: {},
      globalSettings,
      effectiveSettings: globalSettings,
    }
  }

  const settings = await getWorkspaceAgentSettings(apiClient, {
    sessionId,
    requestId,
  })

  return {
    sessionId: settings.sessionId,
    sessionSettings: settings.sessionSettings ?? {},
    globalSettings: settings.globalSettings ?? {},
    effectiveSettings: settings.effectiveSettings ?? {},
  }
}

const updateSessionMode = async (
  apiClient: ApiClient,
  sessionId: string,
  mode: "coding" | "free" | "clear",
  requestId?: string,
): Promise<WorkspaceAgentSettingsResponse> => {
  const current = await getWorkspaceAgentSettings(apiClient, {
    sessionId,
    requestId,
  })
  const sessionSettings = current.sessionSettings ?? {}
  const { promptProfile: _promptProfile, ...rest } = sessionSettings
  const nextSettings =
    mode === "clear" ? rest : { ...sessionSettings, promptProfile: mode }

  return updateWorkspaceAgentSettings(apiClient, {
    sessionId,
    settings: nextSettings,
    requestId,
  })
}

const updateGlobalMode = async (
  apiClient: ApiClient,
  mode: "coding" | "free",
  requestId?: string,
): Promise<AgentSettings> => {
  const current = await getAgentSettings(apiClient, { requestId })
  return updateAgentSettings(apiClient, {
    settings: { ...current, promptProfile: mode },
    requestId,
  })
}

export const createModeCommand = (): CommandModule => ({
  command: "mode",
  description: "Switch agent mode for this session or globally",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("mode", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const sessionId = getChatSession(chatId)
      const requestId = createRequestId()

      try {
        const snapshot = await loadModeSnapshot(apiClient, sessionId, requestId)
        await ctx.reply(buildModeText(snapshot), {
          reply_markup: buildModeKeyboard(sessionId),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Mode command failed: ${message}`)
      }
    })

    bot.callbackQuery(/^mode:refresh$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      await ctx.answerCallbackQuery()

      const chatId = ctx.chat?.id
      if (!chatId) return

      const sessionId = getChatSession(chatId)
      const requestId = createRequestId()

      try {
        const snapshot = await loadModeSnapshot(apiClient, sessionId, requestId)
        await safeEditOrReply(
          ctx,
          buildModeText(snapshot),
          buildModeKeyboard(sessionId),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Mode refresh failed: ${message}`)
      }
    })

    bot.callbackQuery(/^mode:global:(coding|free)$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const mode = ctx.match?.[1]
      await ctx.answerCallbackQuery()

      if (!mode) return

      const chatId = ctx.chat?.id
      if (!chatId) return
      const sessionId = getChatSession(chatId)
      const requestId = createRequestId()

      try {
        const globalSettings = await updateGlobalMode(
          apiClient,
          mode as "coding" | "free",
          requestId,
        )

        const snapshot = sessionId
          ? await loadModeSnapshot(apiClient, sessionId, requestId)
          : {
              sessionSettings: {},
              globalSettings,
              effectiveSettings: globalSettings,
            }

        await safeEditOrReply(
          ctx,
          buildModeText(snapshot),
          buildModeKeyboard(sessionId),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Global mode update failed: ${message}`)
      }
    })

    bot.callbackQuery(/^mode:session:(coding|free|clear)$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const mode = ctx.match?.[1]
      await ctx.answerCallbackQuery()

      if (!mode) return

      const chatId = ctx.chat?.id
      if (!chatId) return
      const sessionId = getChatSession(chatId)

      if (!sessionId) {
        await ctx.reply("No active session. Use /new or /resume first.")
        return
      }

      const requestId = createRequestId()

      try {
        const settings = await updateSessionMode(
          apiClient,
          sessionId,
          mode as "coding" | "free" | "clear",
          requestId,
        )

        const snapshot: ModeSnapshot = {
          sessionId: settings.sessionId,
          sessionSettings: settings.sessionSettings ?? {},
          globalSettings: settings.globalSettings ?? {},
          effectiveSettings: settings.effectiveSettings ?? {},
        }

        await safeEditOrReply(
          ctx,
          buildModeText(snapshot),
          buildModeKeyboard(sessionId),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Session mode update failed: ${message}`)
      }
    })
  },
})
