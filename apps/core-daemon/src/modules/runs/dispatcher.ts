import PQueue from "p-queue"

import type { Database } from "@bbot/database"
import { loadAgentConfig, runAgent } from "@bbot/agent"
import type { AgentEvent, AgentMessage } from "@bbot/agent"

import { getWorkspace } from "../workspaces/service"
import { createRunEvent, createToolExecution, getRun, updateRun } from "./service"

type RunDispatcherOptions = {
  concurrency?: number
}

type ToolStart = {
  toolName: string
  args: Record<string, unknown>
  startedAt: Date
}

const extractText = (content: Array<{ type: string; text?: string }> | undefined) => {
  if (!content) return ""
  return content
    .map((item) => (item.type === "text" ? item.text ?? "" : ""))
    .join("")
    .trim()
}

const extractAssistantText = (message: AgentMessage | undefined) => {
  if (!message || typeof message !== "object") return ""
  if (!("role" in message) || message.role !== "assistant") return ""
  if (!("content" in message)) return ""
  const content = Array.isArray(message.content) ? message.content : []
  return extractText(content as Array<{ type: string; text?: string }>)
}

const summarize = (text: string, max = 200) => {
  const trimmed = text.trim()
  if (!trimmed) return ""
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

const toolDetail = (toolName: string, args?: Record<string, unknown>) => {
  if (!args) return ""
  if (["read", "write", "edit"].includes(toolName) && typeof args.path === "string") {
    return args.path
  }
  if (toolName === "search" && typeof args.query === "string") {
    return args.query
  }
  if (toolName === "bash" && typeof args.command === "string") {
    return args.command
  }
  return ""
}

export class RunDispatcher {
  private queue: PQueue

  constructor(
    private db: Database,
    options: RunDispatcherOptions = {},
  ) {
    this.queue = new PQueue({ concurrency: options.concurrency ?? 1 })
  }

  enqueue(runId: string) {
    void this.queue.add(async () => {
      await this.execute(runId)
    })
  }

  private async execute(runId: string) {
    const run = await getRun(this.db, runId)
    if (!run || run.status !== "queued") {
      return
    }

    const now = new Date()
    await updateRun(this.db, runId, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    })

    await createRunEvent(this.db, runId, {
      type: "run.started",
      message: "Run started",
    })

    await createRunEvent(this.db, runId, {
      type: "run.progress",
      message: "Agent starting",
    })

    const workspace = await getWorkspace(this.db, run.sessionId)
    const workspaceRoot = workspace?.rootPath ?? process.cwd()

    const toolStarts = new Map<string, ToolStart>()
    const eventQueue = new PQueue({ concurrency: 1 })
    let lastAssistantMessage = ""

    const handleEvent = async (event: AgentEvent) => {
      switch (event.type) {
        case "message_end": {
          lastAssistantMessage = extractAssistantText(event.message) || lastAssistantMessage
          break
        }
        case "turn_end": {
          lastAssistantMessage =
            extractAssistantText(event.message) || lastAssistantMessage
          break
        }
        case "tool_execution_start": {
          toolStarts.set(event.toolCallId, {
            toolName: event.toolName,
            args: event.args ?? {},
            startedAt: new Date(),
          })
          break
        }
        case "tool_execution_end": {
          const start = toolStarts.get(event.toolCallId)
          const args = start?.args ?? {}
          const startedAt = start?.startedAt ?? new Date()
          const endedAt = new Date()
          toolStarts.delete(event.toolCallId)
          const errorText = event.isError
            ? extractText(event.result?.content)
            : undefined

          await createToolExecution(this.db, {
            runId,
            tool: event.toolName,
            input: {
              toolCallId: event.toolCallId,
              args,
            },
            output: {
              result: event.result,
            },
            status: event.isError ? "failed" : "succeeded",
            error: errorText,
            startedAt,
            endedAt,
          })

          const detail = toolDetail(event.toolName, args)
          const message = detail
            ? `Tool executed: ${event.toolName} (${detail})`
            : `Tool executed: ${event.toolName}`

          await createRunEvent(this.db, runId, {
            type: "tool.executed",
            message,
            payload: {
              tool: event.toolName,
              toolCallId: event.toolCallId,
              args,
              isError: event.isError,
            },
          })
          break
        }
        default:
          break
      }
    }

    try {
      const config = loadAgentConfig()
      await runAgent({
        prompt: run.prompt,
        workspaceRoot,
        sessionId: run.sessionId,
        config,
        onEvent: (event) => {
          void eventQueue.add(async () => {
            try {
              await handleEvent(event)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              console.error(`[run:${runId}] event handling failed: ${message}`)
            }
          })
        },
      })

      await eventQueue.onIdle()

      const summary = summarize(lastAssistantMessage) || "Run completed"
      const finishedAt = new Date()

      await updateRun(this.db, runId, {
        status: "succeeded",
        summary,
        finishedAt,
        updatedAt: finishedAt,
      })

      await createRunEvent(this.db, runId, {
        type: "run.completed",
        message: `Run completed: ${summary}`,
      })
    } catch (error) {
      await eventQueue.onIdle()
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()

      await updateRun(this.db, runId, {
        status: "failed",
        error: message,
        finishedAt,
        updatedAt: finishedAt,
      })

      await createRunEvent(this.db, runId, {
        type: "run.failed",
        message: `Run failed: ${message}`,
      })
    }
  }
}
