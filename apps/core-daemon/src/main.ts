import "dotenv/config"

import { node } from "@elysiajs/node"

import { createDatabase } from "@bbot/database"

import { createApp } from "./app"
import { config } from "./config"

const { db, close } = createDatabase(config.databaseUrl)

const app = createApp(db, { adapter: node() })

app.listen(config.port)

console.log(`core-daemon listening on http://localhost:${config.port}`)

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
