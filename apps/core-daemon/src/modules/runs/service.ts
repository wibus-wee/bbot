import { asc, eq } from "drizzle-orm"

import { schema } from "@bbot/database"
import type { Database } from "@bbot/database"
import type { CreateRunEventBody } from "@bbot/protocol"

const { runs, runEvents, toolExecutions, userMessages } = schema

type RunUpdateInput = Partial<
  Pick<
    typeof runs.$inferInsert,
    "status" | "summary" | "error" | "startedAt" | "finishedAt" | "updatedAt"
  >
>

type CreateToolExecutionInput = {
  runId: string
  tool: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  status: "succeeded" | "failed"
  error?: string
  startedAt?: Date
  endedAt?: Date
}

export const getRun = async (db: Database, id: string) => {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1)

  return run ?? null
}

export const listRunEvents = async (db: Database, runId: string) => {
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.timestamp), asc(runEvents.id))
}

export const createRunEvent = async (
  db: Database,
  runId: string,
  input: CreateRunEventBody,
) => {
  const [event] = await db
    .insert(runEvents)
    .values({
      runId,
      type: input.type,
      message: input.message,
      payload: input.payload,
    })
    .returning()

  return event ?? null
}

export const updateRun = async (db: Database, runId: string, input: RunUpdateInput) => {
  const values = {
    ...input,
    updatedAt: input.updatedAt ?? new Date(),
  }
  const [run] = await db
    .update(runs)
    .set(values)
    .where(eq(runs.id, runId))
    .returning()

  return run ?? null
}

export const createToolExecution = async (db: Database, input: CreateToolExecutionInput) => {
  const [execution] = await db
    .insert(toolExecutions)
    .values({
      runId: input.runId,
      tool: input.tool,
      input: input.input,
      output: input.output,
      status: input.status,
      error: input.error,
      startedAt: input.startedAt ?? new Date(),
      endedAt: input.endedAt,
    })
    .returning()

  return execution ?? null
}

export const listToolExecutions = async (db: Database, runId: string) => {
  return db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.runId, runId))
    .orderBy(asc(toolExecutions.startedAt))
}

export const listUserMessages = async (db: Database, runId: string) => {
  return db
    .select()
    .from(userMessages)
    .where(eq(userMessages.runId, runId))
    .orderBy(asc(userMessages.timestamp))
}
