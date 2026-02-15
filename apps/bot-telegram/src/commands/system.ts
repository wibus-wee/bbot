import { handleDoctorCommand } from "./doctor"
import { handleHelpCommand } from "./help"
import { handleRestartCommand } from "./restart"
import { handleStatusCommand } from "./status"
import type { CommandModule } from "./types"

const usage = [
  "System commands:",
  "/system status",
  "/system doctor",
  "/system restart",
  "/system help",
  "Shortcuts: /status /doctor /restart",
].join("\n")

export const createSystemCommand = (): CommandModule => ({
  command: "system",
  description: "Manage system operations",
  register: ({ bot, apiClient, ensureAllowed, restartScript, commandList }) => {
    bot.command("system", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return

      const text = ctx.message?.text?.trim() ?? ""
      const parts = text.split(/\s+/).filter(Boolean)
      const [, subcommand] = parts

      switch (subcommand) {
        case undefined:
        case "menu":
          await ctx.reply(usage)
          return
        case "help":
        case "help-list":
        case "commands":
          await handleHelpCommand(ctx, { ensureAllowed, commandList })
          return
        case "status":
          await handleStatusCommand(ctx, { apiClient, ensureAllowed })
          return
        case "doctor":
          await handleDoctorCommand(ctx, {
            apiClient,
            ensureAllowed,
            restartScript,
          })
          return
        case "restart":
          await handleRestartCommand(ctx, { ensureAllowed })
          return
        default:
          await ctx.reply(usage)
      }
    })
  },
})
