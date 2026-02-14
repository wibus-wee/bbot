import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import dotenv from "dotenv"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { McpServerConfigSchema } from "@bbot/agent"
import { createDatabase, schema } from "@bbot/database"
import { createId } from "@bbot/shared"
import { getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai"

const PROVIDERS_CONFIG_KEY = "agent.providers"
const ACTIVE_PROVIDER_KEY = "agent.activeProviderId"
const SETTINGS_CONFIG_KEY = "agent.settings"
const MCP_SERVERS_KEY = "agent.mcpServers"

const DEFAULT_COMPACTION = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}

const DEFAULT_PROMPT_PROFILE = "coding"

const storedAgentProviderSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  apiKey: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

const storedAgentProviderListSchema = z.array(storedAgentProviderSchema)

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

const mcpServersSchema = z.array(McpServerConfigSchema)

type StoredAgentProvider = z.infer<typeof storedAgentProviderSchema>

type EnvMap = Record<string, string | undefined>

type EnvInput = {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
}

type ProviderStore = {
  providers: StoredAgentProvider[]
  activeProviderId?: string
}

const knownProviders = new Set(getProviders())

const resolveApiKey = (provider: KnownProvider, env: EnvMap) => {
  if (provider === "github-copilot") {
    return env.COPILOT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN
  }
  if (provider === "anthropic") {
    return env.ANTHROPIC_OAUTH_TOKEN || env.ANTHROPIC_API_KEY
  }
  if (provider === "amazon-bedrock") {
    return undefined
  }
  if (provider === "google-vertex") {
    return undefined
  }
  const envMap: Record<KnownProvider, string | undefined> = {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_OAUTH_TOKEN || env.ANTHROPIC_API_KEY,
    "azure-openai-responses": env.AZURE_OPENAI_API_KEY,
    google: env.GEMINI_API_KEY,
    "google-gemini-cli": env.GEMINI_API_KEY,
    "google-antigravity": env.GEMINI_API_KEY,
    groq: env.GROQ_API_KEY,
    cerebras: env.CEREBRAS_API_KEY,
    xai: env.XAI_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    "vercel-ai-gateway": env.AI_GATEWAY_API_KEY,
    zai: env.ZAI_API_KEY,
    mistral: env.MISTRAL_API_KEY,
    minimax: env.MINIMAX_API_KEY,
    "minimax-cn": env.MINIMAX_CN_API_KEY,
    huggingface: env.HF_TOKEN,
    opencode: env.OPENCODE_API_KEY,
    "kimi-coding": env.KIMI_API_KEY,
    "amazon-bedrock": undefined,
    "google-vertex": undefined,
    "openai-codex": env.OPENAI_API_KEY,
    "github-copilot": env.COPILOT_GITHUB_TOKEN,
  }
  return envMap[provider]
}

const ensureProviderAndModel = (provider: string, model: string) => {
  if (!knownProviders.has(provider as KnownProvider)) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  const models = getModels(provider as KnownProvider)
  const exists = models.some((item) => item.id === model)
  if (!exists) {
    throw new Error(`Unknown model ${model} for provider ${provider}`)
  }
}

const loadEnvFile = async (path: string): Promise<EnvMap> => {
  const content = await readFile(path, "utf-8")
  return dotenv.parse(content)
}

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const resolveEnvPath = async (args: string[]) => {
  const envFlagIndex = args.indexOf("--env")
  if (envFlagIndex >= 0 && args[envFlagIndex + 1]) {
    return resolve(process.cwd(), args[envFlagIndex + 1])
  }

  const manualPath = args.find((arg) => !arg.startsWith("--"))
  if (manualPath) {
    return resolve(process.cwd(), manualPath)
  }

  const coreEnv = resolve(process.cwd(), "apps", "core-daemon", ".env")
  if (await exists(coreEnv)) return coreEnv

  const rootEnv = resolve(process.cwd(), ".env")
  if (await exists(rootEnv)) return rootEnv

  throw new Error("No env file found. Pass a path or use --env <path>.")
}

const upsertConfig = async (
  db: ReturnType<typeof createDatabase>["db"],
  key: string,
  value: unknown,
) => {
  const now = new Date()
  await db
    .insert(schema.systemConfigs)
    .values({
      key,
      value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.systemConfigs.key,
      set: {
        value,
        updatedAt: now,
      },
    })
}

const loadProviderStore = async (db: ReturnType<typeof createDatabase>["db"]) => {
  const [providersRow] = await db
    .select()
    .from(schema.systemConfigs)
    .where(eq(schema.systemConfigs.key, PROVIDERS_CONFIG_KEY))
    .limit(1)

  const [activeRow] = await db
    .select()
    .from(schema.systemConfigs)
    .where(eq(schema.systemConfigs.key, ACTIVE_PROVIDER_KEY))
    .limit(1)

  const providers = storedAgentProviderListSchema.safeParse(
    providersRow?.value ?? [],
  )

  return {
    providers: providers.success ? providers.data : [],
    activeProviderId:
      typeof activeRow?.value === "string" ? activeRow.value : undefined,
  }
}

const buildProvider = (input: EnvInput, existing?: StoredAgentProvider) => {
  const now = new Date().toISOString()
  if (existing) {
    return {
      ...existing,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey ?? existing.apiKey,
      updatedAt: now,
    }
  }
  return {
    id: createId("provider"),
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    createdAt: now,
    updatedAt: now,
  }
}

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true
  if (normalized === "false" || normalized === "0" || normalized === "no") return false
  throw new Error(`Invalid boolean value: ${value}`)
}

