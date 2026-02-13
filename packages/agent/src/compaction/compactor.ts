import type { AgentMessage } from "@mariozechner/pi-agent-core"
import { completeSimple, getEnvApiKey } from "@mariozechner/pi-ai"
import type { AssistantMessage, Model } from "@mariozechner/pi-ai"

import {
  COMPACTION_SUMMARY_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  UPDATE_COMPACTION_SUMMARY_PROMPT,
} from "./prompts"

export type CompactionSettings = {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

const SUMMARY_TAG_OPEN = "<compaction_summary>"
const SUMMARY_TAG_CLOSE = "</compaction_summary>"

const extractTextContent = (
  content: string | Array<{ type: string; text?: string }>,
): string => {
  if (typeof content === "string") return content
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("")
}

export const estimateTokens = (message: AgentMessage): number => {
  let chars = 0

  if (message.role === "user") {
    chars = extractTextContent(message.content).length
    return Math.ceil(chars / 4)
  }

  if (message.role === "assistant") {
    const assistant = message as AssistantMessage
    for (const block of assistant.content) {
      if (block.type === "text") {
        chars += block.text.length
      } else if (block.type === "thinking") {
        chars += block.thinking.length
      } else if (block.type === "toolCall") {
        chars += block.name.length + JSON.stringify(block.arguments).length
      }
    }
    return Math.ceil(chars / 4)
  }

  if (message.role === "toolResult") {
    for (const block of message.content) {
      if (block.type === "text") {
        chars += block.text.length
      } else if (block.type === "image") {
        chars += 4800
      }
    }
    return Math.ceil(chars / 4)
  }

  return 0
}

export const estimateContextTokens = (messages: AgentMessage[]): number =>
  messages.reduce((sum, message) => sum + estimateTokens(message), 0)

const shouldCompact = (
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean => {
  if (!settings.enabled) return false
  return contextTokens > contextWindow - settings.reserveTokens
}

export const extractSummaryFromMessage = (
  message: AgentMessage,
): string | undefined => {
  if (message.role !== "user") return undefined
  const text = extractTextContent(message.content)
  const match = text.match(
    /<compaction_summary>\s*([\s\S]*?)\s*<\/compaction_summary>/i,
  )
  return match?.[1]?.trim()
}

export const buildCompactionSummaryMessage = (summary: string): AgentMessage => ({
  role: "user",
  content: [
    {
      type: "text",
      text: `${SUMMARY_TAG_OPEN}\n${summary}\n${SUMMARY_TAG_CLOSE}`,
    },
  ],
  timestamp: Date.now(),
})

export const splitMessagesForCompaction = (
  messages: AgentMessage[],
  keepRecentTokens: number,
): { summarizedMessages: AgentMessage[]; keptMessages: AgentMessage[] } => {
  if (messages.length === 0) {
    return { summarizedMessages: [], keptMessages: [] }
  }

  if (keepRecentTokens <= 0) {
    return { summarizedMessages: messages, keptMessages: [] }
  }

  let tokens = 0
  let startIndex = 0

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const current = messages[i]
    if (!current) continue
    tokens += estimateTokens(current)
    if (tokens > keepRecentTokens) {
      startIndex = i + 1
      break
    }
  }

  if (startIndex === 0) {
    return { summarizedMessages: [], keptMessages: messages }
  }

  if (startIndex >= messages.length) {
    startIndex = Math.max(0, messages.length - 1)
  }

  while (startIndex > 0 && messages[startIndex]?.role === "toolResult") {
    startIndex -= 1
  }

  return {
    summarizedMessages: messages.slice(0, startIndex),
    keptMessages: messages.slice(startIndex),
  }
}

const serializeConversation = (messages: AgentMessage[]): string => {
  const parts: string[] = []

  for (const message of messages) {
    if (message.role === "user") {
      const content = extractTextContent(message.content)
      if (content) {
        parts.push(`[User]: ${content}`)
      }
      continue
    }

    if (message.role === "assistant") {
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolCalls: string[] = []

      for (const block of (message as AssistantMessage).content) {
        if (block.type === "text") {
          textParts.push(block.text)
        } else if (block.type === "thinking") {
          thinkingParts.push(block.thinking)
        } else if (block.type === "toolCall") {
          const args = Object.entries(block.arguments)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(", ")
          toolCalls.push(`${block.name}(${args})`)
        }
      }

      if (thinkingParts.length > 0) {
        parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`)
      }
      if (textParts.length > 0) {
        parts.push(`[Assistant]: ${textParts.join("\n")}`)
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`)
      }
      continue
    }

    if (message.role === "toolResult") {
      const content = message.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
      if (content) {
        parts.push(`[Tool result]: ${content}`)
      }
    }
  }

  return parts.join("\n\n")
}

const generateSummary = async (
  messages: AgentMessage[],
  model: Model<any>,
  settings: CompactionSettings,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> => {
  const maxTokens = Math.max(256, Math.floor(settings.reserveTokens * 0.8))
  const basePrompt = previousSummary
    ? UPDATE_COMPACTION_SUMMARY_PROMPT
    : COMPACTION_SUMMARY_PROMPT
  const instructions = customInstructions
    ? `${basePrompt}\n\nAdditional focus: ${customInstructions}`
    : basePrompt

  const conversationText = serializeConversation(messages)
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`
  }
  promptText += instructions

  const summarizationMessages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: promptText }],
      timestamp: Date.now(),
    },
  ]

  const apiKey = getEnvApiKey(model.provider)
  const response = await completeSimple(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    { maxTokens, reasoning: "high", apiKey },
  )

  if (response.stopReason === "error") {
    throw new Error(
      `Compaction summarization failed: ${response.errorMessage || "Unknown error"}`,
    )
  }

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim()
}

export const compactMessages = async (options: {
  messages: AgentMessage[]
  model: Model<any>
  settings: CompactionSettings
  customInstructions?: string
}): Promise<{
  messages: AgentMessage[]
  didCompact: boolean
  summary?: string
}> => {
  const { messages, model, settings, customInstructions } = options

  if (!settings.enabled || !model?.contextWindow) {
    return { messages, didCompact: false }
  }

  const contextTokens = estimateContextTokens(messages)
  if (!shouldCompact(contextTokens, model.contextWindow, settings)) {
    return { messages, didCompact: false }
  }

  let previousSummary: string | undefined
  let summaryIndex = -1

  for (let i = 0; i < messages.length; i += 1) {
    const current = messages[i]
    if (!current) continue
    const summary = extractSummaryFromMessage(current)
    if (summary) {
      previousSummary = summary
      summaryIndex = i
      break
    }
  }

  const withoutSummary =
    summaryIndex >= 0 ? messages.filter((_, index) => index !== summaryIndex) : messages

  const { summarizedMessages, keptMessages } = splitMessagesForCompaction(
    withoutSummary,
    settings.keepRecentTokens,
  )

  if (summarizedMessages.length === 0) {
    return { messages, didCompact: false }
  }

  const summary = await generateSummary(
    summarizedMessages,
    model,
    settings,
    customInstructions,
    previousSummary,
  )

  const summaryMessage = buildCompactionSummaryMessage(summary)
  return { messages: [summaryMessage, ...keptMessages], didCompact: true, summary }
}
