import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino"

type CreateLoggerOptions = {
  name?: string
  level?: string
  bindings?: Record<string, unknown>
}

export type Logger = PinoLogger

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

  return pino(config)
}
