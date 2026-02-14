import { InlineKeyboard } from "grammy"

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
  "/provider add <provider> <model> [--base-url=...] [--api-key=...] [--headers='{" +
    "\"X-Key\":\"value\"" +
    "}'] [--activate=true|false]",
  "/provider use <id>",
  "/provider update <id> [--provider=...] [--model=...] [--base-url=...] [--api-key=...] [--headers='{" +
    "\"X-Key\":\"value\"" +
    "}'] [--clear-base-url] [--clear-headers]",
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

const renderProviderList = (
  list: Awaited<ReturnType<typeof listAgentProviders>>,
) => {
  if (list.providers.length === 0) {
    return { text: "No providers configured yet.", keyboard: undefined }
  }
  const lines = list.providers.map((provider) =>
    formatProviderLine(provider, list.activeProviderId),
  )
  const keyboard = new InlineKeyboard()
  let hasButtons = false
  for (const provider of list.providers) {
    if (provider.id === list.activeProviderId) continue
    const label = `Activate ${provider.provider}/${provider.model}`.slice(0, 60)
    keyboard.text(label, `provider:activate:${provider.id}`).row()
    hasButtons = true
  }
  return { text: lines.join("\n"), keyboard: hasButtons ? keyboard : undefined }
}

const parseHeadersFlag = (value: FlagValue | undefined) => {
  if (value === undefined) return { headers: undefined }
  if (typeof value !== "string") return { error: "Headers must be a JSON object." }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Invalid headers JSON: ${message}` }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Headers must be a JSON object." }
  }
  const headers: Record<string, string> = {}
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== "string") {
      return { error: `Header ${key} must be a string value.` }
    }
    headers[key] = val
  }
  return { headers }
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
        const replyList = async (list: Awaited<ReturnType<typeof listAgentProviders>>) => {
          const { text, keyboard } = renderProviderList(list)
          await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined)
        }

        if (!subcommand || subcommand === "list") {
          const list = await listAgentProviders(apiClient, { requestId })
          await replyList(list)
          return
        }

        if (subcommand === "use" || subcommand === "activate") {
          const id = rest[0]
          if (!id) {
            await ctx.reply(usage)
            return
          }
          const list = await activateAgentProvider(apiClient, { id, requestId })
          await replyList(list)
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
          const headersFlag = getFlag(flags, "headers")
          const activateFlag = getFlag(flags, "activate")
          const activate = parseBooleanFlag(activateFlag)
          if (activate === null) {
            await ctx.reply("Invalid value for --activate. Use true/false.")
            return
          }
          const headersResult = parseHeadersFlag(headersFlag)
          if (headersResult.error) {
            await ctx.reply(headersResult.error)
            return
          }

          const list = await createAgentProvider(apiClient, {
            provider,
            model,
            baseUrl: typeof baseUrlFlag === "string" ? baseUrlFlag : undefined,
            apiKey: typeof apiKeyFlag === "string" ? apiKeyFlag : undefined,
            headers: headersResult.headers,
            activate,
            requestId,
          })

          await replyList(list)
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
          const headersFlag = getFlag(flags, "headers")
          const clearBaseUrl = parseBooleanFlag(getFlag(flags, "clear-base-url"))
          const clearHeaders = parseBooleanFlag(getFlag(flags, "clear-headers"))

          if (clearBaseUrl === null) {
            await ctx.reply("Invalid value for --clear-base-url.")
            return
          }

          if (clearHeaders === null) {
            await ctx.reply("Invalid value for --clear-headers.")
            return
          }

          if (clearBaseUrl && baseUrlFlag) {
            await ctx.reply("Use either --base-url or --clear-base-url, not both.")
            return
          }

          if (clearHeaders && headersFlag) {
            await ctx.reply("Use either --headers or --clear-headers, not both.")
            return
          }

          const headersResult = parseHeadersFlag(headersFlag)
          if (headersResult.error) {
            await ctx.reply(headersResult.error)
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
            headers: clearHeaders ? null : headersResult.headers,
            requestId,
          }

          if (
            !payload.provider &&
            !payload.model &&
            payload.baseUrl === undefined &&
            payload.headers === undefined &&
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

    bot.callbackQuery(/^provider:activate:(.+)$/i, async (ctx) => {
      if (!(await ensureAllowed(ctx.from?.id, ctx.chat?.id))) return
      const providerId = ctx.match?.[1]
      if (!providerId) return

      try {
        await ctx.answerCallbackQuery()
        const requestId = createRequestId()
        const list = await activateAgentProvider(apiClient, {
          id: providerId,
          requestId,
        })
        const { text, keyboard } = renderProviderList(list)
        try {
          await ctx.editMessageText(
            text,
            keyboard ? { reply_markup: keyboard } : undefined,
          )
        } catch {
          await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await ctx.reply(`Provider activation failed: ${message}`)
      }
    })
  },
})
