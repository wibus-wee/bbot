import { z } from "zod"

import { dateTimeString } from "./common"

export const agentPromptProfile = z.enum(["coding", "free"])

export const agentThinkingLevel = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

export const agentCompactionSettings = z.object({
  enabled: z.boolean().optional(),
  reserveTokens: z.number().int().positive().optional(),
  keepRecentTokens: z.number().int().positive().optional(),
})

export const agentSettings = z.object({
  systemPrompt: z.string().optional(),
  promptProfile: agentPromptProfile.optional(),
  appendSystemPrompt: z.string().optional(),
  thinkingLevel: agentThinkingLevel.optional(),
  compaction: agentCompactionSettings.optional(),
})

export type AgentSettings = z.infer<typeof agentSettings>

export const agentSettingsResponse = agentSettings

export const agentSettingsUpdateBody = agentSettings

export const workspaceAgentSettingsResponse = z.object({
  sessionId: z.string(),
  sessionSettings: agentSettings,
  globalSettings: agentSettings,
  effectiveSettings: agentSettings,
  updatedAt: dateTimeString.optional(),
})

export const workspaceAgentSettingsUpdateBody = agentSettings
