import "dotenv/config"

import { sql } from "drizzle-orm"
import { node } from "@elysiajs/node"
import { Elysia } from "elysia"
import { consola } from "consola"
import { createDatabase } from "@bbot/database"

import { config } from "./config"

const { db, close } = createDatabase(config.databaseUrl)

const app = new Elysia({
  adapter: node()
}).get("/health", async ({ set }) => {
  try {
    await db.execute(sql`select 1`)
    return { status: "ok", db: "ok" }
  } catch (error) {
    set.status = 500
    return { status: "error", db: "error" }
  }
})

app.listen(config.port)

consola.success(`core-daemon listening on http://localhost:${config.port}`)

const shutdown = async () => {
  await close()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})

process.on("SIGTERM", () => {
  void shutdown()
})
