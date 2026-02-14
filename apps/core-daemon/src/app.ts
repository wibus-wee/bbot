import { sql } from "drizzle-orm"
import { Elysia, type ElysiaAdapter } from "elysia"

import type { Database } from "@bbot/database"

import { createRunsModule } from "./modules/runs"
import { RunDispatcher } from "./modules/runs/dispatcher"
import { createWorkspacesModule } from "./modules/workspaces"
import { authGuard } from "./plugins/auth"
import { openapiPlugin } from "./plugins/openapi"
import { requestLogger } from "./plugins/request-logger"

type AppOptions = {
  adapter?: ElysiaAdapter
}

export const createApp = (db: Database, options: AppOptions = {}) => {
  const dispatcher = new RunDispatcher(db)

  return new Elysia(options)
    .use(openapiPlugin)
    .use(requestLogger)
    .use(authGuard)
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
