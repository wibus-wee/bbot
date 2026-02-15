import { z } from "zod"

import { getSystemConfig, getWorkspaceUsage, listAgentProviders } from "../api"
import { createRequestId } from "../request-id"
import { resolveChatSessionId } from "../session-resolver"
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

const CONTEXT_USAGE_SYMBOLS = {
  used: "\u26C0",
  buffer: "\u26DD",
  free: "\u26F6",
  rowPrefix: "  ",
} as const

const CONTEXT_USAGE_GRID = {
  columns: 10,
  rows: 10,
} as const

const formatPercent = (ratio?: number) => {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return "0%"
  const value = Math.round(ratio * 1000) / 10
  const label = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${label}%`
}

const formatTokenWithPercent = (tokens: number, window?: number) => {
  if (!window) return `${tokens} tokens`
  return `${tokens} tokens (${formatPercent(tokens / window)})`
}

const buildUsageGrid = (
  usedTokens: number,
  bufferTokens: number,
  window: number,
) => {
  if (window <= 0) return []

  const totalCells = CONTEXT_USAGE_GRID.columns * CONTEXT_USAGE_GRID.rows
  const usedCells = Math.min(
    totalCells,
    Math.floor((usedTokens / window) * totalCells),
  )
  const bufferCells = Math.min(
    totalCells - usedCells,
    Math.floor((bufferTokens / window) * totalCells),
  )
  const freeCells = totalCells - usedCells - bufferCells

  const cells = [
    ...Array.from({ length: usedCells }, () => CONTEXT_USAGE_SYMBOLS.used),
    ...Array.from({ length: bufferCells }, () => CONTEXT_USAGE_SYMBOLS.buffer),
    ...Array.from({ length: freeCells }, () => CONTEXT_USAGE_SYMBOLS.free),
  ]

  const rows: string[] = []
  for (let row = 0; row < CONTEXT_USAGE_GRID.rows; row += 1) {
    const start = row * CONTEXT_USAGE_GRID.columns
    const rowCells = cells.slice(start, start + CONTEXT_USAGE_GRID.columns)
    rows.push(`${CONTEXT_USAGE_SYMBOLS.rowPrefix}${rowCells.join(" ")}`)
  }

  return rows
}

const formatContextFileLabel = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/")
  return normalized.split("/").pop() ?? normalized
}

const skillOriginOrder = ["workspace", "package", "user", "path"] as const

export const createStatusCommand = (): CommandModule => ({
  command: "status",
  description: "Show agent and session status",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("status", async (ctx) => {
      await handleStatusCommand(ctx, { apiClient, ensureAllowed })
    })
  },
})

type StatusCommandDeps = {
  apiClient: Parameters<typeof getSystemConfig>[0]
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleStatusCommand = async (
  ctx: any,
  deps: StatusCommandDeps,
) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const chatId = ctx.chat?.id
  const userId = ctx.from?.id
  if (!chatId || !userId) return

  const requestId = createRequestId()

  try {
    const sessionId = await resolveChatSessionId({ chatId })
    const providerList = await listAgentProviders(deps.apiClient, { requestId })
    const activeProvider = providerList.activeProviderId
      ? providerList.providers.find(
          (provider) => provider.id === providerList.activeProviderId,
        )
      : providerList.providers.length === 1
        ? providerList.providers[0]
        : undefined

    const settingsConfig = await getSystemConfig(deps.apiClient, {
      key: "agent.settings",
      requestId,
    })
    const settingsParsed = agentSettingsSchema.safeParse(
      settingsConfig?.value ?? {},
    )
    const settings = settingsParsed.success ? settingsParsed.data : {}

    const mcpConfig = await getSystemConfig(deps.apiClient, {
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
    const customPromptLength = settings.systemPrompt?.length ?? 0
    lines.push(
      `Custom system prompt: ${customPromptLength ? `${customPromptLength} chars` : "none"}`,
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
        const usage = await getWorkspaceUsage(deps.apiClient, {
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

        const breakdown = usage.context.breakdown
        if (breakdown) {
          lines.push(`\n`)
          lines.push("Context Usage")
          if (contextWindow) {
            lines.push(
              ...buildUsageGrid(
                breakdown.totalTokens,
                breakdown.reserveTokens,
                contextWindow,
              ),
            )
          } else {
            lines.push("  Context window: unknown")
          }

          const modelLabel = usage.model
            ? `${usage.model.provider}/${usage.model.model}`
            : "model"
          const usageLabel = contextWindow
            ? `${breakdown.totalTokens}/${contextWindow} tokens (${formatPercent(
                breakdown.totalTokens / contextWindow,
              )})`
            : `${breakdown.totalTokens} tokens`
          lines.push(`${modelLabel} - ${usageLabel}`)
          lines.push(`\n`)
          lines.push("Estimated usage by category")
          lines.push(
            `${CONTEXT_USAGE_SYMBOLS.used} Used: ${formatTokenWithPercent(
              breakdown.totalTokens,
              contextWindow,
            )}`,
          )
          lines.push(
            `${CONTEXT_USAGE_SYMBOLS.buffer} Reserve buffer: ${formatTokenWithPercent(
              breakdown.reserveTokens,
              contextWindow,
            )}`,
          )
          lines.push(
            `${CONTEXT_USAGE_SYMBOLS.free} Free: ${formatTokenWithPercent(
              breakdown.freeTokens,
              contextWindow,
            )}`,
          )
          lines.push(`\n`)
          lines.push("System prompt")
          lines.push(
            `  Total: ${formatTokens(breakdown.systemPromptTokens)} tokens`,
          )
          lines.push(
            `  ${breakdown.systemPrompt.isCustomPrompt ? "Custom prompt" : "Base prompt"}: ${formatTokens(
              breakdown.systemPrompt.basePromptTokens,
            )} tokens`,
          )
          if (breakdown.systemPrompt.toolsTokens > 0) {
            lines.push(
              `  Tools: ${formatTokens(breakdown.systemPrompt.toolsTokens)} tokens`,
            )
          }
          if (breakdown.systemPrompt.guidelinesTokens > 0) {
            lines.push(
              `  Guidelines: ${formatTokens(breakdown.systemPrompt.guidelinesTokens)} tokens`,
            )
          }
          if (breakdown.systemPrompt.appendPromptTokens > 0) {
            lines.push(
              `  Append prompt: ${formatTokens(breakdown.systemPrompt.appendPromptTokens)} tokens`,
            )
          }
          if (breakdown.systemPrompt.contextFilesTokens > 0) {
            lines.push(
              `  Context files: ${formatTokens(breakdown.systemPrompt.contextFilesTokens)} tokens`,
            )
          }
          if (breakdown.systemPrompt.skillsTokens > 0) {
            lines.push(
              `  Skills: ${formatTokens(breakdown.systemPrompt.skillsTokens)} tokens`,
            )
          }
          if (breakdown.systemPrompt.runtimeTokens > 0) {
            lines.push(
              `  Runtime metadata: ${formatTokens(breakdown.systemPrompt.runtimeTokens)} tokens`,
            )
          }
          lines.push(`\n`)
          lines.push(
            `Messages: ${formatTokens(breakdown.messageTokens)} tokens`,
          )

          if (breakdown.contextFiles.length > 0) {
            lines.push("Context files")
            for (const entry of breakdown.contextFiles) {
              lines.push(
                `  - ${formatContextFileLabel(entry.path)}: ${formatTokens(entry.tokens)} tokens`,
              )
            }
          }

          if (breakdown.skills.length > 0) {
            const skillGroups = new Map<string, typeof breakdown.skills>()
            for (const skill of breakdown.skills) {
              const group = skillGroups.get(skill.origin) ?? []
              group.push(skill)
              skillGroups.set(skill.origin, group)
            }

            for (const origin of skillOriginOrder) {
              const group = skillGroups.get(origin)
              if (!group || group.length === 0) continue
              lines.push(`Skills (${origin})`)
              for (const skill of group) {
                lines.push(
                  `  - ${skill.name}: ${formatTokens(skill.tokens)} tokens`,
                )
              }
            }

            const remainingOrigins = Array.from(skillGroups.keys()).filter(
              (origin) =>
                !skillOriginOrder.includes(
                  origin as typeof skillOriginOrder[number],
                ),
            )
            for (const origin of remainingOrigins) {
              const group = skillGroups.get(origin)
              if (!group || group.length === 0) continue
              lines.push(`Skills (${origin})`)
              for (const skill of group) {
                lines.push(
                  `  - ${skill.name}: ${formatTokens(skill.tokens)} tokens`,
                )
              }
            }
          }
          lines.push(`\n`)
          if (breakdown.notes && breakdown.notes.length > 0) {
            lines.push("Notes")
            for (const note of breakdown.notes) {
              lines.push(`  - ${note}`)
            }
          }
        }
      } catch {
        lines.push("Context (estimated): unavailable")
      }
    }

    await ctx.reply(lines.join("\n"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.reply(`Status failed: ${message}`)
  }
}
