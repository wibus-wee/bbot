import { t } from "elysia"

import { dateTimeString, idParams } from "../shared/model"

export const runIdParams = idParams

export type RunIdParams = typeof runIdParams.static

export const runStatus = t.Union([
  t.Literal("queued"),
  t.Literal("running"),
  t.Literal("succeeded"),
  t.Literal("failed"),
])

export const runResponse = t.Object({
  id: t.String(),
  sessionId: t.String(),
  prompt: t.String(),
  status: runStatus,
  summary: t.Optional(t.String()),
  error: t.Optional(t.String()),
  startedAt: t.Optional(dateTimeString),
  finishedAt: t.Optional(dateTimeString),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const runEventType = t.Union([
  t.Literal("run.queued"),
  t.Literal("run.started"),
  t.Literal("run.progress"),
  t.Literal("run.completed"),
  t.Literal("run.failed"),
  t.Literal("tool.executed"),
])

export const runEventResponse = t.Object({
  id: t.String(),
  runId: t.String(),
  type: runEventType,
  message: t.String(),
  payload: t.Optional(t.Record(t.String(), t.Unknown())),
  timestamp: dateTimeString,
})

export const runEventListResponse = t.Array(runEventResponse)

export const toolExecutionStatus = t.Union([
  t.Literal("succeeded"),
  t.Literal("failed"),
])

export const toolExecutionResponse = t.Object({
  id: t.String(),
  runId: t.String(),
  tool: t.String(),
  input: t.Unknown(),
  output: t.Unknown(),
  status: toolExecutionStatus,
  error: t.Optional(t.String()),
  startedAt: dateTimeString,
  endedAt: t.Optional(dateTimeString),
})

export const toolExecutionListResponse = t.Array(toolExecutionResponse)

export const userMessageKind = t.Union([
  t.Literal("info"),
  t.Literal("progress"),
  t.Literal("result"),
  t.Literal("tool"),
  t.Literal("error"),
])

export const userMessageResponse = t.Object({
  id: t.String(),
  sessionId: t.String(),
  runId: t.Optional(t.String()),
  kind: userMessageKind,
  content: t.String(),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  timestamp: dateTimeString,
})

export const userMessageListResponse = t.Array(userMessageResponse)
