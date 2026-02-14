import { McpServerConfigSchema, type AgentRuntimeConfig } from "@bbot/agent"
import type { Database } from "@bbot/database"
import { schema } from "@bbot/database"
import { eq } from "drizzle-orm"
import { getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai"
import { z } from "zod"

import { getSystemConfig } from "../system-configs/service"
import { getGlobalAgentSettings } from "../agent-settings/service"
import { mergeAgentSettings, normalizeAgentSettings } from "../agent-settings/merge"
import { getProviderStore, type StoredAgentProvider } from "./service"

const DEFAULT_COMPACTION = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}

const mcpServersSchema = z.array(McpServerConfigSchema)
const AGENT_MCP_SERVERS_KEY = "agent.mcpServers"

const { workspaceSessions } = schema

const PROVIDERS_WITHOUT_API_KEY = new Set<KnownProvider>([
  "amazon-bedrock",
  "google-vertex",
])

const REQUIRES_API_KEY = new Set<KnownProvider>([
  "openai",
  "openai-codex",
  "anthropic",
  "azure-openai-responses",
  "google",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "mistral",
  "minimax",
  "minimax-cn",
  "huggingface",
  "opencode",
  "kimi-coding",
])

const knownProviders = new Set(getProviders())

const resolveActiveProvider = (
  providers: StoredAgentProvider[],
  activeProviderId?: string,
) => {
  if (activeProviderId) {
    return providers.find((item) => item.id === activeProviderId) ?? null
  }
  if (providers.length === 1) {
    return providers[0] ?? null
  }
  return null
}

const validateProvider = (provider: StoredAgentProvider) => {
  if (!knownProviders.has(provider.provider as KnownProvider)) {
    throw new Error(`Unknown provider: ${provider.provider}`)
  }
  const models = getModels(provider.provider as KnownProvider)
  const exists = models.some((model) => model.id === provider.model)
  if (!exists) {
    throw new Error(
      `Unknown model ${provider.model} for provider ${provider.provider}`,
    )
  }
}

const ensureApiKey = (provider: StoredAgentProvider) => {
  const knownProvider = provider.provider as KnownProvider
  if (PROVIDERS_WITHOUT_API_KEY.has(knownProvider)) return
  if (!REQUIRES_API_KEY.has(knownProvider)) return
  if (!provider.apiKey || !provider.apiKey.trim()) {
    throw new Error(`API key is required for provider ${provider.provider}`)
  }
}

const getSessionAgentSettings = async (db: Database, sessionId: string) => {
  const [row] = await db
    .select({ agentSettings: workspaceSessions.agentSettings })
    .from(workspaceSessions)
    .where(eq(workspaceSessions.id, sessionId))
    .limit(1)

  if (!row) {
    throw new Error("Workspace not found")
  }

  return normalizeAgentSettings(
    row.agentSettings ?? {},
    "workspace_sessions.agent_settings",
  )
}

export const resolveAgentRuntimeConfig = async (
  db: Database,
  options: { sessionId?: string } = {},
): Promise<AgentRuntimeConfig> => {
  const store = await getProviderStore(db)
  if (store.providers.length === 0) {
    throw new Error("No providers configured")
  }

  const activeProvider = resolveActiveProvider(
    store.providers,
    store.activeProviderId,
  )
  if (!activeProvider) {
    throw new Error("Active provider is not set")
  }

  validateProvider(activeProvider)
  ensureApiKey(activeProvider)

  const globalSettings = await getGlobalAgentSettings(db)
  const sessionSettings = options.sessionId
    ? await getSessionAgentSettings(db, options.sessionId)
    : {}
  const mergedSettings = mergeAgentSettings(globalSettings, sessionSettings)

  const mcpConfig = await getSystemConfig(db, AGENT_MCP_SERVERS_KEY)
  const mcpResult = mcpServersSchema.safeParse(mcpConfig?.value ?? [])
  if (!mcpResult.success) {
    throw new Error(
      `Invalid agent.mcpServers: ${mcpResult.error.message}`,
    )
  }

  const compaction = {
    enabled: mergedSettings.compaction?.enabled ?? DEFAULT_COMPACTION.enabled,
    reserveTokens:
      mergedSettings.compaction?.reserveTokens ?? DEFAULT_COMPACTION.reserveTokens,
    keepRecentTokens:
      mergedSettings.compaction?.keepRecentTokens ?? DEFAULT_COMPACTION.keepRecentTokens,
  }

  return {
    provider: activeProvider.provider,
    model: activeProvider.model,
    baseUrl: activeProvider.baseUrl,
    headers: activeProvider.headers,
    apiKey: activeProvider.apiKey?.trim() || undefined,
    systemPrompt: mergedSettings.systemPrompt ?? "",
    promptProfile: mergedSettings.promptProfile,
    appendSystemPrompt: mergedSettings.appendSystemPrompt,
    compaction,
    thinkingLevel: mergedSettings.thinkingLevel,
    mcpServers: mcpResult.data,
  }
}
