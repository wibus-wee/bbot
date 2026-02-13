import { z } from "zod"

import { loadEnv, BOT_TELEGRAM_ENV } from "@bbot/shared"

export type BotConfig = {
  botToken: string
  coreApiUrl: string
  coreApiToken: string
  allowedUserIds: string[]
}

const schema = z.object({
  [BOT_TELEGRAM_ENV.BOT_TOKEN]: z.string().min(1),
  [BOT_TELEGRAM_ENV.CORE_API_URL]: z.string().url().default("http://localhost:3001"),
  [BOT_TELEGRAM_ENV.CORE_API_TOKEN]: z.string().min(1),
  [BOT_TELEGRAM_ENV.ALLOWED_USER_IDS]: z.string().optional(),
})

const parseAllowedUserIds = (value?: string) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []

export const loadBotConfig = (): BotConfig => {
  const env = loadEnv(schema)
  return {
    botToken: env[BOT_TELEGRAM_ENV.BOT_TOKEN],
    coreApiUrl: env[BOT_TELEGRAM_ENV.CORE_API_URL],
    coreApiToken: env[BOT_TELEGRAM_ENV.CORE_API_TOKEN],
    allowedUserIds: parseAllowedUserIds(env[BOT_TELEGRAM_ENV.ALLOWED_USER_IDS]),
  }
}
