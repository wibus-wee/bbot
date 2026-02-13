import { and, desc, eq, sql } from "drizzle-orm"

import { schema } from "@bbot/database"
import type { Database } from "@bbot/database"

import type { CreateWorkspaceBody } from "@bbot/protocol"

const { workspaceSessions, runs, runEvents, userMessages } = schema

export const listWorkspaces = async (db: Database) => {
  return db
    .select()
    .from(workspaceSessions)
    .orderBy(desc(workspaceSessions.accessedAt), desc(workspaceSessions.createdAt))
}

export const getWorkspace = async (db: Database, id: string) => {
  const [workspace] = await db
    .select()
    .from(workspaceSessions)
    .where(eq(workspaceSessions.id, id))
    .limit(1)

  return workspace ?? null
}

export const createWorkspace = async (db: Database, input: CreateWorkspaceBody) => {
  const rootPath = process.cwd()
  const [workspace] = await db
    .insert(workspaceSessions)
    .values({
      name: input.name,
      rootPath,
      telegramChatId: input.telegramChatId,
      telegramUserId: input.telegramUserId,
      forkedFromSessionId: input.forkedFromSessionId,
      metadata: input.metadata,
    })
    .returning()

  return workspace ?? null
}

export const createWorkspaceRun = async (
  db: Database,
  workspaceId: string,
  prompt: string,
) => {
  const now = new Date()
  const [run] = await db
    .insert(runs)
    .values({
      sessionId: workspaceId,
      prompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!run) {
    return null
  }

  await db.insert(runEvents).values({
    runId: run.id,
    type: "run.queued",
    message: "Run queued",
  })

  await db.insert(userMessages).values({
    sessionId: workspaceId,
    runId: run.id,
    kind: "user",
    content: prompt,
    timestamp: now,
  })

  await db
    .update(workspaceSessions)
    .set({ accessedAt: now, updatedAt: now })
    .where(eq(workspaceSessions.id, workspaceId))

  return run
}

export const searchWorkspaces = async (
  db: Database,
  input: {
    chatId: string
    userId?: string
    query?: string
    limit?: number
  },
) => {
  const conditions = [eq(workspaceSessions.telegramChatId, input.chatId)]
  if (input.userId) {
    conditions.push(eq(workspaceSessions.telegramUserId, input.userId))
  }
  const keyword = input.query?.trim()
  if (keyword) {
    conditions.push(eq(userMessages.kind, "user"))
    conditions.push(sql`${userMessages.content} ILIKE ${`%${keyword}%`}`)
  }
  const where =
    conditions.length > 1 ? and(...conditions) : conditions[0]

  const rows = await db
    .selectDistinct({ workspace: workspaceSessions })
    .from(workspaceSessions)
    .leftJoin(userMessages, eq(userMessages.sessionId, workspaceSessions.id))
    .where(where)
    .orderBy(desc(workspaceSessions.accessedAt), desc(workspaceSessions.createdAt))
    .limit(input.limit ?? 20)

  return rows.map((row) => row.workspace)
}
