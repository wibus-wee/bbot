import { createId } from "@bbot/shared"
import type {
  Run,
  RunEvent,
  RunEventType,
  ToolExecution,
  WorkspaceSession,
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
  private sessions = new Map<string, WorkspaceSession>()
  private runs = new Map<string, Run>()
  private runEvents = new Map<string, RunEvent[]>()
  private toolExecutions = new Map<string, ToolExecution[]>()

  reset() {
    this.sessions.clear()
    this.runs.clear()
    this.runEvents.clear()
    this.toolExecutions.clear()
  }

  createWorkspaceSession(input: CreateSessionInput) {
    const now = Date.now()
    const session: WorkspaceSession = {
      id: createId("workspace"),
      name: input.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }

    this.sessions.set(session.id, session)
    return { session }
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
    return { run }
  }

  startRun(runId: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = {
      ...run,
      status: "running",
      startedAt: now,
      updatedAt: now,
    }
    this.runs.set(runId, updated)

    const startedEvent = this.addRunEvent(runId, "run.started", "Run started")
    const progressEvent = this.addRunEvent(runId, "run.progress", "Preparing environment")

    return { run: updated, events: [startedEvent, progressEvent] }
  }

  completeRun(runId: string, summary: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = {
      ...run,
      status: "succeeded",
      summary,
      finishedAt: now,
      updatedAt: now,
    }
    this.runs.set(runId, updated)

    this.addRunEvent(runId, "run.completed", `Run completed: ${summary}`)
    return { run: updated }
  }

  failRun(runId: string, reason: string) {
    const run = this.getRunOrThrow(runId)
    const now = Date.now()
    const updated: Run = {
      ...run,
      status: "failed",
      error: reason,
      finishedAt: now,
      updatedAt: now,
    }
    this.runs.set(runId, updated)

    this.addRunEvent(runId, "run.failed", `Run failed: ${reason}`)
    return { run: updated }
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
      status: "succeeded",
      startedAt: now,
      endedAt: now,
    }

    const list = this.toolExecutions.get(runId) ?? []
    list.push(execution)
    this.toolExecutions.set(runId, list)

    const path = typeof input.input.path === "string" ? input.input.path : undefined
    const detail = path ? ` (${path})` : ""
    const event = this.addRunEvent(runId, "tool.executed", `Tool executed: ${input.tool}${detail}`)

    return { execution, event }
  }

  getWorkspaceSession(sessionId: string) {
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

  archiveWorkspaceSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const now = Date.now()
    const updated: WorkspaceSession = { ...session, status: "archived", updatedAt: now }
    this.sessions.set(sessionId, updated)
  }

  private addRunEvent(
    runId: string,
    type: RunEventType,
    message: string,
    payload?: Record<string, unknown>,
  ) {
    const now = Date.now()
    const event: RunEvent = {
      id: createId("event"),
      runId,
      type,
      message,
      payload,
      timestamp: now,
    }
    const list = this.runEvents.get(runId) ?? []
    list.push(event)
    this.runEvents.set(runId, list)
    return event
  }

  private getRunOrThrow(runId: string) {
    const run = this.runs.get(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }
}
