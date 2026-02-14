import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { z } from "zod"

import {
  BOT_TELEGRAM_ENV,
  createId,
  loadEnv,
  resolveRepoRoot,
  resolveLastChatPath,
  resolveRestartReportPath,
} from "@bbot/shared"

const RESTART_CHAT_ID_ENV = "BBOT_RESTART_CHAT_ID"
const RESTART_REPORT_PATH = resolveRestartReportPath()
const LAST_CHAT_PATH = resolveLastChatPath()

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error
}

const loadLocalEnv = () => {
  loadEnv(z.object({}).passthrough(), { cwd: resolveRepoRoot() })
}

const parseChatId = (value?: string | null): number | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

const parseChatIdFromValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") return parseChatId(value)
  return null
}

const parseChatIdFromArgs = (args: string[]): number | null => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (arg === "--chat-id") {
      const next = args[index + 1]
      return parseChatId(next)
    }
    if (arg.startsWith("--chat-id=")) {
      const value = arg.slice("--chat-id=".length)
      return parseChatId(value)
    }
  }
  return null
}

const parseSingleAllowedUserId = (value?: string): number | null => {
  if (!value) return null
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (entries.length !== 1) return null
  return parseChatId(entries[0])
}

const readLastChatId = async (): Promise<number | null> => {
  try {
    const raw = await readFile(LAST_CHAT_PATH, "utf8")
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || !parsed) return null
    const record = parsed as Record<string, unknown>
    return parseChatIdFromValue(record.chatId)
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return null
    console.warn("Failed to read last chat id", error)
    return null
  }
}

const resolveChatId = (
  args: string[],
  env: NodeJS.ProcessEnv,
  lastChatId: number | null,
): number | null => {
  const fromArgs = parseChatIdFromArgs(args)
  if (fromArgs) return fromArgs

  const envChatId = parseChatId(env[RESTART_CHAT_ID_ENV])
  if (envChatId) return envChatId

  const allowed = parseSingleAllowedUserId(env[BOT_TELEGRAM_ENV.ALLOWED_USER_IDS])
  if (allowed) return allowed

  return lastChatId
}

const ensureReportAbsent = async () => {
  try {
    await readFile(RESTART_REPORT_PATH, "utf8")
    return false
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return true
    console.warn("Failed to read restart report", error)
    return false
  }
}

const writeReport = async (chatId: number) => {
  const payload = {
    chatId,
    requestedAt: new Date().toISOString(),
    requestId: createId("req"),
  }
  await mkdir(dirname(RESTART_REPORT_PATH), { recursive: true })
  await writeFile(RESTART_REPORT_PATH, JSON.stringify(payload), "utf8")
}

export const writeRestartReportIfNeeded = async (
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) => {
  loadLocalEnv()
  const lastChatId = await readLastChatId()
  const chatId = resolveChatId(args, env, lastChatId)
  if (!chatId) return false

  const shouldWrite = await ensureReportAbsent()
  if (!shouldWrite) return false

  await writeReport(chatId)
  return true
}
