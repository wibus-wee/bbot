import type { CommandModule } from "./types"

type RestartCommandDeps = {
  ensureAllowed: (userId?: number, chatId?: number) => Promise<boolean>
}

export const handleRestartCommand = async (
  ctx: any,
  deps: RestartCommandDeps,
) => {
  if (!(await deps.ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
  await ctx.reply("Restart requested. Triggering SIGUSR1...")

  try {
    process.kill(process.pid, "SIGUSR1")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.reply(`Failed to trigger restart: ${message}`)
  }
}

export const createRestartCommand = (): CommandModule => ({
  command: "restart",
  description: "Deprecated. Use /system restart",
  register: ({ bot, ensureAllowed }) => {
    bot.command("restart", async (ctx) => {
      await handleRestartCommand(ctx, { ensureAllowed })
    })
  },
})
