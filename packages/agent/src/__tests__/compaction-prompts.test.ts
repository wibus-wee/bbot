import { describe, expect, it } from "vitest"

import {
  COMPACTION_SUMMARY_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  UPDATE_COMPACTION_SUMMARY_PROMPT,
} from "../compaction/prompts"

describe("compaction prompts", () => {
  it("includes required sections in the summary prompt", () => {
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Goal")
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Constraints & Preferences")
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Progress")
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Key Decisions")
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Next Steps")
    expect(COMPACTION_SUMMARY_PROMPT).toContain("## Critical Context")
  })

  it("includes required sections in the update prompt", () => {
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Goal")
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Constraints & Preferences")
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Progress")
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Key Decisions")
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Next Steps")
    expect(UPDATE_COMPACTION_SUMMARY_PROMPT).toContain("## Critical Context")
  })

  it("uses a strict system prompt for summarization", () => {
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain("ONLY output the structured summary")
  })
})
