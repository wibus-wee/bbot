import type { ToolExecutor } from "@bbot/adapters"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./truncate"

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Directory to list (default: workspace root)." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of entries to return (default: 500)." }),
  ),
})

export type LsToolInput = Static<typeof lsSchema>

const DEFAULT_LIMIT = 500

export interface LsToolDetails {
  truncation?: TruncationResult
  entryLimitReached?: number
}

export const createLsTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "ls",
    label: "ls",
    description: `List directory contents. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: lsSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as LsToolInput
      const result = await executor.listDir(typed)

      if (result.entries.length === 0) {
        return { content: [{ type: "text", text: "(empty directory)" }], details: undefined }
      }

      const effectiveLimit = typed.limit ?? DEFAULT_LIMIT
      const limited = result.entries.slice(0, effectiveLimit)
      const limitReached = result.entries.length > effectiveLimit

      const rawOutput = limited.join("\n")
      const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER })

      let output = truncation.content
      const details: LsToolDetails = {}
      const notices: string[] = []

      if (limitReached) {
        notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`)
        details.entryLimitReached = effectiveLimit
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
