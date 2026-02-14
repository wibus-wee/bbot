import { z } from "zod"

import { createId } from "@bbot/shared"
import type { Database } from "@bbot/database"
import { getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai"

import { getSystemConfig, upsertSystemConfig } from "../system-configs/service"

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

export type StoredAgentProvider = z.infer<typeof storedAgentProviderSchema>

type ProviderStore = {
  providers: StoredAgentProvider[]
  activeProviderId?: string
}

type ServiceError = {
  status: number
  error: string
}

type ServiceResult<T> = { data: T } | { error: ServiceError }

const knownProviders = new Set(getProviders())

const isKnownProvider = (value: string): value is KnownProvider =>
  knownProviders.has(value as KnownProvider)

const getProviderModels = (provider: KnownProvider) =>
  getModels(provider).map((model) => model.id)

const maskApiKey = (apiKey?: string) => {
  if (!apiKey) return { hasApiKey: false }
  const trimmed = apiKey.trim()
  if (!trimmed) return { hasApiKey: false }
  const preview = trimmed.length > 4 ? trimmed.slice(-4) : trimmed
  return { hasApiKey: true, apiKeyPreview: preview }
}

const toIso = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  return date.toISOString()
}

export const serializeAgentProvider = (provider: StoredAgentProvider) => ({
  id: provider.id,
  provider: provider.provider,
  model: provider.model,
  baseUrl: provider.baseUrl,
  headers: provider.headers,
  ...maskApiKey(provider.apiKey),
  createdAt: toIso(provider.createdAt),
  updatedAt: toIso(provider.updatedAt),
})

const loadProviderStore = async (db: Database): Promise<ProviderStore> => {
  const providersConfig = await getSystemConfig(db, PROVIDERS_CONFIG_KEY)
  const activeConfig = await getSystemConfig(db, ACTIVE_PROVIDER_KEY)

  const providers = storedAgentProviderListSchema.safeParse(
    providersConfig?.value ?? [],
  )
  const activeProviderId = z
    .string()
    .min(1)
    .safeParse(activeConfig?.value ?? undefined)

  return {
    providers: providers.success ? providers.data : [],
    activeProviderId: activeProviderId.success ? activeProviderId.data : undefined,
  }
}

const saveProviderStore = async (db: Database, store: ProviderStore) => {
  await upsertSystemConfig(db, {
    key: PROVIDERS_CONFIG_KEY,
    value: store.providers,
  })
  if (store.activeProviderId) {
    await upsertSystemConfig(db, {
      key: ACTIVE_PROVIDER_KEY,
      value: store.activeProviderId,
    })
  }
}

const ensureProviderAndModel = (
  provider: string,
  model: string,
): ServiceError | null => {
  if (!isKnownProvider(provider)) {
    return { status: 400, error: `Unknown provider: ${provider}` }
  }

  const models = getProviderModels(provider)
  if (!models.includes(model)) {
    return {
      status: 400,
      error: `Unknown model ${model} for provider ${provider}`,
    }
  }

  return null
}

export const listAgentProviders = async (db: Database) => {
  const store = await loadProviderStore(db)
  const providers = store.providers.map((provider) =>
    serializeAgentProvider(provider),
  )

  return { activeProviderId: store.activeProviderId, providers }
}

export const createAgentProvider = async (
  db: Database,
  input: {
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
    headers?: Record<string, string>
    activate?: boolean
  },
): Promise<ServiceResult<{ provider: StoredAgentProvider; activeProviderId?: string }>> => {
  const validationError = ensureProviderAndModel(input.provider, input.model)
  if (validationError) return { error: validationError }

  const store = await loadProviderStore(db)
  const now = new Date().toISOString()
  const provider: StoredAgentProvider = {
    id: createId("provider"),
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    headers: input.headers,
    apiKey: input.apiKey,
    createdAt: now,
    updatedAt: now,
  }

  store.providers.push(provider)
  if (input.activate) {
    store.activeProviderId = provider.id
  }

  await saveProviderStore(db, store)
  return { data: { provider, activeProviderId: store.activeProviderId } }
}

export const updateAgentProvider = async (
  db: Database,
  id: string,
  input: {
    provider?: string
    model?: string
    apiKey?: string
    baseUrl?: string | null
    headers?: Record<string, string> | null
  },
): Promise<ServiceResult<StoredAgentProvider>> => {
  const store = await loadProviderStore(db)
  const index = store.providers.findIndex((item) => item.id === id)
  if (index < 0) {
    return { error: { status: 404, error: "Provider not found" } }
  }

  const existing = store.providers[index]!
  const nextProvider = input.provider ?? existing.provider
  const nextModel = input.model ?? existing.model

  const validationError = ensureProviderAndModel(nextProvider, nextModel)
  if (validationError) return { error: validationError }

  const now = new Date().toISOString()
  const updated: StoredAgentProvider = {
    ...existing,
    provider: nextProvider,
    model: nextModel,
    baseUrl: input.baseUrl === null ? undefined : input.baseUrl ?? existing.baseUrl,
    headers: input.headers === null ? undefined : input.headers ?? existing.headers,
    apiKey: input.apiKey ?? existing.apiKey,
    updatedAt: now,
  }

  store.providers[index] = updated
  await saveProviderStore(db, store)
  return { data: updated }
}

export const deleteAgentProvider = async (
  db: Database,
  id: string,
): Promise<ServiceResult<StoredAgentProvider>> => {
  const store = await loadProviderStore(db)
  const index = store.providers.findIndex((item) => item.id === id)
  if (index < 0) {
    return { error: { status: 404, error: "Provider not found" } }
  }

  if (store.activeProviderId === id) {
    return {
      error: {
        status: 409,
        error: "Active provider cannot be deleted. Activate another provider first.",
      },
    }
  }

  const [removed] = store.providers.splice(index, 1)
  await saveProviderStore(db, store)
  return { data: removed! }
}

export const activateAgentProvider = async (
  db: Database,
  id: string,
): Promise<ServiceResult<string>> => {
  const store = await loadProviderStore(db)
  const exists = store.providers.some((item) => item.id === id)
  if (!exists) {
    return { error: { status: 404, error: "Provider not found" } }
  }

  store.activeProviderId = id
  await saveProviderStore(db, store)
  return { data: id }
}

export const getStoredProvider = async (db: Database, id: string) => {
  const store = await loadProviderStore(db)
  return store.providers.find((item) => item.id === id) ?? null
}

export const getProviderStore = loadProviderStore
