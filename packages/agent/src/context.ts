import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, ToolResultMessage, Usage } from "@mariozechner/pi-ai"

import { buildCompactionSummaryMessage } from "./compaction/compactor"

export type SessionEntryLike = {
  kind: string
  payload: unknown
  runId?: string | null
  sequence?: number | null
}

export type BuildContextOptions = {
  excludeRunId?: string
}

const DEFAULT_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

const isAgentMessage = (value: unknown): value is AgentMessage => {
  if (!value || typeof value !== "object") return false
  if (!("role" in value)) return false
  const role = (value as { role?: string }).role
  if (role === "user" || role === "assistant") {
    return "content" in value
  }
  if (role === "toolResult") {
    return "content" in value && "toolCallId" in value && "toolName" in value
  }
  return false
}

const isSummaryPayload = (value: unknown): value is { summary: string } => {
  if (!value || typeof value !== "object") return false
  return "summary" in value && typeof (value as { summary?: unknown }).summary === "string"
}

const normalizeUserMessage = (message: AgentMessage): AgentMessage => {
  if (message.role !== "user") return message
  const timestamp = (message as { timestamp?: number }).timestamp ?? Date.now()
  return { ...message, timestamp }
}

const normalizeAssistantMessage = (message: AgentMessage): AgentMessage => {
  if (message.role !== "assistant") return message
  const assistant = message as AssistantMessage
  return {
    ...assistant,
    api: assistant.api ?? "unknown",
    provider: assistant.provider ?? "unknown",
    model: assistant.model ?? "unknown",
    usage: assistant.usage ?? DEFAULT_USAGE,
    stopReason: assistant.stopReason ?? "stop",
    timestamp: assistant.timestamp ?? Date.now(),
  }
}

const normalizeToolResultMessage = (message: AgentMessage): AgentMessage => {
  if (message.role !== "toolResult") return message
  const toolResult = message as ToolResultMessage
  return {
    ...toolResult,
    timestamp: toolResult.timestamp ?? Date.now(),
  }
}

const normalizeMessage = (message: AgentMessage): AgentMessage =>
  normalizeToolResultMessage(normalizeAssistantMessage(normalizeUserMessage(message)))

export const buildContextMessages = (
  entries: SessionEntryLike[],
  options: BuildContextOptions = {},
): AgentMessage[] => {
  const sorted = [...entries].sort((a, b) => {
    const left = typeof a.sequence === "number" ? a.sequence : 0
    const right = typeof b.sequence === "number" ? b.sequence : 0
    return left - right
  })

  const excludeRunId = options.excludeRunId
  const summaryEntry = [...sorted]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "summary" &&
        (!excludeRunId || entry.runId !== excludeRunId),
    )

  const summaryText =
    summaryEntry && isSummaryPayload(summaryEntry.payload)
      ? summaryEntry.payload.summary
      : undefined

  const summaryMessage = summaryText
    ? buildCompactionSummaryMessage(summaryText)
    : undefined

  const messageEntries = sorted.filter(
    (entry) =>
      entry.kind === "message" &&
      (!excludeRunId || entry.runId !== excludeRunId),
  )

  const normalizedMessages = messageEntries
    .map((entry) => entry.payload)
    .filter(isAgentMessage)
    .map(normalizeMessage)

  const summaryPrefix = summaryMessage ? [summaryMessage] : []
  return summaryMessage ? [...summaryPrefix, ...normalizedMessages] : normalizedMessages
}
