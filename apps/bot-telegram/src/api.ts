import { createClient } from "@bbot/sdk/client"
import {
  deleteAgentProvidersById,
  getAgentSettings as getAgentSettingsRequest,
  getAgentProviders,
  getRunsById,
  getRunsRecovery,
  getSystemConfigsByKey,
  getWorkspacesById,
  getWorkspacesByIdUsage as getWorkspacesByIdUsageRequest,
  getWorkspacesByIdSettings as getWorkspacesByIdSettingsRequest,
  patchWorkspacesByIdSettings as patchWorkspacesByIdSettingsRequest,
  putAgentSettings as putAgentSettingsRequest,
  postAgentProviders,
  postAgentProvidersByIdActivate,
  postWorkspaces,
  postWorkspacesByIdArchive,
  postWorkspacesByIdCompact,
  postWorkspacesByIdRuns,
  postRunsByIdCancel,
  putAgentProvidersById,
  type DeleteAgentProvidersByIdResponse,
  type GetAgentSettingsResponse,
  type GetAgentProvidersResponse,
  type GetRunsByIdResponse,
  type GetRunsRecoveryResponse,
  type GetSystemConfigsByKeyResponse,
  type PostAgentProvidersByIdActivateResponse,
  type PostAgentProvidersResponse,
  type PutAgentProvidersByIdResponse,
  type GetWorkspacesResponse,
  type GetWorkspacesByIdResponse,
  type GetWorkspacesByIdUsageResponse,
  type GetWorkspacesByIdSettingsResponse,
  type PostWorkspacesByIdArchiveResponse,
  type PostWorkspacesByIdCompactResponse,
  type PostWorkspacesResponse,
  type PostWorkspacesByIdRunsResponse,
  type PostRunsByIdCancelResponse,
} from "@bbot/sdk"

import type { BotConfig } from "./config"

export type ApiClient = ReturnType<typeof createClient>

const REQUEST_ID_HEADER = "x-request-id"

const buildRequestHeaders = (requestId?: string) =>
  requestId ? { [REQUEST_ID_HEADER]: requestId } : undefined

type CreateWorkspaceInput = {
  chatId: number
  userId: number
  name: string
  forkedFromSessionId?: string
  requestId?: string
}
type WorkspaceStatus = "active" | "archived"

export type AgentSettings = GetAgentSettingsResponse

export type WorkspaceAgentSettingsResponse = GetWorkspacesByIdSettingsResponse

export type WorkspaceUsageResponse = GetWorkspacesByIdUsageResponse

export const createApiClient = (config: BotConfig): ApiClient =>
  createClient({
    baseUrl: config.coreApiUrl,
    headers: {
      Authorization: `Bearer ${config.coreApiToken}`,
    },
    responseStyle: "fields",
    throwOnError: false,
  })

type ResponseEnvelope<T> = {
  data?: T
  error?: unknown
}

type CoreHealthResponse = {
  status: string
  db: string
}

type CoreHealthResponseMap = {
  200: CoreHealthResponse
}

const unwrapResponse = <T>(result: ResponseEnvelope<T>): T => {
  if (result.error) {
    const message =
      typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error ?? "Request failed")
    throw new Error(message)
  }
  if (!result.data) {
    throw new Error("Missing response data")
  }
  return result.data
}

export const getCoreHealth = async (
  client: ApiClient,
  options?: { requestId?: string },
): Promise<CoreHealthResponse> =>
  unwrapResponse(
    await client.get<CoreHealthResponseMap, unknown>({
      url: "/health",
      headers: buildRequestHeaders(options?.requestId),
    }),
  )

export const createWorkspace = async (
  client: ApiClient,
  input: CreateWorkspaceInput,
): Promise<PostWorkspacesResponse> =>
  unwrapResponse(
    await postWorkspaces({
      client,
      headers: buildRequestHeaders(input.requestId),
      body: {
        name: input.name,
        telegramChatId: String(input.chatId),
        telegramUserId: String(input.userId),
        forkedFromSessionId: input.forkedFromSessionId,
        metadata: {
          source: "telegram",
          forkedFrom: input.forkedFromSessionId,
        },
      },
    }),
  )

export const getSystemConfig = async (
  client: ApiClient,
  input: { key: string; requestId?: string },
): Promise<GetSystemConfigsByKeyResponse | null> => {
  try {
    return unwrapResponse(
      await getSystemConfigsByKey({
        client,
        path: { key: input.key },
        headers: buildRequestHeaders(input.requestId),
      }),
    )
  } catch {
    return null
  }
}

export const getAgentSettings = async (
  client: ApiClient,
  options?: { requestId?: string },
): Promise<AgentSettings> =>
  unwrapResponse(
    await getAgentSettingsRequest({
      client,
      headers: buildRequestHeaders(options?.requestId),
    }),
  )

export const updateAgentSettings = async (
  client: ApiClient,
  input: { settings: AgentSettings; requestId?: string },
): Promise<AgentSettings> =>
  unwrapResponse(
    await putAgentSettingsRequest({
      client,
      headers: {
        "Content-Type": "application/json",
        ...(buildRequestHeaders(input.requestId) ?? {}),
      },
      body: input.settings,
    }),
  )

export const listAgentProviders = async (
  client: ApiClient,
  options?: { requestId?: string },
): Promise<GetAgentProvidersResponse> =>
  unwrapResponse(
    await getAgentProviders({
      client,
      headers: buildRequestHeaders(options?.requestId),
    }),
  )

export const createAgentProvider = async (
  client: ApiClient,
  input: {
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
    headers?: Record<string, string>
    activate?: boolean
    requestId?: string
  },
): Promise<PostAgentProvidersResponse> =>
  unwrapResponse(
    await postAgentProviders({
      client,
      headers: buildRequestHeaders(input.requestId),
      body: {
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        headers: input.headers,
        activate: input.activate,
      },
    }),
  )

