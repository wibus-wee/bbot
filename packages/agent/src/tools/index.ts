import { createToolExecutor } from "@bbot/adapters"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import { createBashTool } from "./bash"
import { createEditTool } from "./edit"
import { createFindTool } from "./find"
import { createGrepTool } from "./grep"
import { createLsTool } from "./ls"
import { createReadTool } from "./read"
import { createWriteTool } from "./write"

export type ToolOptions = {
  workspaceRoot: string
}

export const createAgentTools = (options: ToolOptions): AgentTool[] => {
  const executor = createToolExecutor({ rootPath: options.workspaceRoot })

  return [
    createReadTool(executor),
    createWriteTool(executor),
    createEditTool(executor),
    createGrepTool(executor),
    createFindTool(executor),
    createLsTool(executor),
    createBashTool(executor),
  ]
}
