import type { ToolExecutor } from "@bbot/adapters"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

const editSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to edit." }),
  patch: Type.String({ description: "Unified diff patch." }),
})

export type EditToolInput = Static<typeof editSchema>

export const createEditTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "edit",
    label: "edit",
    description: "Apply a unified diff patch to a file.",
    parameters: editSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as EditToolInput
      const result = await executor.editFile(typed)
      return {
        content: [
          { type: "text", text: `Patched ${result.path} (${result.bytes} bytes).` },
        ],
        details: result,
      }
    },
  }
}
