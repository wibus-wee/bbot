import type { CommandModule } from "./types"

export const createStartCommand = (): CommandModule => ({
  command: "start",
  description: "Show welcome message",
  register: ({ bot, ensureAllowed }) => {
    bot.command("start", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      await ctx.reply("BBot is ready. Use /help to see available commands.")
    })
  },
})
