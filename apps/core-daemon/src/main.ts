import { spawn } from "node:child_process"

import { node } from "@elysiajs/node"

import { createDatabase } from "@bbot/database"
import {
  buildRestartScriptArgs,
  resolveRepoRoot,
  resolveRestartScript,
} from "@bbot/shared"

import { createApp } from "./app"
import { config } from "./config"
import { logger } from "./logger"

const { db, close } = createDatabase(config.databaseUrl)
const repoRoot = resolveRepoRoot()
const restartScript = resolveRestartScript()

const app = createApp(db, { adapter: node() })

app.listen(config.port)
logger.info(
  { port: config.port },
  `core-daemon listening on http://localhost:${config.port}`,
)

let isShuttingDown = false
let isRestarting = false

const shutdown = async (reason: string) => {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ reason }, "Shutting down core-daemon")

  try {
    await app.stop()
  } catch (error) {
    logger.error({ error }, "Failed to stop HTTP server")
  }

  try {
    await close()
  } catch (error) {
    logger.error({ error }, "Failed to close database")
  }

  process.exit(0)
}

const startRestartScript = () => {
  try {
    const child = spawn("pnpm", buildRestartScriptArgs(restartScript), {
      cwd: repoRoot,
      stdio: "ignore",
      detached: true,
    })
    child.unref()
    return true
  } catch (error) {
    logger.error({ error }, "Failed to start restart script")
    return false
  }
}

const triggerRestart = async (reason: string) => {
  if (isRestarting) return
  isRestarting = true
  logger.info({ reason }, "Restart requested")
  const started = startRestartScript()
  if (!started) {
    isRestarting = false
    return
  }
  await shutdown(reason)
}

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})

process.on("SIGUSR1", () => {
  void triggerRestart("SIGUSR1")
})
