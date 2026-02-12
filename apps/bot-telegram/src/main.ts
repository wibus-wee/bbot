import "dotenv/config"
import { Bot } from "grammy"
import { consola } from "consola"

const token = process.env.BOT_TOKEN
if (!token) {
  throw new Error("Missing BOT_TOKEN environment variable")
}

const bot = new Bot(token)

bot.command("start", async (ctx) => {
  await ctx.reply("BBot is running.")
})

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
