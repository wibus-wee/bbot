import { Elysia } from "elysia"

import type { Database } from "@bbot/database"
import {
  agentSettingsResponse,
  agentSettingsUpdateBody,
  errorResponse,
} from "@bbot/protocol"

import { upsertSystemConfig } from "../system-configs/service"
import { getGlobalAgentSettings } from "./service"

const AGENT_SETTINGS_KEY = "agent.settings"

export const createAgentSettingsModule = (db: Database) =>
  new Elysia({ name: "agent-settings" }).group("/agent/settings", (app) =>
    app
      .get(
        "/",
        async ({ set }) => {
          try {
            return await getGlobalAgentSettings(db)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            set.status = 500
            return { error: message }
          }
        },
        {
          response: {
            200: agentSettingsResponse,
            401: errorResponse,
            500: errorResponse,
          },
        },
      )
      .put(
        "/",
        async ({ body, set }) => {
          const config = await upsertSystemConfig(db, {
            key: AGENT_SETTINGS_KEY,
            value: body,
          })

          if (!config) {
            set.status = 500
            return { error: "Agent settings not saved" }
          }

          return body
        },
        {
          body: agentSettingsUpdateBody,
          response: {
            200: agentSettingsResponse,
            401: errorResponse,
            500: errorResponse,
          },
        },
      ),
  )
