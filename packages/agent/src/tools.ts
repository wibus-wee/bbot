import { createToolExecutor } from "@bbot/adapters"
import { Type, type Static } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

export type ToolOptions = {
  workspaceRoot: string
}

const readSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to read." }),
})
type ReadParams = Static<typeof readSchema>

const writeSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to write." }),
  content: Type.String({ description: "File contents to write." }),
})
type WriteParams = Static<typeof writeSchema>

const editSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative path to edit." }),
  patch: Type.String({ description: "Unified diff patch." }),
})
type EditParams = Static<typeof editSchema>

const searchSchema = Type.Object({
  query: Type.String({ description: "Search query." }),
  path: Type.Optional(Type.String({ description: "Optional subdirectory to search." })),
  maxResults: Type.Optional(
    Type.Number({ description: "Maximum matches to return.", minimum: 1 }),
  ),
})
type SearchParams = Static<typeof searchSchema>

const bashSchema = Type.Object({
  command: Type.String({ description: "Command to run." }),
  args: Type.Optional(Type.Array(Type.String(), { description: "Command arguments." })),
  cwd: Type.Optional(Type.String({ description: "Optional workspace-relative cwd." })),
})
type BashParams = Static<typeof bashSchema>

export const createAgentTools = (options: ToolOptions): AgentTool[] => {
  const executor = createToolExecutor({
    rootPath: options.workspaceRoot,
  })

  const readTool: AgentTool = {
    name: "read",
    label: "Read File",
    description: "Read a file from the workspace.",
    parameters: readSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as ReadParams
      const result = await executor.readFile(typed)
      return {
        content: [{ type: "text", text: result.content }],
        details: { path: result.path, size: result.size },
      }
    },
  }

  const writeTool: AgentTool = {
    name: "write",
    label: "Write File",
    description: "Create or overwrite a file in the workspace.",
    parameters: writeSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as WriteParams
      const result = await executor.writeFile(typed)
      return {
        content: [
          { type: "text", text: `Wrote ${result.bytes} bytes to ${result.path}.` },
        ],
        details: result,
      }
    },
  }

  const editTool: AgentTool = {
    name: "edit",
    label: "Edit File",
    description: "Apply a unified diff patch to a file.",
    parameters: editSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as EditParams
      const result = await executor.editFile(typed)
      return {
        content: [
          { type: "text", text: `Patched ${result.path} (${result.bytes} bytes).` },
        ],
        details: result,
      }
    },
  }

  const searchTool: AgentTool = {
    name: "search",
    label: "Search Files",
    description: "Search the workspace with ripgrep.",
    parameters: searchSchema,
    execute: async (_toolCallId, params) => {
      const typed = params as SearchParams
      const result = await executor.searchFiles(typed)
      const lines = result.matches.trim()
      const matchCount = lines ? lines.split("\n").length : 0
      return {
        content: [{ type: "text", text: result.matches || "No matches." }],
        details: { matches: matchCount },
      }
    },
  }

  const bashTool: AgentTool = {
    name: "bash",
    label: "Run Command",
    description: "Run a command in the workspace.",
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      const typed = params as BashParams
      const result = await executor.runCommand(typed, signal)
      if (result.exitCode !== 0) {
        const output = [
          `Command failed: ${result.command}`,
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n")
        throw new Error(output)
      }
      return {
        content: [{ type: "text", text: result.stdout || "Command completed." }],
        details: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          command: result.command,
          args: result.args,
        },
      }
    },
  }

  return [readTool, writeTool, editTool, searchTool, bashTool]
}
