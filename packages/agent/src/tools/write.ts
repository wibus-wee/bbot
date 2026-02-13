import type { ToolExecutor } from "@bbot/adapters"
import { type Static, Type } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

const writeSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to write." }),
  content: Type.String({ description: "File contents to write." }),
})

export type WriteToolInput = Static<typeof writeSchema>

export const createWriteTool = (executor: ToolExecutor): AgentTool => {
  return {
    name: "write",
    label: "write",
    description: "Create or overwrite a file in the workspace.",
    parameters: writeSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as WriteToolInput
      const result = await executor.writeFile(typed)
      return {
        content: [
          { type: "text", text: `Wrote ${result.bytes} bytes to ${result.path}.` },
        ],
        details: result,
      }
    },
  }
}
