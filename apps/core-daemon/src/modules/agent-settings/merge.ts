import { agentSettings, type AgentSettings } from "@bbot/protocol"

const buildErrorMessage = (source: string, error: string) =>
  `Invalid ${source}: ${error}`

export const normalizeAgentSettings = (
  value: unknown,
  source: string,
): AgentSettings => {
  const result = agentSettings.safeParse(value ?? {})
  if (!result.success) {
    throw new Error(buildErrorMessage(source, result.error.message))
  }
  return result.data
}

const mergeCompaction = (
  global?: AgentSettings["compaction"],
  session?: AgentSettings["compaction"],
) => {
  const merged = {
    enabled: session?.enabled ?? global?.enabled,
    reserveTokens: session?.reserveTokens ?? global?.reserveTokens,
    keepRecentTokens: session?.keepRecentTokens ?? global?.keepRecentTokens,
  }
  const hasValues = Object.values(merged).some((value) => value !== undefined)
  return hasValues ? merged : undefined
}

export const mergeAgentSettings = (
  globalSettings: AgentSettings,
  sessionSettings: AgentSettings,
): AgentSettings => ({
  systemPrompt: sessionSettings.systemPrompt ?? globalSettings.systemPrompt,
  promptProfile: sessionSettings.promptProfile ?? globalSettings.promptProfile,
  appendSystemPrompt:
    sessionSettings.appendSystemPrompt ?? globalSettings.appendSystemPrompt,
  thinkingLevel: sessionSettings.thinkingLevel ?? globalSettings.thinkingLevel,
  compaction: mergeCompaction(globalSettings.compaction, sessionSettings.compaction),
})
