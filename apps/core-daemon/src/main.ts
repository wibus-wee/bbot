import { node } from "@elysiajs/node"

import { createDatabase } from "@bbot/database"

import { createApp } from "./app"
import { config } from "./config"
import { logger } from "./logger"

const { db, close } = createDatabase(config.databaseUrl)

const app = createApp(db, { adapter: node() })

app.listen(config.port)
logger.info(
  { port: config.port },
  `core-daemon listening on http://localhost:${config.port}`,
)

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
