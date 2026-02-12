export type WorkspaceSessionStatus = "active" | "archived"

export type RunStatus = "queued" | "running" | "succeeded" | "failed"

export type ToolExecutionStatus = "succeeded" | "failed"

export type RunEventType =
  | "run.queued"
  | "run.started"
  | "run.progress"
  | "run.completed"
  | "run.failed"
  | "tool.executed"

export type UserMessageKind = "info" | "progress" | "result" | "tool" | "error"

export interface WorkspaceSession {
  id: string
  name: string
  status: WorkspaceSessionStatus
  rootPath?: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface Run {
  id: string
  sessionId: string
  prompt: string
  status: RunStatus
  summary?: string
  error?: string
  startedAt?: number
  finishedAt?: number
  createdAt: number
  updatedAt: number
}

export interface RunEvent {
  id: string
  runId: string
  type: RunEventType
  message: string
  payload?: Record<string, unknown>
  timestamp: number
}

export interface ToolExecution {
  id: string
  runId: string
  tool: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  status?: ToolExecutionStatus
  error?: string
  startedAt: number
  endedAt?: number
}

export interface UserMessage {
  id: string
  sessionId: string
  runId?: string
  kind: UserMessageKind
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}
