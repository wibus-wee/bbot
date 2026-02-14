import type { ToolExecutor } from "./runner"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

const editSchema = Type.Object({
  patch: Type.String({
    description: "apply_patch formatted patch content.",
  }),
})

export type EditToolInput = Static<typeof editSchema>

export const createEditTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "edit",
    label: "edit",
    description: "Apply an apply_patch formatted patch to files.",
    parameters: editSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as EditToolInput
      const result = await executor.editFile(typed)
      const summaryLines: string[] = []
      for (const path of result.added) {
        summaryLines.push(`A ${path}`)
      }
      for (const path of result.modified) {
        summaryLines.push(`M ${path}`)
      }
      for (const path of result.deleted) {
        summaryLines.push(`D ${path}`)
      }
      const summary =
        summaryLines.length > 0
          ? `Success. Updated the following files:\n${summaryLines.join("\n")}`
          : "No files were modified."
      return {
        content: [
          { type: "text", text: summary },
        ],
        details: result,
      }
    },
  }
}
