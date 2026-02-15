import { archiveHandlers } from "./archive"
import { handleCompactCommand } from "./compact"
import { handleForkCommand } from "./fork"
import { handleNewCommand } from "./new"
import { resumeHandlers } from "./resume"
import { handleStatusCommand } from "./status"
import type { CommandModule } from "./types"

const usage = [
  "Session commands:",
  "/session new",
  "/session resume [query]",
  "/session fork",
  "/session compact [keepRecentTokens]",
  "/session archive [query]",
  "/session status",
  "Shortcuts: /new /resume /cancel /status",
].join("\n")

export const createSessionCommand = (): CommandModule => ({
  command: "session",
  description: "Manage workspace sessions",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("session", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return

      const text = ctx.message?.text?.trim() ?? ""
      const parts = text.split(/\s+/).filter(Boolean)
      const [, subcommand, ...rest] = parts
      const query = rest.length ? rest.join(" ").trim() : undefined

      switch (subcommand) {
        case undefined:
        case "help":
        case "menu":
          await ctx.reply(usage)
          return
        case "new":
          await handleNewCommand(ctx, { apiClient, ensureAllowed })
          return
        case "resume":
        case "list":
          await resumeHandlers.handleResumeCommand(
            ctx,
            { apiClient, ensureAllowed },
            { query },
          )
          return
        case "fork":
          await handleForkCommand(ctx, { apiClient, ensureAllowed })
          return
        case "compact":
          await handleCompactCommand(
            ctx,
            { apiClient, ensureAllowed },
            { keepRecentTokens: query },
          )
          return
        case "archive":
          await archiveHandlers.handleArchiveCommand(
            ctx,
            { apiClient, ensureAllowed },
            { query },
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
