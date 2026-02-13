export type WorkspaceSessionStatus = "active" | "archived"

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

export type ToolExecutionStatus = "succeeded" | "failed"

export type RunEventType =
  | "run.queued"
  | "run.started"
  | "run.progress"
  | "run.completed"
  | "run.failed"
  | "run.canceled"
  | "tool.executed"

export type SessionEntryKind =
  | "message"
  | "action"
  | "result"
  | "summary"
  | "system"

export interface WorkspaceSession {
  id: string
  name: string
  status: WorkspaceSessionStatus
  rootPath?: string
  telegramChatId?: string
  telegramUserId?: string
  forkedFromSessionId?: string
  metadata?: Record<string, unknown>
  accessedAt?: number
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

export interface SessionEntry {
  id: string
  sessionId: string
  runId?: string
  kind: SessionEntryKind
  payload: unknown
  searchText?: string
  timestamp: number
  sequence: number
}
