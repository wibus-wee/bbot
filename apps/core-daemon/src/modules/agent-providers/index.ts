import { Elysia } from "elysia"

import type { Database } from "@bbot/database"
import {
  agentProviderListResponse,
  agentProviderResponse,
  createAgentProviderBody,
  errorResponse,
  idParams,
  updateAgentProviderBody,
} from "@bbot/protocol"

import {
  activateAgentProvider,
  createAgentProvider,
  deleteAgentProvider,
  listAgentProviders,
  serializeAgentProvider,
  updateAgentProvider,
} from "./service"

export const createAgentProvidersModule = (db: Database) =>
  new Elysia({ name: "agent-providers" }).group("/agent/providers", (app) =>
    app
      .get(
        "/",
        async () => listAgentProviders(db),
        {
          response: {
            200: agentProviderListResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/",
        async ({ body, set }) => {
          const result = await createAgentProvider(db, body)
          if ("error" in result) {
            set.status = result.error.status
            return { error: result.error.error }
          }
          set.status = 201
          return listAgentProviders(db)
        },
        {
          body: createAgentProviderBody,
          response: {
            201: agentProviderListResponse,
            400: errorResponse,
            401: errorResponse,
          },
        },
      )
      .put(
        "/:id",
        async ({ params, body, set }) => {
          const result = await updateAgentProvider(db, params.id, body)
          if ("error" in result) {
            set.status = result.error.status
            return { error: result.error.error }
          }
          return serializeAgentProvider(result.data)
        },
        {
          params: idParams,
          body: updateAgentProviderBody,
          response: {
            200: agentProviderResponse,
            400: errorResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/:id/activate",
        async ({ params, set }) => {
          const result = await activateAgentProvider(db, params.id)
          if ("error" in result) {
            set.status = result.error.status
            return { error: result.error.error }
          }
          return listAgentProviders(db)
        },
        {
          params: idParams,
          response: {
            200: agentProviderListResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .delete(
        "/:id",
        async ({ params, set }) => {
          const result = await deleteAgentProvider(db, params.id)
          if ("error" in result) {
            set.status = result.error.status
            return { error: result.error.error }
          }
          return serializeAgentProvider(result.data)
        },
        {
          params: idParams,
          response: {
            200: agentProviderResponse,
            404: errorResponse,
            409: errorResponse,
            401: errorResponse,
          },
        },
      ),
  )
