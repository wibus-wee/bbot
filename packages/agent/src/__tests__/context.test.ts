import { describe, expect, it } from "vitest"

import { buildContextMessages } from "../context"

const createUserMessage = (text: string, timestamp = Date.now()) => ({
  role: "user" as const,
  content: [{ type: "text" as const, text }],
  timestamp,
})

describe("buildContextMessages", () => {
  it("injects the latest summary before messages", () => {
    const entries = [
      { kind: "summary", payload: { summary: "Summary text" }, sequence: 1 },
      { kind: "message", payload: createUserMessage("First"), sequence: 2 },
      { kind: "message", payload: createUserMessage("Second"), sequence: 3 },
    ]

    const messages = buildContextMessages(entries)

    expect(messages.length).toBe(3)
    const first = messages[0]
    if (!first) throw new Error("Expected summary message")
    expect(first.role).toBe("user")
    const summaryText = JSON.stringify(first.content)
    expect(summaryText).toContain("<compaction_summary>")
    expect(summaryText).toContain("Summary text")
    const second = messages[1]
    if (!second) throw new Error("Expected first user message")
    expect(second).toMatchObject({ role: "user" })
  })

  it("skips entries from the excluded run", () => {
    const entries = [
      { kind: "summary", payload: { summary: "First summary" }, sequence: 1 },
      { kind: "summary", payload: { summary: "Second summary" }, sequence: 2, runId: "r2" },
      { kind: "message", payload: createUserMessage("First"), sequence: 3, runId: "r1" },
      { kind: "message", payload: createUserMessage("Second"), sequence: 4, runId: "r2" },
    ]

    const messages = buildContextMessages(entries, { excludeRunId: "r2" })

    expect(messages.length).toBe(2)
    const first = messages[0]
    if (!first) throw new Error("Expected summary message")
    const summaryText = JSON.stringify(first.content)
    expect(summaryText).toContain("First summary")
    const second = messages[1]
    if (!second) throw new Error("Expected first user message")
    expect(second).toMatchObject({ role: "user" })
  })
})
