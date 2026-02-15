import { z } from "zod"

import { dateTimeString, idParams } from "./common"

export const runIdParams = idParams

export type RunIdParams = z.infer<typeof runIdParams>

export const runStatus = z.enum(["queued", "running", "succeeded", "failed", "canceled"])

export const runResponse = z.object({
  id: z.string(),
  sessionId: z.string(),
  prompt: z.string(),
  status: runStatus,
  summary: z.string().optional(),
  error: z.string().optional(),
  startedAt: dateTimeString.optional(),
  finishedAt: dateTimeString.optional(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const runListQuery = z.object({
  status: runStatus.optional(),
  sessionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const runListResponse = z.array(runResponse)

export const runTraceOrder = z.enum(["asc", "desc"])

export const runTraceQuery = z.object({
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  after: dateTimeString.optional(),
  before: dateTimeString.optional(),
  order: runTraceOrder.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export const recoveryRunResponse = z.object({
  runId: z.string(),
  sessionId: z.string(),
  status: runStatus,
  prompt: z.string(),
  chatId: z.string(),
})

export const recoveryRunListResponse = z.array(recoveryRunResponse)

export const runEventType = z.enum([
  "run.queued",
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "run.canceled",
  "tool.executed",
])

export const runEventResponse = z.object({
  id: z.string(),
  runId: z.string(),
  type: runEventType,
  message: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  timestamp: dateTimeString,
})

export const runEventListResponse = z.array(runEventResponse)

export const createRunEventBody = z.object({
  type: runEventType,
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const cancelRunBody = z.object({
  reason: z.string().optional(),
})

export type CancelRunBody = z.infer<typeof cancelRunBody>

export type CreateRunEventBody = z.infer<typeof createRunEventBody>

export const toolExecutionStatus = z.enum(["succeeded", "failed"])

export const toolExecutionResponse = z.object({
  id: z.string(),
  runId: z.string(),
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  status: toolExecutionStatus,
  error: z.string().optional(),
  startedAt: dateTimeString,
  endedAt: dateTimeString.optional(),
})

export const toolExecutionListResponse = z.array(toolExecutionResponse)

export const runStreamResponse = z.any().describe("text/event-stream")

export const sessionEntryKind = z.enum([
  "message",
  "action",
  "result",
  "summary",
  "system",
])

export const runSessionEntryResponse = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string().optional(),
  kind: sessionEntryKind,
  payload: z.unknown(),
  sequence: z.number().int(),
  timestamp: dateTimeString,
})

export type RunSessionEntryResponse = z.infer<typeof runSessionEntryResponse>

const runTraceItemBase = z.object({
  id: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  timestamp: dateTimeString,
})

export const runTraceItem = z.discriminatedUnion("kind", [
  runTraceItemBase.extend({
    kind: z.literal("run_event"),
    event: runEventResponse,
  }),
  runTraceItemBase.extend({
    kind: z.literal("tool_execution"),
    execution: toolExecutionResponse,
  }),
  runTraceItemBase.extend({
    kind: z.literal("session_entry"),
    entry: runSessionEntryResponse,
  }),
])

export type RunTraceItem = z.infer<typeof runTraceItem>

export const runTraceListResponse = z.array(runTraceItem)

export const runTraceStreamResponse = z.any().describe("text/event-stream")

export const runTraceStreamQuery = z.object({
  runId: z.string().optional(),
  sessionId: z.string().optional(),
})
