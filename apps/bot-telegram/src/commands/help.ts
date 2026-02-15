import type { Context } from "grammy"

import type { CommandModule, CommandListItem } from "./types"

type HelpCommandDeps = {
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
  commandList: CommandListItem[]
}

export const handleHelpCommand = async (
  ctx: Context,
  deps: HelpCommandDeps,
) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  const lines = deps.commandList.map(
    (item) => `/${item.command} - ${item.description}`,
  )
  await ctx.reply(lines.join("\n"))
}

export const createHelpCommand = (): CommandModule => ({
  command: "help",
  description: "Deprecated. Use /system help",
  register: ({ bot, ensureAllowed, commandList }) => {
    bot.command("help", async (ctx) => {
      await handleHelpCommand(ctx, { ensureAllowed, commandList })
    })
  },
})
