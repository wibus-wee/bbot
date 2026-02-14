import {
  activateAgentProvider,
  createAgentProvider,
  deleteAgentProvider,
  listAgentProviders,
  updateAgentProvider,
} from "../api"
import { createRequestId } from "../request-id"
import type { CommandModule } from "./types"

const usage = [
  "Usage:",
  "/provider list",
  "/provider add <provider> <model> [--base-url=...] [--api-key=...] [--activate=true|false]",
  "/provider use <id>",
  "/provider update <id> [--provider=...] [--model=...] [--base-url=...] [--api-key=...] [--clear-base-url]",
  "/provider delete <id>",
].join("\n")

type FlagValue = string | boolean

const parseFlags = (args: string[]) => {
  const flags: Record<string, FlagValue> = {}
  const positionals: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token) continue

    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const raw = token.slice(2)
    if (!raw) continue

    const [name, value] = raw.split("=", 2)
    if (!name) continue
    if (value !== undefined) {
      flags[name] = value
      continue
    }

    const next = args[i + 1]
    if (next && !next.startsWith("--")) {
      flags[name] = next
      i += 1
      continue
    }

    flags[name] = true
  }

  return { flags, positionals }
}

const parseBooleanFlag = (value: FlagValue | undefined) => {
  if (typeof value === "boolean") return value
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return null
}

const getFlag = (flags: Record<string, FlagValue>, ...names: string[]) => {
  for (const name of names) {
    if (name in flags) return flags[name]
  }
  return undefined
}

const formatProviderLine = (
  provider: {
    id: string
    provider: string
    model: string
    baseUrl?: string
    apiKeyPreview?: string
    hasApiKey: boolean
  },
  activeProviderId?: string,
) => {
  const active = provider.id === activeProviderId ? "active" : "inactive"
  const baseUrl = provider.baseUrl ?? "-"
  const keyPreview = provider.hasApiKey
    ? `***${provider.apiKeyPreview ?? ""}`
    : "missing"
  return `[${active}] ${provider.id} ${provider.provider}/${provider.model} baseUrl=${baseUrl} key=${keyPreview}`
}

const replyWithList = async (
  sendMessage: (text: string) => Promise<unknown>,
  list: Awaited<ReturnType<typeof listAgentProviders>>,
) => {
  if (list.providers.length === 0) {
    await sendMessage("No providers configured yet.")
    return
  }
  const lines = list.providers.map((provider) =>
    formatProviderLine(provider, list.activeProviderId),
  )
  await sendMessage(lines.join("\n"))
}

export const createProviderCommand = (): CommandModule => ({
  command: "provider",
  description: "Manage AI providers",
  register: ({ bot, apiClient, ensureAllowed }) => {
    bot.command("provider", async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const chatId = ctx.chat?.id
      if (!chatId) return

      const text = ctx.message?.text?.trim() ?? ""
      const parts = text.split(/\s+/).filter(Boolean)
      const [, subcommand, ...rest] = parts

      const requestId = createRequestId()

      try {
        const sendMessage = (text: string) => bot.api.sendMessage(chatId, text)

        if (!subcommand || subcommand === "list") {
          const list = await listAgentProviders(apiClient, { requestId })
          await replyWithList(sendMessage, list)
          return
        }

        if (subcommand === "use" || subcommand === "activate") {
          const id = rest[0]
          if (!id) {
            await ctx.reply(usage)
            return
          }
          const list = await activateAgentProvider(apiClient, { id, requestId })
          await replyWithList(sendMessage, list)
          return
        }

        if (subcommand === "delete") {
          const id = rest[0]
          if (!id) {
            await ctx.reply(usage)
            return
          }
          const deleted = await deleteAgentProvider(apiClient, { id, requestId })
          await ctx.reply(
            `Deleted provider ${deleted.id} (${deleted.provider}/${deleted.model}).`,
          )
          return
        }

        if (subcommand === "add") {
          const { flags, positionals } = parseFlags(rest)
          const [provider, model] = positionals
          if (!provider || !model) {
            await ctx.reply(usage)
            return
          }

          const baseUrlFlag = getFlag(flags, "base-url", "baseUrl")
          const apiKeyFlag = getFlag(flags, "api-key", "apiKey")
          const activateFlag = getFlag(flags, "activate")
          const activate = parseBooleanFlag(activateFlag)
          if (activate === null) {
            await ctx.reply("Invalid value for --activate. Use true/false.")
            return
          }

          const list = await createAgentProvider(apiClient, {
            provider,
            model,
            baseUrl: typeof baseUrlFlag === "string" ? baseUrlFlag : undefined,
            apiKey: typeof apiKeyFlag === "string" ? apiKeyFlag : undefined,
            activate,
            requestId,
          })

          await replyWithList(sendMessage, list)
          return
        }

        if (subcommand === "update") {
          const { flags, positionals } = parseFlags(rest)
          const id = positionals[0]
          if (!id) {
            await ctx.reply(usage)
            return
          }

          const providerFlag = getFlag(flags, "provider")
          const modelFlag = getFlag(flags, "model")
          const baseUrlFlag = getFlag(flags, "base-url", "baseUrl")
          const apiKeyFlag = getFlag(flags, "api-key", "apiKey")
          const clearBaseUrl = parseBooleanFlag(getFlag(flags, "clear-base-url"))

          if (clearBaseUrl === null) {
            await ctx.reply("Invalid value for --clear-base-url.")
            return
          }

          if (clearBaseUrl && baseUrlFlag) {
            await ctx.reply("Use either --base-url or --clear-base-url, not both.")
            return
          }

          const payload = {
            id,
            provider: typeof providerFlag === "string" ? providerFlag : undefined,
            model: typeof modelFlag === "string" ? modelFlag : undefined,
            baseUrl:
              clearBaseUrl
                ? null
                : typeof baseUrlFlag === "string"
                  ? baseUrlFlag
                  : undefined,
            apiKey: typeof apiKeyFlag === "string" ? apiKeyFlag : undefined,
            requestId,
          }

          if (
            !payload.provider &&
            !payload.model &&
            payload.baseUrl === undefined &&
            !payload.apiKey
          ) {
            await ctx.reply("No update fields provided.")
            return
          }

          const updated = await updateAgentProvider(apiClient, payload)
          const line = formatProviderLine(updated, updated.id)
          await ctx.reply(`Updated: ${line}`)
          return
        }

        await ctx.reply(usage)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Provider command failed: ${message}`)
      }
    })
  },
})
