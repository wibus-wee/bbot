import { describe, expect, it } from "vitest"

import type { AgentMessage } from "@mariozechner/pi-agent-core"

import {
  buildCompactionSummaryMessage,
  estimateContextTokens,
  extractSummaryFromMessage,
  splitMessagesForCompaction,
} from "../compaction/compactor"

describe("compactor helpers", () => {
  it("extracts compaction summary content", () => {
    const summaryMessage = buildCompactionSummaryMessage("Summary text")
    expect(extractSummaryFromMessage(summaryMessage)).toBe("Summary text")
  })

  it("splits messages with keepRecentTokens", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "one", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "two" }], timestamp: 2 },
      { role: "user", content: "three", timestamp: 3 },
    ]

    const { summarizedMessages, keptMessages } = splitMessagesForCompaction(messages, 1)
    expect(summarizedMessages.length).toBeGreaterThan(0)
    expect(keptMessages.length).toBeGreaterThan(0)
  })

  it("estimates tokens for context", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello world", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2 },
    ]

    expect(estimateContextTokens(messages)).toBeGreaterThan(0)
  })
})
