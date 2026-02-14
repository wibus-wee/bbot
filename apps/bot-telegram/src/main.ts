import { spawn } from "node:child_process"

import { consola } from "consola"

import { createBot } from "./bot"
import { loadBotConfig } from "./config"
import { reportPendingRestart } from "./restart-report"
import { hydrateChatSessions } from "./sessions"
import { initializeSessionState } from "./session-state"
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
    const child = spawn("bash", [restartScript], {
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

const mergeRecoverySessions = (input: {
  chatSessions: Array<{ chatId: number; sessionId: string }>
  activeRuns: Array<{ chatId: number; sessionId: string }>
}) => {
  const merged = new Map<number, string>()
  for (const entry of input.chatSessions) {
    merged.set(entry.chatId, entry.sessionId)
  }
  for (const run of input.activeRuns) {
    if (!merged.has(run.chatId)) {
      merged.set(run.chatId, run.sessionId)
    }
  }
  return Array.from(merged, ([chatId, sessionId]) => ({ chatId, sessionId }))
}

const startBot = async () => {
  const recovery = await initializeSessionState()
  const mergedSessions = mergeRecoverySessions({
    chatSessions: recovery.chatSessions,
    activeRuns: recovery.activeRuns,
  })
  if (mergedSessions.length > 0) {
    hydrateChatSessions(mergedSessions)
  }
  await start()
  void reportPendingRestart({ botApi: bot.api, apiClient })
  void resumeInterruptedRuns({
    apiClient,
    runs: recovery.activeRuns,
    attachRun,
  })
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
