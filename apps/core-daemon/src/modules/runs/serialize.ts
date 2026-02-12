import { toIsoRequired, toOptionalJson, toIso } from "../shared/serialize"

import type { schema } from "@bbot/database"

export const serializeRun = (row: typeof schema.runs.$inferSelect) => ({
  id: row.id,
  sessionId: row.sessionId,
  prompt: row.prompt,
  status: row.status,
  summary: row.summary ?? undefined,
  error: row.error ?? undefined,
  startedAt: toIso(row.startedAt),
  finishedAt: toIso(row.finishedAt),
  createdAt: toIsoRequired(row.createdAt),
  updatedAt: toIsoRequired(row.updatedAt),
})

export const serializeRunEvent = (row: typeof schema.runEvents.$inferSelect) => ({
  id: row.id,
  runId: row.runId,
  type: row.type,
  message: row.message,
  payload: toOptionalJson(row.payload),
  timestamp: toIsoRequired(row.timestamp),
})

export const serializeToolExecution = (
  row: typeof schema.toolExecutions.$inferSelect,
) => ({
  id: row.id,
  runId: row.runId,
  tool: row.tool,
  input: row.input,
  output: row.output,
  status: row.status,
  error: row.error ?? undefined,
  startedAt: toIsoRequired(row.startedAt),
  endedAt: toIso(row.endedAt),
})

export const serializeUserMessage = (row: typeof schema.userMessages.$inferSelect) => ({
  id: row.id,
  sessionId: row.sessionId,
  runId: row.runId ?? undefined,
  kind: row.kind,
  content: row.content,
  metadata: toOptionalJson(row.metadata),
  timestamp: toIsoRequired(row.timestamp),
})
