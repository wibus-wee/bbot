import { consola } from "consola"

import { createBot } from "./bot"
import { loadBotConfig } from "./config"

const { bot, start } = createBot(loadBotConfig())

bot.catch((error) => {
  consola.error(error)
})

consola.info("Starting Telegram bot...")
void start().catch((error) => {
  consola.error(error)
  process.exitCode = 1
})
