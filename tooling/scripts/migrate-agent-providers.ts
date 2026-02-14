import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import dotenv from "dotenv"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createDatabase, schema } from "@bbot/database"
import { createId } from "@bbot/shared"
import { getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai"

const PROVIDERS_CONFIG_KEY = "agent.providers"
const ACTIVE_PROVIDER_KEY = "agent.activeProviderId"

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

type StoredAgentProvider = z.infer<typeof storedAgentProviderSchema>

type EnvMap = Record<string, string | undefined>

type EnvInput = {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
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

const main = async () => {
  const envPath = process.argv[2] ?? resolve(process.cwd(), ".env")
  const env = await loadEnvFile(envPath)

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in the env file")
  }

  const provider = env.AGENT_PROVIDER
  const model = env.AGENT_MODEL
  if (!provider || !model) {
    throw new Error("AGENT_PROVIDER and AGENT_MODEL are required")
  }

  ensureProviderAndModel(provider, model)

  const apiKey = resolveApiKey(provider as KnownProvider, env)
  const input: EnvInput = {
    provider,
    model,
    baseUrl: env.AGENT_BASE_URL,
    apiKey,
  }

  const { db, close } = createDatabase(databaseUrl)
  try {
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

    console.info(
      `Migrated provider ${updated.provider} (${updated.model}) as ${updated.id}`,
    )
  } finally {
    await close()
  }
}

void main()
