import type { CommandModule } from "./types"

export const createHelpCommand = (): CommandModule => ({
  command: "help",
  description: "Show available commands",
  register: ({ bot, ensureAllowed, commandList }) => {
    bot.command("help", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const lines = commandList.map((item) => `/${item.command} - ${item.description}`)
      await ctx.reply(lines.join("\n"))
    })
  },
})
