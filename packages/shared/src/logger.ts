import { homedir } from "node:os"
import { resolve } from "node:path"
import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino"

type CreateLoggerOptions = {
  name?: string
  level?: string
  bindings?: Record<string, unknown>
  logDir?: string
  fileName?: string
  rotateDaily?: boolean
}

export type Logger = PinoLogger

const sanitizeFileName = (value: string): string =>
  value
    .trim()
    .replace(/[\\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

const toDateStamp = (value: Date): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

const normalizeBaseName = (value: string): string => {
  const sanitized = sanitizeFileName(value)
  const lower = sanitized.toLowerCase()
  if (lower.endsWith(".log")) {
    return sanitized.slice(0, -4)
  }
  return sanitized
}

const buildBaseBindings = (options: CreateLoggerOptions) => {
  const base: Record<string, unknown> = {}
  if (options.name) {
    base.name = options.name
  }
  if (options.bindings) {
    Object.assign(base, options.bindings)
  }
  return base
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const level = options.level ?? process.env.LOG_LEVEL ?? "info"
  const base = buildBaseBindings(options)
  const config: LoggerOptions = {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  if (Object.keys(base).length > 0) {
    config.base = base
  }

  const logDir =
    options.logDir ?? process.env.BBOT_LOG_DIR ?? resolve(homedir(), ".bbot", "logs")
  const rotateDaily = options.rotateDaily ?? true
  const name = options.fileName ?? options.name ?? "bbot"
  const baseName = normalizeBaseName(name) || "bbot"
  const dateSuffix = rotateDaily ? `-${toDateStamp(new Date())}` : ""
  const fileName = `${baseName}${dateSuffix}.log`
  const destination = pino.destination({
    dest: resolve(logDir, fileName),
    mkdir: true,
    sync: false,
  })

  return pino(config, destination)
}
