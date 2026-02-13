import type { ToolExecutor } from "@bbot/adapters"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateTail,
} from "./truncate"

const bashSchema = Type.Object({
  command: Type.String({ description: "Command to run." }),
  args: Type.Optional(Type.Array(Type.String(), { description: "Command arguments." })),
  cwd: Type.Optional(Type.String({ description: "Optional workspace-relative cwd." })),
})

export type BashToolInput = Static<typeof bashSchema>

export interface BashToolDetails {
  truncation?: TruncationResult
}

export const createBashTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "bash",
    label: "bash",
    description: `Run a command in the workspace. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      const typed = params as BashToolInput
      const result = await executor.runCommand(typed, signal)

      const outputParts: string[] = []
      if (result.stdout) outputParts.push(result.stdout)
      if (result.stderr) outputParts.push(result.stderr)
      const combined = outputParts.join(result.stdout && result.stderr ? "\n" : "")

      const truncation = truncateTail(combined)
      let outputText = truncation.content || "(no output)"
      let details: BashToolDetails | undefined

      if (truncation.truncated) {
        details = { truncation }
        const startLine = truncation.totalLines - truncation.outputLines + 1
        const endLine = truncation.totalLines

        if (truncation.lastLinePartial) {
          const lastLine = combined.split("\n").pop() ?? ""
          const lastLineSize = formatSize(
            Buffer.byteLength(lastLine, "utf-8"),
          )
          outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}).]`
        } else if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}.]`
        } else {
          outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit).]`
        }
      }

      if (result.exitCode !== 0) {
        outputText += `\n\nCommand exited with code ${result.exitCode}`
        throw new Error(outputText)
      }

      return {
        content: [{ type: "text", text: outputText }],
        details,
      }
    },
  }
}
