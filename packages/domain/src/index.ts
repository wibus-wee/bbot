export type DemoSessionStatus = "active" | "archived"

export type RunStatus = "queued" | "running" | "succeeded" | "failed"

export type RunEventType =
  | "run.queued"
  | "run.started"
  | "run.progress"
  | "run.completed"
  | "run.failed"
  | "tool.executed"

export type UserMessageKind = "info" | "progress" | "result" | "tool" | "error"

export interface DemoSession {
  id: string
  name: string
  status: DemoSessionStatus
  createdAt: number
  updatedAt: number
}

export interface Run {
  id: string
  sessionId: string
  prompt: string
  status: RunStatus
  summary?: string
  createdAt: number
  updatedAt: number
}

export interface RunEvent {
  id: string
  runId: string
  type: RunEventType
  message: string
  timestamp: number
}

export interface ToolExecution {
  id: string
  runId: string
  tool: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  timestamp: number
}

export interface UserMessage {
  id: string
  sessionId: string
  runId?: string
  kind: UserMessageKind
  content: string
  timestamp: number
}