export const updateAgentProvider = async (
  client: ApiClient,
  input: {
    id: string
    provider?: string
    model?: string
    apiKey?: string
    baseUrl?: string | null
    headers?: Record<string, string> | null
    requestId?: string
  },
): Promise<PutAgentProvidersByIdResponse> =>
  unwrapResponse(
    await putAgentProvidersById({
      client,
      path: { id: input.id },
      headers: buildRequestHeaders(input.requestId),
      body: {
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl === null ? null : input.baseUrl,
        headers: input.headers === null ? null : input.headers,
      },
    }),
  )

export const deleteAgentProvider = async (
  client: ApiClient,
  input: { id: string; requestId?: string },
): Promise<DeleteAgentProvidersByIdResponse> =>
  unwrapResponse(
    await deleteAgentProvidersById({
      client,
      path: { id: input.id },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const activateAgentProvider = async (
  client: ApiClient,
  input: { id: string; requestId?: string },
): Promise<PostAgentProvidersByIdActivateResponse> =>
  unwrapResponse(
    await postAgentProvidersByIdActivate({
      client,
      path: { id: input.id },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const getWorkspace = async (
  client: ApiClient,
  id: string,
  options?: { requestId?: string },
): Promise<GetWorkspacesByIdResponse> =>
  unwrapResponse(
    await getWorkspacesById({
      client,
      path: { id },
      headers: buildRequestHeaders(options?.requestId),
    }),
  )

export const getWorkspaceAgentSettings = async (
  client: ApiClient,
  input: { sessionId: string; requestId?: string },
): Promise<WorkspaceAgentSettingsResponse> =>
  unwrapResponse(
    await getWorkspacesByIdSettingsRequest({
      client,
      path: { id: input.sessionId },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const getWorkspaceUsage = async (
  client: ApiClient,
  input: { sessionId: string; requestId?: string },
): Promise<WorkspaceUsageResponse> =>
  unwrapResponse(
    await getWorkspacesByIdUsageRequest({
      client,
      path: { id: input.sessionId },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const updateWorkspaceAgentSettings = async (
  client: ApiClient,
  input: { sessionId: string; settings: AgentSettings; requestId?: string },
): Promise<WorkspaceAgentSettingsResponse> =>
  unwrapResponse(
    await patchWorkspacesByIdSettingsRequest({
      client,
      path: { id: input.sessionId },
      headers: {
        "Content-Type": "application/json",
        ...(buildRequestHeaders(input.requestId) ?? {}),
      },
      body: input.settings,
    }),
  )

export const searchWorkspaces = async (
  client: ApiClient,
  input: {
    chatId: number
    userId: number
    query?: string
    status?: WorkspaceStatus
    limit?: number
    offset?: number
    requestId?: string
  },
): Promise<GetWorkspacesResponse> =>
  unwrapResponse(
    await client.get<GetWorkspacesResponse, unknown>({
      url: "/workspaces/search",
      headers: buildRequestHeaders(input.requestId),
      query: {
        chatId: String(input.chatId),
        userId: String(input.userId),
        query: input.query?.trim() || undefined,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
      },
    }),
  )

export const getLatestWorkspaceForChat = async (
  client: ApiClient,
  input: { chatId: number; userId: number; requestId?: string },
): Promise<GetWorkspacesByIdResponse | null> => {
  const list = await searchWorkspaces(client, {
    chatId: input.chatId,
    userId: input.userId,
    requestId: input.requestId,
  })
  return list[0] ?? null
}

export const getRun = async (
  client: ApiClient,
  input: { runId: string; requestId?: string },
): Promise<GetRunsByIdResponse> =>
  unwrapResponse(
    await getRunsById({
      client,
      path: { id: input.runId },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const listRecoveryRuns = async (
  client: ApiClient,
  options?: { requestId?: string },
): Promise<GetRunsRecoveryResponse> =>
  unwrapResponse(
    await getRunsRecovery({
      client,
      headers: buildRequestHeaders(options?.requestId),
    }),
  )

export const createRun = async (
  client: ApiClient,
  input: { sessionId: string; prompt: string; requestId?: string },
): Promise<PostWorkspacesByIdRunsResponse> =>
  unwrapResponse(
    await postWorkspacesByIdRuns({
      client,
      path: { id: input.sessionId },
      body: { prompt: input.prompt },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const cancelRun = async (
  client: ApiClient,
  input: { runId: string; reason?: string; requestId?: string },
): Promise<PostRunsByIdCancelResponse> =>
  unwrapResponse(
    await postRunsByIdCancel({
      client,
      path: { id: input.runId },
      body: { reason: input.reason },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const archiveWorkspace = async (
  client: ApiClient,
  input: { sessionId: string; requestId?: string },
): Promise<PostWorkspacesByIdArchiveResponse> =>
  unwrapResponse(
    await postWorkspacesByIdArchive({
      client,
      path: { id: input.sessionId },
      headers: buildRequestHeaders(input.requestId),
    }),
  )

export const compactWorkspace = async (
  client: ApiClient,
  input: {
    sessionId: string
    keepRecentTokens?: number
    customInstructions?: string
    requestId?: string
  },
): Promise<PostWorkspacesByIdCompactResponse> => {
  const hasBody =
    input.keepRecentTokens !== undefined ||
    (input.customInstructions && input.customInstructions.trim())
  return unwrapResponse(
    await postWorkspacesByIdCompact({
      client,
      path: { id: input.sessionId },
      body: hasBody
        ? {
            keepRecentTokens: input.keepRecentTokens,
            customInstructions: input.customInstructions,
          }
        : {},
      headers: buildRequestHeaders(input.requestId),
    }),
  )
}
