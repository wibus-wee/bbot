import { spawn } from "node:child_process"

import { consola } from "consola"
import { buildRestartScriptArgs } from "@bbot/shared"

import { createBot } from "./bot"
import { loadBotConfig } from "./config"
import { resumeInterruptedRuns } from "./startup-recovery"

const {
  bot,
  start,
  repoRoot,
  restartScript,
  apiClient,
  attachRun,
} = createBot(loadBotConfig())

let isShuttingDown = false
let isRestarting = false

const shutdown = async (reason: string) => {
  if (isShuttingDown) return
  isShuttingDown = true
  consola.info({ reason }, "Shutting down Telegram bot")

  try {
    await Promise.resolve(bot.stop())
  } catch (error) {
    consola.error({ error }, "Failed to stop Telegram bot")
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
    consola.error({ error }, "Failed to start restart script")
    return false
  }
}

const triggerRestart = async (reason: string) => {
  if (isRestarting) return
  isRestarting = true
  consola.info({ reason }, "Restart requested")
  const started = startRestartScript()
  if (!started) {
    isRestarting = false
    return
  }
  await shutdown(reason)
}

bot.catch((error) => {
  consola.error(error)
})

const startBot = async () => {
  void resumeInterruptedRuns({
    apiClient,
    attachRun,
  })
  await start()
}

consola.info("Starting Telegram bot...")
void startBot().catch((error) => {
  consola.error(error)
  process.exitCode = 1
})

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})

process.on("SIGUSR1", () => {
  void triggerRestart("SIGUSR1")
})
