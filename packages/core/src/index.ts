import { createId } from "@bbot/shared"
import type {
  DemoSession,
  Run,
  RunEvent,
  RunEventType,
  ToolExecution,
  UserMessage,
  UserMessageKind,
} from "@bbot/domain"

type CreateSessionInput = {
  name: string
}

type RequestRunInput = {
  sessionId: string
  prompt: string
}

type ToolExecutionInput = {
  tool: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}

export class Core {
  private sessions = new Map<string, DemoSession>()
  private runs = new Map<string, Run>()
  private runEvents = new Map<string, RunEvent[]>()
  private toolExecutions = new Map<string, ToolExecution[]>()
  private messages: UserMessage[] = []

  reset() {
    this.sessions.clear()
    this.runs.clear()
    this.runEvents.clear()
    this.toolExecutions.clear()
    this.messages = []
  }

  createDemoSession(input: CreateSessionInput) {
    const now = Date.now()
    const session: DemoSession = {
      id: createId("session"),
      name: input.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }

    this.sessions.set(session.id, session)

    const message = this.addMessage({
      sessionId: session.id,
      kind: "info",
      content: `Session created: ${session.name} (${session.id})`,
    })

    return { session, message }
  }

  requestRun(input: RequestRunInput) {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`)
    }

    const now = Date.now()
    const run: Run = {
      id: createId("run"),
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    }

    this.runs.set(run.id, run)
    this.addRunEvent(run.id, "run.queued", "Run queued")

    const message = this.addMessage({
      sessionId: input.sessionId,
      runId: run.id,
      kind: "info",
      content: `Run queued: ${run.id}`,
    })

    return { run, message }
  }

  startRun(runId: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = { ...run, status: "running", updatedAt: now }
    this.runs.set(runId, updated)

    const startedEvent = this.addRunEvent(runId, "run.started", "Run started")
    const progressEvent = this.addRunEvent(runId, "run.progress", "Preparing environment")

    const message = this.addMessage({
      sessionId: updated.sessionId,
      runId,
      kind: "progress",
      content: "Run is now running. Preparing environment.",
    })

    return { run: updated, events: [startedEvent, progressEvent], message }
  }

  completeRun(runId: string, summary: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = {
      ...run,
      status: "succeeded",
      summary,
      updatedAt: now,
    }
    this.runs.set(runId, updated)

    this.addRunEvent(runId, "run.completed", `Run completed: ${summary}`)

    const message = this.addMessage({
      sessionId: updated.sessionId,
      runId,
      kind: "result",
      content: `Run completed: ${summary}`,
    })

    return { run: updated, message }
  }

  failRun(runId: string, reason: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = {
      ...run,
      status: "failed",
      summary: reason,
      updatedAt: now,
    }
    this.runs.set(runId, updated)

    this.addRunEvent(runId, "run.failed", `Run failed: ${reason}`)

    const message = this.addMessage({
      sessionId: updated.sessionId,
      runId,
      kind: "error",
      content: `Run failed: ${reason}`,
    })

    return { run: updated, message }
  }

  recordToolExecution(runId: string, input: ToolExecutionInput) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const execution: ToolExecution = {
      id: createId("tool"),
      runId,
      tool: input.tool,
      input: input.input,
      output: input.output,
      timestamp: now,
    }

    const list = this.toolExecutions.get(runId) ?? []
    list.push(execution)
    this.toolExecutions.set(runId, list)

    const path = typeof input.input.path === "string" ? input.input.path : undefined
    const detail = path ? ` (${path})` : ""
    const event = this.addRunEvent(runId, "tool.executed", `Tool executed: ${input.tool}${detail}`)

    const message = this.addMessage({
      sessionId: run.sessionId,
      runId,
      kind: "tool",
      content: `Tool executed: ${input.tool}${detail}`,
    })

    return { execution, event, message }
  }

  getDemoSession(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  getRun(runId: string) {
    return this.runs.get(runId)
  }

  getRunEvents(runId: string) {
    return this.runEvents.get(runId) ?? []
  }

  getToolExecutions(runId: string) {
    return this.toolExecutions.get(runId) ?? []
  }

  getMessages(filter?: { sessionId?: string; runId?: string; kind?: UserMessageKind }) {
    return this.messages.filter((message) => {
      if (filter?.sessionId && message.sessionId !== filter.sessionId) {
        return false
      }
      if (filter?.runId && message.runId !== filter.runId) {
        return false
      }
      if (filter?.kind && message.kind !== filter.kind) {
        return false
      }
      return true
    })
  }

  archiveSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const now = Date.now()
    const updated: DemoSession = { ...session, status: "archived", updatedAt: now }
    this.sessions.set(sessionId, updated)
  }

  private addRunEvent(runId: string, type: RunEventType, message: string) {
    const now = Date.now()
    const event: RunEvent = {
      id: createId("event"),
      runId,
      type,
      message,
      timestamp: now,
    }
    const list = this.runEvents.get(runId) ?? []
    list.push(event)
    this.runEvents.set(runId, list)
    return event
  }

  private addMessage(input: {
    sessionId: string
    runId?: string
    kind: UserMessageKind
    content: string
  }) {
    const message: UserMessage = {
      id: createId("msg"),
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.kind,
      content: input.content,
      timestamp: Date.now(),
    }
    this.messages.push(message)
    return message
  }

  private getRunOrThrow(runId: string) {
    const run = this.runs.get(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }
}
