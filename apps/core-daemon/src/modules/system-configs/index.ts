import { Elysia } from "elysia"

import type { Database } from "@bbot/database"

import {
  errorResponse,
  systemConfigKeyParams,
  systemConfigListResponse,
  systemConfigResponse,
  upsertSystemConfigBody,
} from "@bbot/protocol"
import {
  deleteSystemConfig,
  getSystemConfig,
  listSystemConfigs,
  upsertSystemConfig,
} from "./service"
import { serializeSystemConfig } from "./serialize"

export const createSystemConfigsModule = (db: Database) =>
  new Elysia({ name: "system-configs" }).group("/system-configs", (app) =>
    app
      .get(
        "/",
        async () => {
          const items = await listSystemConfigs(db)
          return items.map(serializeSystemConfig)
        },
        {
          response: {
            200: systemConfigListResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:key",
        async ({ params, set }) => {
          const config = await getSystemConfig(db, params.key)

          if (!config) {
            set.status = 404
            return { error: "System config not found" }
          }

          return serializeSystemConfig(config)
        },
        {
          params: systemConfigKeyParams,
          response: {
            200: systemConfigResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .put(
        "/:key",
        async ({ params, body, set }) => {
          const config = await upsertSystemConfig(db, {
            key: params.key,
            value: body.value,
          })

          if (!config) {
            set.status = 500
            return { error: "System config not saved" }
          }

          return serializeSystemConfig(config)
        },
        {
          params: systemConfigKeyParams,
          body: upsertSystemConfigBody,
          response: {
            200: systemConfigResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      )
      .delete(
        "/:key",
        async ({ params, set }) => {
          const config = await deleteSystemConfig(db, params.key)

          if (!config) {
            set.status = 404
            return { error: "System config not found" }
          }

          return serializeSystemConfig(config)
        },
        {
          params: systemConfigKeyParams,
          response: {
            200: systemConfigResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      ),
  )
