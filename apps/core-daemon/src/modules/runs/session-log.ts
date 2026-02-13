import type { AgentMessage } from "@bbot/agent"

type TextBlock = { type: "text"; text?: string }

const extractTextFromContent = (
  content: string | Array<{ type: string; text?: string }> | undefined,
): string => {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
}

export const buildSearchTextFromMessage = (
  message: AgentMessage,
): string | undefined => {
  if (!message || typeof message !== "object") return undefined
  if (!("role" in message)) return undefined

  if (message.role === "user") {
    const text = extractTextFromContent(message.content)
    return text.length > 0 ? text : undefined
  }

  if (message.role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : []
    const text = extractTextFromContent(content)
    return text.length > 0 ? text : undefined
  }

  return undefined
}

export const buildUserPromptMessage = (prompt: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text: prompt }],
  timestamp: Date.now(),
})

export const buildToolResultMessage = (input: {
  toolCallId: string
  toolName: string
  result: any
  isError: boolean
}): AgentMessage => {
  const content = Array.isArray(input.result?.content)
    ? input.result.content
    : [{ type: "text", text: String(input.result ?? "") }]

  return {
    role: "toolResult",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content,
    details: input.result?.details,
    isError: input.isError,
    timestamp: Date.now(),
  }
}
