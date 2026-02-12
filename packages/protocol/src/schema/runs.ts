import { z } from "zod"

import { dateTimeString, idParams } from "./common"

export const runIdParams = idParams

export type RunIdParams = z.infer<typeof runIdParams>

export const runStatus = z.enum(["queued", "running", "succeeded", "failed"])

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

export const userMessageKind = z.enum([
  "info",
  "progress",
  "result",
  "tool",
  "error",
])

export const userMessageResponse = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string().optional(),
  kind: userMessageKind,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: dateTimeString,
})

export const userMessageListResponse = z.array(userMessageResponse)
