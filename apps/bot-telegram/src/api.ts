import { createClient } from "@bbot/sdk/client"
import {
  getWorkspacesById,
  postWorkspaces,
  postWorkspacesByIdArchive,
  postWorkspacesByIdCompact,
  postWorkspacesByIdRuns,
  postRunsByIdCancel,
  type GetWorkspacesResponse,
  type GetWorkspacesByIdResponse,
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
