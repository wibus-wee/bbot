import { sql } from "drizzle-orm"
import { Elysia, type ElysiaAdapter } from "elysia"

import type { Database } from "@bbot/database"

import { createRunsModule } from "./modules/runs"
import { createWorkspacesModule } from "./modules/workspaces"
import { authGuard } from "./plugins/auth"
import { openapiPlugin } from "./plugins/openapi"

type AppOptions = {
  adapter?: ElysiaAdapter
}

export const createApp = (db: Database, options: AppOptions = {}) =>
  new Elysia(options)
    .use(openapiPlugin)
    .use(authGuard)
    .get("/health", async ({ set }) => {
      try {
        await db.execute(sql`select 1`)
        return { status: "ok", db: "ok" }
      } catch (error) {
        set.status = 500
        return { status: "error", db: "error" }
      }
    })
    .use(createWorkspacesModule(db))
    .use(createRunsModule(db))
