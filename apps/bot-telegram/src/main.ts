import { consola } from "consola"
import { Bot } from "grammy"
import { z } from "zod"
import { loadEnv, BOT_TELEGRAM_ENV } from "@bbot/shared"

const env = loadEnv(
  z.object({
    [BOT_TELEGRAM_ENV.BOT_TOKEN]: z.string().min(1),
  }),
)

const bot = new Bot(env[BOT_TELEGRAM_ENV.BOT_TOKEN])

bot.command("start", async (ctx) => {
  await ctx.reply("Hello! I'm your Telegram bot.")
});

bot.catch((error) => {
  consola.error(error)
})

const start = async () => {
  consola.info("Telegram bot is starting...")
  await bot.start()
}

void start().catch((error) => {
  consola.error(error)
  process.exitCode = 1
})
