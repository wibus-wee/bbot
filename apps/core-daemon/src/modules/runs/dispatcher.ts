import PQueue from "p-queue"
import path from "path"

import type { Database } from "@bbot/database"
import { buildContextMessages, runAgent } from "@bbot/agent"
import type { AgentEvent, AgentMessage } from "@bbot/agent"

import { compactWorkspaceSession, getWorkspace } from "../workspaces/service"
import {
  createRunEvent,
  createSessionEntry,
  createToolExecution,
  getLatestSessionSummary,
  getRun,
  listRunsBySessionStatus,
  listSessionEntries,
  updateRunStatusIf,
} from "./service"
import { buildSearchTextFromMessage, buildToolResultMessage } from "./session-log"
import { resolveAgentRuntimeConfig } from "../agent-providers/runtime"

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const extractTotalTokens = (payload: unknown): number => {
  if (!isRecord(payload)) return 0
  if (payload.role !== "assistant") return 0
  const usage = isRecord(payload.usage) ? payload.usage : null
  if (!usage) return 0
  return toNumber(usage.totalTokens)
}

const sumUsageTokens = (entries: Array<{ payload: unknown }>) =>
  entries.reduce((sum, entry) => sum + extractTotalTokens(entry.payload), 0)

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
  private sessionQueues = new Map<string, PQueue>()
  private activeRuns = new Map<string, { abortController: AbortController; sessionId: string }>()
  private liveEvents = new Map<
    string,
    { seq: number; events: Array<{ seq: number; type: string; message: string; timestamp: Date }> }
  >()

  constructor(
    private db: Database,
    options: RunDispatcherOptions = {},
  ) {
    void options
    this.defaultConcurrency = 1
  }

  private defaultConcurrency: number

  private getSessionQueue(sessionId: string) {
    const existing = this.sessionQueues.get(sessionId)
    if (existing) return existing
    const queue = new PQueue({ concurrency: this.defaultConcurrency })
    this.sessionQueues.set(sessionId, queue)
    return queue
  }

  enqueue(runId: string, sessionId: string) {
    const queue = this.getSessionQueue(sessionId)
    void queue.add(async () => {
      await this.execute(runId)
    })
    void queue.onIdle().then(() => {
      if (queue.size === 0 && queue.pending === 0) {
        if (this.sessionQueues.get(sessionId) === queue) {
          this.sessionQueues.delete(sessionId)
        }
      }
    })
  }

  listLiveEvents(runId: string, afterSeq: number) {
    const state = this.liveEvents.get(runId)
    if (!state) return []
    const events = state.events.filter((event) => event.seq > afterSeq)
    if (afterSeq > 0) {
      state.events = state.events.filter((event) => event.seq > afterSeq)
    }
    return events
  }

  private pushLiveEvent(runId: string, input: { type: string; message: string; timestamp: Date }) {
    const state = this.liveEvents.get(runId) ?? { seq: 0, events: [] }
    const nextSeq = state.seq + 1
    state.seq = nextSeq
    state.events.push({ ...input, seq: nextSeq })
    if (state.events.length > 500) {
      state.events.splice(0, state.events.length - 500)
    }
    this.liveEvents.set(runId, state)
  }

  async cancelRun(runId: string, reason = "user") {
    const run = await getRun(this.db, runId)
    if (!run) return null

    const now = new Date()
    const updated = await updateRunStatusIf(this.db, runId, ["queued", "running"], {
      status: "canceled",
      summary: "Run canceled",
      finishedAt: now,
      updatedAt: now,
    })

    const active = this.activeRuns.get(runId)
    if (active) {
      active.abortController.abort()
    }
    if (updated) {
      await createRunEvent(this.db, runId, {
        type: "run.canceled",
        message: "Run canceled",
        payload: { reason },
      })
      return updated
    }

    const latest = await getRun(this.db, runId)
    return latest ?? run
  }

  async cancelRunsForSession(sessionId: string, reason = "superseded") {
    const runs = await listRunsBySessionStatus(this.db, {
      sessionId,
      statuses: ["queued", "running"],
    })
    await Promise.all(runs.map((run) => this.cancelRun(run.id, reason)))
  }

  private async execute(runId: string) {
    const run = await getRun(this.db, runId)
    if (!run || run.status !== "queued") {
      return
    }

    const now = new Date()
    const running = await updateRunStatusIf(this.db, runId, ["queued"], {
      status: "running",
      startedAt: now,
      updatedAt: now,
    })
    if (!running) {
      return
    }
    const activeRun = running

    await createRunEvent(this.db, runId, {
      type: "run.started",
      message: "Run started",
    })

    await createRunEvent(this.db, runId, {
      type: "run.progress",
      message: "Agent starting",
    })

    const workspace = await getWorkspace(this.db, activeRun.sessionId)
    const workspaceRoot = workspace?.rootPath ?? path.resolve(process.cwd(), '..', '..')

    const toolStarts = new Map<string, ToolStart>()
    const eventQueue = new PQueue({ concurrency: 1 })
    let lastAssistantMessage = ""
    let lastAssistantError = ""
    let thinkingBuffer = ""
    const abortController = new AbortController()
    this.activeRuns.set(runId, { abortController, sessionId: activeRun.sessionId })

    const handleEvent = async (event: AgentEvent) => {
      switch (event.type) {
        case "message_end": {
          lastAssistantMessage = extractAssistantText(event.message) || lastAssistantMessage
          if (
            event.message &&
            typeof event.message === "object" &&
            "role" in event.message &&
            event.message.role === "assistant" &&
            "errorMessage" in event.message &&
            typeof event.message.errorMessage === "string" &&
            event.message.errorMessage.trim()
          ) {
            lastAssistantError = event.message.errorMessage.trim()
          }
          if (event.message) {
            await createSessionEntry(this.db, {
              sessionId: activeRun.sessionId,
              runId,
              kind: "message",
              payload: event.message,
              searchText: buildSearchTextFromMessage(event.message),
              timestamp: new Date(),
            })
          }
          break
        }
        case "message_update": {
          const update = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
            .assistantMessageEvent
          if (!update) break
          if (update.type === "text_delta" && typeof update.delta === "string") {
            if (update.delta) {
              this.pushLiveEvent(runId, {
                type: "assistant.delta",
                message: update.delta,
                timestamp: new Date(),
              })
            }
            break
          }
          if (update.type === "thinking_start") {
            thinkingBuffer = ""
            this.pushLiveEvent(runId, {
              type: "assistant.thinking_start",
              message: "",
              timestamp: new Date(),
            })
            break
          }
          if (update.type === "thinking_delta" && typeof update.delta === "string") {
            if (update.delta) {
              thinkingBuffer += update.delta
              this.pushLiveEvent(runId, {
                type: "assistant.thinking_delta",
                message: update.delta,
                timestamp: new Date(),
              })
            }
            break
          }
          if (update.type === "thinking_end") {
            const trimmed = thinkingBuffer.trim()
            if (trimmed) {
              this.pushLiveEvent(runId, {
                type: "assistant.thinking",
                message: trimmed,
                timestamp: new Date(),
              })
            }
            thinkingBuffer = ""
          }
          break
        }
        case "turn_end": {
          lastAssistantMessage =
            extractAssistantText(event.message) || lastAssistantMessage
          break
        }
        case "tool_execution_start": {
          const startedAt = new Date()
          const args = event.args ?? {}
          toolStarts.set(event.toolCallId, {
            toolName: event.toolName,
            args,
            startedAt,
          })
          await createSessionEntry(this.db, {
            sessionId: activeRun.sessionId,
            runId,
            kind: "action",
            payload: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args,
              startedAt: startedAt.toISOString(),
            },
            timestamp: startedAt,
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

          const toolResultMessage = buildToolResultMessage({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
          })

          await createSessionEntry(this.db, {
            sessionId: activeRun.sessionId,
            runId,
            kind: "message",
            payload: toolResultMessage,
            searchText: buildSearchTextFromMessage(toolResultMessage),
            timestamp: endedAt,
          })

          await createSessionEntry(this.db, {
            sessionId: activeRun.sessionId,
            runId,
            kind: "result",
            payload: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args,
              result: event.result,
              isError: event.isError,
              error: errorText,
              startedAt: startedAt.toISOString(),
              endedAt: endedAt.toISOString(),
            },
            timestamp: endedAt,
          })
          break
        }
        default:
          break
      }
    }

    try {
      const config = await resolveAgentRuntimeConfig(this.db, {
        sessionId: activeRun.sessionId,
      })
      let summaryEntry = await getLatestSessionSummary(
        this.db,
        activeRun.sessionId,
        runId,
      )
      let afterSequence =
        summaryEntry && typeof summaryEntry.sequence === "number"
          ? summaryEntry.sequence
          : undefined
      let messageEntries = await listSessionEntries(this.db, {
        sessionId: activeRun.sessionId,
        kinds: ["message"],
        excludeRunId: runId,
        afterSequence,
      })

      const autoCompactTokenLimit = config.compaction.autoCompactTokenLimit
      const shouldAutoCompact =
        config.compaction.enabled &&
        typeof autoCompactTokenLimit === "number" &&
        autoCompactTokenLimit > 0 &&
        sumUsageTokens(messageEntries) >= autoCompactTokenLimit

      if (shouldAutoCompact) {
        const result = await compactWorkspaceSession(this.db, {
          sessionId: activeRun.sessionId,
        })

        if (result.didCompact) {
          summaryEntry = await getLatestSessionSummary(
            this.db,
            activeRun.sessionId,
            runId,
          )
          afterSequence =
            summaryEntry && typeof summaryEntry.sequence === "number"
              ? summaryEntry.sequence
              : undefined
          messageEntries = await listSessionEntries(this.db, {
            sessionId: activeRun.sessionId,
            kinds: ["message"],
            excludeRunId: runId,
            afterSequence,
          })
        }
      }

      const contextEntries = summaryEntry
        ? [summaryEntry, ...messageEntries]
        : messageEntries
      const contextMessages = buildContextMessages(contextEntries, { excludeRunId: runId })

      const agentResult = await runAgent({
        prompt: activeRun.prompt,
        workspaceRoot,
        sessionId: activeRun.sessionId,
        config,
        contextMessages,
        abortSignal: abortController.signal,
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

      const latest = await getRun(this.db, runId)
      if (!latest || latest.status === "canceled") {
        return
      }

      const agentError = (agentResult.state.error ?? lastAssistantError).trim()
      if (agentError) {
        const finishedAt = new Date()
        const summary = summarize(agentError) || "Run failed"
        const updated = await updateRunStatusIf(this.db, runId, ["running"], {
          status: "failed",
          error: agentError,
          summary,
          finishedAt,
          updatedAt: finishedAt,
        })

        if (updated) {
          await createRunEvent(this.db, runId, {
            type: "run.failed",
            message: `Run failed: ${summary}`,
          })
        }
        return
      }

      const summary = summarize(lastAssistantMessage) || "Run completed"
      const finishedAt = new Date()

      const updated = await updateRunStatusIf(this.db, runId, ["running"], {
        status: "succeeded",
        summary,
        finishedAt,
        updatedAt: finishedAt,
      })

      if (updated) {
        await createRunEvent(this.db, runId, {
          type: "run.completed",
          message: `Run completed: ${summary}`,
        })
      }
    } catch (error) {
      await eventQueue.onIdle()
      const latest = await getRun(this.db, runId)
      if (latest?.status === "canceled") {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()

      const updated = await updateRunStatusIf(this.db, runId, ["running"], {
        status: "failed",
        error: message,
        finishedAt,
        updatedAt: finishedAt,
      })

      if (updated) {
        await createRunEvent(this.db, runId, {
          type: "run.failed",
          message: `Run failed: ${message}`,
        })
      }
    } finally {
      this.activeRuns.delete(runId)
    }
  }
}
