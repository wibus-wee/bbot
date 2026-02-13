import { createClient } from "@bbot/sdk/client"
import {
  getWorkspacesById,
  postWorkspaces,
  postWorkspacesByIdRuns,
  type GetWorkspacesResponse,
  type GetWorkspacesByIdResponse,
  type PostWorkspacesResponse,
  type PostWorkspacesByIdRunsResponse,
} from "@bbot/sdk"

import type { BotConfig } from "./config"

export type ApiClient = ReturnType<typeof createClient>

type CreateWorkspaceInput = {
  chatId: number
  userId: number
  name: string
  forkedFromSessionId?: string
}

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
): Promise<GetWorkspacesByIdResponse> =>
  unwrapResponse(
    await getWorkspacesById({
      client,
      path: { id },
    }),
  )

export const searchWorkspaces = async (
  client: ApiClient,
  input: { chatId: number; userId: number; query?: string },
): Promise<GetWorkspacesResponse> =>
  unwrapResponse(
    await client.get<GetWorkspacesResponse, unknown>({
      url: "/workspaces/search",
      query: {
        chatId: String(input.chatId),
        userId: String(input.userId),
        query: input.query?.trim() || undefined,
      },
    }),
  )

export const getLatestWorkspaceForChat = async (
  client: ApiClient,
  input: { chatId: number; userId: number },
): Promise<GetWorkspacesByIdResponse | null> => {
  const list = await searchWorkspaces(client, {
    chatId: input.chatId,
    userId: input.userId,
  })
  return list[0] ?? null
}

export const createRun = async (
  client: ApiClient,
  input: { sessionId: string; prompt: string },
): Promise<PostWorkspacesByIdRunsResponse> =>
  unwrapResponse(
    await postWorkspacesByIdRuns({
      client,
      path: { id: input.sessionId },
      body: { prompt: input.prompt },
    }),
  )
