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
