import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { consola } from "consola"

import { resolveRestartReportPath } from "@bbot/shared"

import { getCoreHealth, type ApiClient } from "./api"
import type { TelegramApi } from "./messages"
import { createRequestId } from "./request-id"

type RestartReportPayload = {
  chatId: number
  requestedAt: string
  requestId: string
}

type RestartReportWriteInput = {
  chatId: number
}

type HealthCheckResult =
  | { ok: true; data: { status: string; db: string }; attempts: number }
  | { ok: false; error: string; attempts: number }

const RESTART_REPORT_PATH = resolveRestartReportPath()
const HEALTH_CHECK_ATTEMPTS = 8
const HEALTH_CHECK_DELAY_MS = 1500

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isValidRestartReport = (input: unknown): input is RestartReportPayload => {
  if (!input || typeof input !== "object") return false
  const record = input as Record<string, unknown>
  return (
    typeof record.chatId === "number" &&
    Number.isFinite(record.chatId) &&
    typeof record.requestedAt === "string" &&
    typeof record.requestId === "string"
  )
}

const loadRestartReport = async (): Promise<RestartReportPayload | null> => {
  try {
    const raw = await readFile(RESTART_REPORT_PATH, "utf8")
    const parsed = JSON.parse(raw)
    if (!isValidRestartReport(parsed)) {
      await clearRestartReport()
      return null
    }
    return parsed
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return null
    consola.warn({ error }, "Failed to read restart report")
    return null
  }
}

export const writeRestartReport = async (
  input: RestartReportWriteInput,
): Promise<RestartReportPayload> => {
  const payload: RestartReportPayload = {
    chatId: input.chatId,
    requestedAt: new Date().toISOString(),
    requestId: createRequestId(),
  }
  await mkdir(dirname(RESTART_REPORT_PATH), { recursive: true })
  await writeFile(RESTART_REPORT_PATH, JSON.stringify(payload), "utf8")
  return payload
}

export const clearRestartReport = async () => {
  try {
    await unlink(RESTART_REPORT_PATH)
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return
    consola.warn({ error }, "Failed to clear restart report")
  }
}

const waitForCoreHealth = async (client: ApiClient): Promise<HealthCheckResult> => {
  let lastError = "Health check failed"
  for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1) {
    try {
      const data = await getCoreHealth(client, { requestId: createRequestId() })
      return { ok: true, data, attempts: attempt }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < HEALTH_CHECK_ATTEMPTS) {
        await delay(HEALTH_CHECK_DELAY_MS)
      }
    }
  }
  return { ok: false, error: lastError, attempts: HEALTH_CHECK_ATTEMPTS }
}

const formatElapsed = (requestedAt: string, now: number) => {
  const requestedMs = Date.parse(requestedAt)
  if (!Number.isFinite(requestedMs)) return null
  const elapsedMs = Math.max(0, now - requestedMs)
  return `${Math.round(elapsedMs / 1000)}s`
}

export const reportPendingRestart = async (options: {
  botApi: TelegramApi
  apiClient: ApiClient
}) => {
  const report = await loadRestartReport()
  if (!report) return

  const health = await waitForCoreHealth(options.apiClient)
  const now = Date.now()
  const elapsed = formatElapsed(report.requestedAt, now)

  try {
    if (health.ok) {
      const lines = [
        "Restart completed.",
        `core: ${health.data.status}`,
        `db: ${health.data.db}`,
        `attempts: ${health.attempts}`,
      ]
      if (elapsed) lines.push(`elapsed: ${elapsed}`)
      await options.botApi.sendMessage(report.chatId, lines.join("\n"))
    } else {
      const lines = [
        "Restart finished but core health check failed.",
        `error: ${health.error}`,
        `attempts: ${health.attempts}`,
      ]
      if (elapsed) lines.push(`elapsed: ${elapsed}`)
      await options.botApi.sendMessage(report.chatId, lines.join("\n"))
    }
  } catch (error) {
    consola.warn({ error }, "Failed to send restart report")
  } finally {
    await clearRestartReport()
  }
}
