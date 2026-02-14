import { z } from "zod"

import { getSystemConfig, getWorkspaceUsage, listAgentProviders } from "../api"
import { createRequestId } from "../request-id"
import { getChatSession } from "../sessions"
import type { CommandModule } from "./types"

const agentSettingsSchema = z.object({
  systemPrompt: z.string().optional(),
  promptProfile: z.enum(["coding", "free"]).optional(),
  appendSystemPrompt: z.string().optional(),
  thinkingLevel: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
    .optional(),
  compaction: z
    .object({
      enabled: z.boolean().optional(),
      reserveTokens: z.number().int().positive().optional(),
      keepRecentTokens: z.number().int().positive().optional(),
    })
    .optional(),
})

const mcpServerSchema = z.object({
  name: z.string().min(1),
})

const mcpServersSchema = z.array(mcpServerSchema)

const formatNumber = (value?: number) =>
  typeof value === "number" ? String(value) : "default"

const formatBoolean = (value?: boolean) =>
  typeof value === "boolean" ? (value ? "on" : "off") : "default"

const formatTokens = (value?: number) =>
  typeof value === "number" ? String(value) : "unknown"

export const createStatusCommand = (): CommandModule => ({
  command: "status",
  description: "Show agent and session status",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("status", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const requestId = createRequestId()

      try {
        const sessionId = getChatSession(chatId)
        const providerList = await listAgentProviders(apiClient, { requestId })
        const activeProvider = providerList.activeProviderId
          ? providerList.providers.find(
              (provider) => provider.id === providerList.activeProviderId,
            )
          : providerList.providers.length === 1
            ? providerList.providers[0]
            : undefined

        const settingsConfig = await getSystemConfig(apiClient, {
          key: "agent.settings",
          requestId,
        })
        const settingsParsed = agentSettingsSchema.safeParse(
          settingsConfig?.value ?? {},
        )
        const settings = settingsParsed.success ? settingsParsed.data : {}

        const mcpConfig = await getSystemConfig(apiClient, {
          key: "agent.mcpServers",
          requestId,
        })
        const mcpParsed = mcpServersSchema.safeParse(mcpConfig?.value ?? [])
        const mcpServers = mcpParsed.success ? mcpParsed.data : []

        const lines = ["Status:"]
        lines.push(`Session: ${sessionId ?? "none"}`)

        if (!activeProvider) {
          lines.push("Provider: not configured")
        } else {
          const baseUrl = activeProvider.baseUrl ?? "-"
          const keyStatus = activeProvider.hasApiKey ? "present" : "missing"
          lines.push(
            `Provider: ${activeProvider.provider} (${activeProvider.model})`,
          )
          lines.push(`Base URL: ${baseUrl}`)
          lines.push(`API key: ${keyStatus}`)
        }

        const profile = settings.promptProfile ?? "coding"
        lines.push(`Mode: ${profile}`)
        lines.push(`Thinking: ${settings.thinkingLevel ?? "default"}`)
        lines.push(
          `System prompt: ${settings.systemPrompt?.length ?? 0} chars`,
        )
        lines.push(
          `Append prompt: ${settings.appendSystemPrompt?.length ?? 0} chars`,
        )

        const compaction = settings.compaction ?? {}
        lines.push(
          `Compaction: ${formatBoolean(compaction.enabled)} (reserve ${formatNumber(
            compaction.reserveTokens,
          )}, keep ${formatNumber(compaction.keepRecentTokens)})`,
        )
        lines.push(
          `MCP servers: ${mcpServers.length ? mcpServers.map((item) => item.name).join(", ") : "none"}`,
        )

        if (sessionId) {
          try {
            const usage = await getWorkspaceUsage(apiClient, {
              sessionId,
              requestId,
            })
            const contextWindow = usage.context.window
            const contextLabel = contextWindow
              ? `${formatTokens(usage.context.estimatedTokens)} / ${formatTokens(contextWindow)}`
              : formatTokens(usage.context.estimatedTokens)
            lines.push(`Context (estimated): ${contextLabel} tokens`)
            lines.push(
              `Usage (assistant): in ${formatTokens(usage.usage.inputTokens)}, out ${formatTokens(
                usage.usage.outputTokens,
              )}, total ${formatTokens(usage.usage.totalTokens)}`,
            )
          } catch {
            lines.push("Context (estimated): unavailable")
          }
        }

        await ctx.reply(lines.join("\n"))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Status failed: ${message}`)
      }
    })
  },
})
