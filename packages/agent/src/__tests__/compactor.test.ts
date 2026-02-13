import { describe, expect, it } from "vitest"

import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai"

import {
  buildCompactionSummaryMessage,
  estimateContextTokens,
  extractSummaryFromMessage,
  splitMessagesForCompaction,
} from "../compaction/compactor"

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

const createAssistantMessage = (text: string, timestamp = Date.now()): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-4",
  usage: DEFAULT_USAGE,
  stopReason: "stop",
  timestamp,
})

describe("compactor helpers", () => {
  it("extracts compaction summary content", () => {
    const summaryMessage = buildCompactionSummaryMessage("Summary text")
    expect(extractSummaryFromMessage(summaryMessage)).toBe("Summary text")
  })

  it("splits messages with keepRecentTokens", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "one", timestamp: 1 },
      createAssistantMessage("two", 2),
      { role: "user", content: "three", timestamp: 3 },
    ]

    const { summarizedMessages, keptMessages } = splitMessagesForCompaction(messages, 1)
    expect(summarizedMessages.length).toBeGreaterThan(0)
    expect(keptMessages.length).toBeGreaterThan(0)
  })

  it("estimates tokens for context", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello world", timestamp: 1 },
      createAssistantMessage("ok", 2),
    ]

    expect(estimateContextTokens(messages)).toBeGreaterThan(0)
  })
})
