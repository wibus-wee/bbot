import { sql } from "drizzle-orm"
import { Elysia, type ElysiaAdapter } from "elysia"

import type { Database } from "@bbot/database"

import { createRunsModule } from "./modules/runs"
import { RunDispatcher } from "./modules/runs/dispatcher"
import { createAgentProvidersModule } from "./modules/agent-providers"
import { createAgentSettingsModule } from "./modules/agent-settings"
import { createSystemConfigsModule } from "./modules/system-configs"
import { createWorkspacesModule } from "./modules/workspaces"
import { authGuard } from "./plugins/auth"
import { openapiPlugin } from "./plugins/openapi"
import { requestLogger } from "./plugins/request-logger"

type AppOptions = {
  adapter?: ElysiaAdapter
  skipRunRecovery?: boolean
}

export const createApp = (db: Database, options: AppOptions = {}) => {
  const dispatcher = new RunDispatcher(db)
  if (!options.skipRunRecovery) {
    // Avoid running recovery in short-lived contexts (e.g. OpenAPI generation),
    // which may close the DB pool before recovery finishes.
    void dispatcher.recoverPendingRuns()
  }

  return new Elysia(options)
    .use(openapiPlugin)
    .use(requestLogger)
    .use(authGuard)
    .use(createSystemConfigsModule(db))
    .use(createAgentSettingsModule(db))
    .use(createAgentProvidersModule(db))
    .use(createWorkspacesModule(db, dispatcher))
    .get("/health", async ({ set }) => {
      try {
        await db.execute(sql`select 1`)
        return { status: "ok", db: "ok" }
      } catch (error) {
        set.status = 500
        return { status: "error", db: "error" }
      }
    })
    .use(createRunsModule(db, dispatcher))
}
