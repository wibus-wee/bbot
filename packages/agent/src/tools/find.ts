import type { ToolExecutor } from "@bbot/adapters"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./truncate"

const findSchema = Type.Object({
  pattern: Type.String({
    description:
      "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'.",
  }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: workspace root)." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of results (default: 1000)." }),
  ),
})

export type FindToolInput = Static<typeof findSchema>

const DEFAULT_LIMIT = 1000

export interface FindToolDetails {
  truncation?: TruncationResult
  resultLimitReached?: number
}

export const createFindTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching file paths. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as FindToolInput
      const result = await executor.findFiles(typed)
      const rawMatches = result.matches.trim()

      if (!rawMatches) {
        return {
          content: [{ type: "text", text: "No files found matching pattern." }],
          details: undefined,
        }
      }

      const rawLines = rawMatches.split("\n")
      const searchDir = typed.path
        ? typed.path.replace(/^[.][\\/]/, "").replace(/\/+$/, "")
        : undefined

      const normalized = searchDir
        ? rawLines.map((line) =>
            line.startsWith(`${searchDir}/`) || line.startsWith(`${searchDir}\\`)
              ? line.slice(searchDir.length + 1)
              : line,
          )
        : rawLines

      const effectiveLimit = typed.limit ?? DEFAULT_LIMIT
      const limited = normalized.slice(0, effectiveLimit)
      const limitReached = normalized.length > effectiveLimit

      const rawOutput = limited.join("\n")
      const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER })

      let output = truncation.content
      const details: FindToolDetails = {}
      const notices: string[] = []

      if (limitReached) {
        notices.push(
          `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more`,
        )
        details.resultLimitReached = effectiveLimit
      }

      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
        details.truncation = truncation
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
