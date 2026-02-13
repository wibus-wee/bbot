import { spawn } from "node:child_process"

import type { CommandModule } from "./types"

export const createPullCommand = (): CommandModule => ({
  command: "pull",
  description: "Restart local services",
  register: ({ bot, ensureAllowed, repoRoot, restartScript }) => {
    bot.command("pull", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      await ctx.reply("Restarting local services...")
      try {
        const child = spawn("bash", [restartScript], {
          cwd: repoRoot,
          stdio: "ignore",
          detached: true,
        })
        child.unref()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Failed to start restart script: ${message}`)
      }
    })
  },
})
