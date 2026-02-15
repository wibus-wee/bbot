import { handleModeCommand } from "./mode"
import { handleProviderCommand } from "./provider"
import { handleStatusCommand } from "./status"
import type { CommandModule } from "./types"

const usage = [
  "Agent commands:",
  "/agent mode",
  "/agent provider [list|add|use|update|delete]",
  "/agent status",
].join("\n")

export const createAgentCommand = (): CommandModule => ({
  command: "agent",
  description: "Manage agent settings",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("agent", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return

      const text = ctx.message?.text?.trim() ?? ""
      const parts = text.split(/\s+/).filter(Boolean)
      const [, subcommand, ...rest] = parts

      switch (subcommand) {
        case undefined:
        case "help":
        case "menu":
          await ctx.reply(usage)
          return
        case "mode":
          await handleModeCommand(ctx, { apiClient, ensureAllowed })
          return
        case "provider":
          await handleProviderCommand(
            ctx,
            { apiClient, ensureAllowed },
            { args: rest },
          )
          return
        case "status":
          await handleStatusCommand(ctx, { apiClient, ensureAllowed })
          return
        default:
          await ctx.reply(usage)
      }
    })
  },
})
