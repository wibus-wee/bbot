import type { ToolExecutor } from "./runner"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import {
  DEFAULT_MAX_BYTES,
  GREP_MAX_LINE_LENGTH,
  formatSize,
  type TruncationResult,
  truncateHead,
  truncateLine,
} from "./truncate"

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)." }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: workspace root)." }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'." }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)." }),
  ),
  literal: Type.Optional(
    Type.Boolean({ description: "Treat pattern as literal string instead of regex." }),
  ),
  context: Type.Optional(
    Type.Number({ description: "Number of lines to show before and after each match." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return." }),
  ),
})

export type GrepToolInput = Static<typeof grepSchema>

export interface GrepToolDetails {
  truncation?: TruncationResult
  linesTruncated?: boolean
}

export const createGrepTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Output is truncated to ${DEFAULT_MAX_BYTES / 1024}KB.`,
    parameters: grepSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as GrepToolInput
      const result = await executor.grepFiles(typed)
      const rawMatches = result.matches.trim()

      if (!rawMatches) {
        return { content: [{ type: "text", text: "No matches." }], details: undefined }
      }

      let linesTruncated = false
      const processedLines = rawMatches.split("\n").map((line) => {
        const { text, wasTruncated } = truncateLine(line)
        if (wasTruncated) linesTruncated = true
        return text
      })

      const rawOutput = processedLines.join("\n")
      const truncation = truncateHead(rawOutput)

      let output = truncation.content
      const details: GrepToolDetails = {}
      const notices: string[] = []

      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
        details.truncation = truncation
      }

      if (linesTruncated) {
        notices.push(
          `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
        )
        details.linesTruncated = true
      }

      if (notices.length > 0) {
        output += `\n\n[${notices.join(". ")}]`
      }

      return {
        content: [{ type: "text", text: output }],
        details: Object.keys(details).length > 0 ? details : undefined,
      }
    },
  }
}
