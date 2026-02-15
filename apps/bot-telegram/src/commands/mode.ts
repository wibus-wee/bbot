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
import { resolveChatSessionId } from "../session-resolver"
import type { CommandModule } from "./types"

type ModeSnapshot = {
  sessionId?: string
  sessionSettings: AgentSettings
  globalSettings: AgentSettings
  effectiveSettings: AgentSettings
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

type ModeCommandDeps = {
  apiClient: ApiClient
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleModeCommand = async (
  ctx: any,
  deps: ModeCommandDeps,
) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const chatId = ctx.chat?.id
  const userId = ctx.from?.id
  if (!chatId || !userId) return

  const requestId = createRequestId()
  const sessionId = await resolveChatSessionId({
    apiClient: deps.apiClient,
    chatId,
    userId,
    requestId,
  })

  try {
    const snapshot = await loadModeSnapshot(deps.apiClient, sessionId, requestId)
    await ctx.reply(buildModeText(snapshot), {
      reply_markup: buildModeKeyboard(sessionId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.reply(`Mode command failed: ${message}`)
  }
}

export const createModeCommand = (): CommandModule => ({
  command: "mode",
  description: "Deprecated. Use /agent mode",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("mode", async (ctx) => {
      await handleModeCommand(ctx, { apiClient, ensureAllowed })
    })

    bot.callbackQuery(/^mode:refresh$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return

      const chatId = ctx.chat?.id
      const userId = ctx.from?.id
      if (!chatId || !userId) return

      const requestId = createRequestId()
      const sessionId = await resolveChatSessionId({
        apiClient,
        chatId,
        userId,
        requestId,
      })

      try {
        const snapshot = await loadModeSnapshot(apiClient, sessionId, requestId)
        await ctx.editMessageText(buildModeText(snapshot), {
          reply_markup: buildModeKeyboard(sessionId),
        })
        await ctx.answerCallbackQuery()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.answerCallbackQuery({
          text: `Mode refresh failed: ${message}`,
          show_alert: true,
        })
      }
    })

    bot.callbackQuery(/^mode:global:(coding|free)$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const mode = ctx.match?.[1]

      if (!mode) return

      const chatId = ctx.chat?.id
      const userId = ctx.from?.id
      if (!chatId || !userId) return
      const requestId = createRequestId()
      const sessionId = await resolveChatSessionId({
        apiClient,
        chatId,
        userId,
        requestId,
      })

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

        await ctx.editMessageText(buildModeText(snapshot), {
          reply_markup: buildModeKeyboard(sessionId),
        })
        await ctx.answerCallbackQuery()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.answerCallbackQuery({
          text: `Global mode update failed: ${message}`,
          show_alert: true,
        })
      }
    })

    bot.callbackQuery(/^mode:session:(coding|free|clear)$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const mode = ctx.match?.[1]

      if (!mode) return

      const chatId = ctx.chat?.id
      const userId = ctx.from?.id
      if (!chatId || !userId) return
      const requestId = createRequestId()
      const sessionId = await resolveChatSessionId({
        apiClient,
        chatId,
        userId,
        requestId,
      })

      if (!sessionId) {
        await ctx.answerCallbackQuery({
          text: "No active session. Use /new or /resume first.",
          show_alert: true,
        })
        return
      }

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

        await ctx.editMessageText(buildModeText(snapshot), {
          reply_markup: buildModeKeyboard(sessionId),
        })
        await ctx.answerCallbackQuery()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.answerCallbackQuery({
          text: `Session mode update failed: ${message}`,
          show_alert: true,
        })
      }
    })
  },
})
