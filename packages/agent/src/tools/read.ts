import type { ToolExecutor } from "./runner"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "./truncate"

const readSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to read." }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to read." }),
  ),
})

export type ReadToolInput = Static<typeof readSchema>

export interface ReadToolDetails {
  truncation?: TruncationResult
}

export const createReadTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "read",
    label: "read",
    description: `Read a file from the workspace. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit to page through large files.`,
    parameters: readSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as ReadToolInput
      const result = await executor.readFile({ path: typed.path })

      if (!result.content) {
        return { content: [{ type: "text", text: "(empty file)" }], details: undefined }
      }

      const allLines = result.content.split("\n")
      const totalFileLines = allLines.length

      const startLine = typed.offset ? Math.max(0, typed.offset - 1) : 0
      const startLineDisplay = startLine + 1

      if (startLine >= allLines.length) {
        throw new Error(
          `Offset ${typed.offset} is beyond end of file (${allLines.length} lines total)`,
        )
      }

      let selectedContent = ""
      let userLimitedLines: number | undefined

      if (typed.limit !== undefined) {
        const endLine = Math.min(startLine + typed.limit, allLines.length)
        selectedContent = allLines.slice(startLine, endLine).join("\n")
        userLimitedLines = endLine - startLine
      } else {
        selectedContent = allLines.slice(startLine).join("\n")
      }

      const truncation = truncateHead(selectedContent)
      let outputText = ""
      let details: ReadToolDetails | undefined

      if (truncation.firstLineExceedsLimit) {
        const firstLineSize = formatSize(
          Buffer.byteLength(allLines[startLine] ?? "", "utf-8"),
        )
        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${typed.path} | head -c ${DEFAULT_MAX_BYTES}]`
        details = { truncation }
      } else if (truncation.truncated) {
        const endLineDisplay = startLineDisplay + truncation.outputLines - 1
        const nextOffset = endLineDisplay + 1

        outputText = truncation.content

        if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`
        } else {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`
        }

        details = { truncation }
      } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
        const remaining = allLines.length - (startLine + userLimitedLines)
        const nextOffset = startLine + userLimitedLines + 1

        outputText = truncation.content
        outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
      } else {
        outputText = truncation.content
      }

      if (!outputText) {
        outputText = "(empty file)"
      }

      return {
        content: [{ type: "text", text: outputText }],
        details,
      }
    },
  }
}