const parseNumber = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number value: ${value}`)
  }
  return parsed
}

const resolveSettings = (env: EnvMap) => {
  const settings = {
    systemPrompt: env.AGENT_SYSTEM_PROMPT ?? "",
    promptProfile: env.AGENT_PROMPT_PROFILE ?? DEFAULT_PROMPT_PROFILE,
    appendSystemPrompt: env.AGENT_APPEND_SYSTEM_PROMPT,
    thinkingLevel: env.AGENT_THINKING_LEVEL,
    compaction: {
      enabled: parseBoolean(env.AGENT_COMPACTION_ENABLED, DEFAULT_COMPACTION.enabled),
      reserveTokens: parseNumber(
        env.AGENT_COMPACTION_RESERVE_TOKENS,
        DEFAULT_COMPACTION.reserveTokens,
      ),
      keepRecentTokens: parseNumber(
        env.AGENT_COMPACTION_KEEP_RECENT_TOKENS,
        DEFAULT_COMPACTION.keepRecentTokens,
      ),
    },
  }

  const result = agentSettingsSchema.safeParse(settings)
  if (!result.success) {
    throw new Error(`Invalid agent.settings: ${result.error.message}`)
  }

  return result.data
}

const resolveMcpServers = (env: EnvMap) => {
  const raw = env.AGENT_MCP_SERVERS
  if (!raw || !raw.trim()) return []
  const parsed = JSON.parse(raw)
  const result = mcpServersSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid AGENT_MCP_SERVERS: ${result.error.message}`)
  }
  return result.data
}

const maskApiKey = (apiKey?: string) => {
  if (!apiKey) return undefined
  const trimmed = apiKey.trim()
  if (!trimmed) return undefined
  return trimmed.length > 4 ? trimmed.slice(-4) : trimmed
}

const printDryRun = (
  provider: EnvInput | null,
  settings: ReturnType<typeof resolveSettings>,
  mcpServers: ReturnType<typeof resolveMcpServers>,
  envPath: string,
) => {
  console.info("Dry run: no database changes will be made.")
  console.info(`Env file: ${envPath}`)
  if (provider) {
    console.info(
      `Provider: ${provider.provider} (${provider.model}) baseUrl=${provider.baseUrl ?? "-"}`,
    )
    console.info(
      `API key: ${provider.apiKey ? "present" : "missing"} preview=${maskApiKey(
        provider.apiKey,
      ) ?? "-"}`,
    )
  } else {
    console.info("Provider: not configured in env (skipping provider migration)")
  }
  console.info(
    `Settings: profile=${settings.promptProfile ?? "-"} thinking=${settings.thinkingLevel ?? "-"}`,
  )
  console.info(
    `Settings: systemPromptLength=${settings.systemPrompt?.length ?? 0} appendSystemPromptLength=${settings.appendSystemPrompt?.length ?? 0}`,
  )
  console.info(
    `Compaction: enabled=${settings.compaction?.enabled} reserveTokens=${settings.compaction?.reserveTokens} keepRecentTokens=${settings.compaction?.keepRecentTokens}`,
  )
  console.info(`MCP servers: ${mcpServers.length}`)
}

const migrateProvider = async (
  db: ReturnType<typeof createDatabase>["db"],
  input: EnvInput,
) => {
  const store = await loadProviderStore(db)
  const index = store.providers.findIndex(
    (item) =>
      item.provider === input.provider &&
      item.model === input.model &&
      item.baseUrl === input.baseUrl,
  )

  const updated = buildProvider(
    input,
    index >= 0 ? store.providers[index] : undefined,
  )

  if (index >= 0) {
    store.providers[index] = updated
  } else {
    store.providers.push(updated)
  }

  store.activeProviderId = updated.id

  await upsertConfig(db, PROVIDERS_CONFIG_KEY, store.providers)
  await upsertConfig(db, ACTIVE_PROVIDER_KEY, store.activeProviderId)

  return { updated, activeProviderId: store.activeProviderId }
}

const main = async () => {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const envPath = await resolveEnvPath(args)
  const env = await loadEnvFile(envPath)

  const settings = resolveSettings(env)
  const mcpServers = resolveMcpServers(env)

  const providerValue = env.AGENT_PROVIDER
  const modelValue = env.AGENT_MODEL
  const providerInput =
    providerValue && modelValue
      ? {
          provider: providerValue,
          model: modelValue,
          baseUrl: env.AGENT_BASE_URL,
          apiKey: resolveApiKey(providerValue as KnownProvider, env),
        }
      : null

  if (providerInput) {
    ensureProviderAndModel(providerInput.provider, providerInput.model)
  }

  if (dryRun) {
    printDryRun(providerInput, settings, mcpServers, envPath)
    return
  }

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in the env file")
  }

  const { db, close } = createDatabase(databaseUrl)
  try {
    if (providerInput) {
      const { updated } = await migrateProvider(db, providerInput)
      console.info(
        `Migrated provider ${updated.provider} (${updated.model}) as ${updated.id}`,
      )
    } else {
      console.info("No provider configuration found; skipped provider migration.")
    }

    await upsertConfig(db, SETTINGS_CONFIG_KEY, settings)
    await upsertConfig(db, MCP_SERVERS_KEY, mcpServers)

    console.info("Stored agent.settings and agent.mcpServers in system configs.")
  } finally {
    await close()
  }
}

void main()
