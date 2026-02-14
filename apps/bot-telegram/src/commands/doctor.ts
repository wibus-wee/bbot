import { constants } from "node:fs"
import { access } from "node:fs/promises"

import { getCoreHealth } from "../api"
import { createRequestId } from "../request-id"
import type { CommandModule } from "./types"

const formatDurationSeconds = (seconds: number) => `${Math.round(seconds)}s`

const getRestartScriptStatus = async (path: string) => {
  try {
    await access(path, constants.F_OK)
    return "ok"
  } catch {
    return "missing"
  }
}

export const createDoctorCommand = (): CommandModule => ({
  command: "doctor",
  description: "Run self-checks",
  register: ({ bot, apiClient, ensureAllowed, restartScript }) => {
    bot.command("doctor", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const requestId = createRequestId()
      const [healthResult, restartScriptStatus] = await Promise.all([
        getCoreHealth(apiClient, { requestId })
          .then((data) => ({ ok: true as const, data }))
          .catch((error: unknown) => ({
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          })),
        getRestartScriptStatus(restartScript),
      ])

      const pm2Id = process.env.pm_id
      const uptime = formatDurationSeconds(process.uptime())
      const lines = [
        "Doctor report",
        `core: ${healthResult.ok ? "ok" : "error"}`,
        `db: ${healthResult.ok ? healthResult.data.db : "unknown"}`,
        `restart-script: ${restartScriptStatus}`,
        `pm2: ${pm2Id ? `ok (id ${pm2Id})` : "unknown"}`,
        `pid: ${process.pid}`,
        `uptime: ${uptime}`,
      ]

      if (!healthResult.ok) {
        lines.push(`core-error: ${healthResult.error}`)
      }

      await ctx.reply(lines.join("\n"))
    })
  },
})
