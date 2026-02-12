import { asc, eq } from "drizzle-orm"

import { schema } from "@bbot/database"
import type { Database } from "@bbot/database"

import type { CreateWorkspaceBody } from "./model"

const { workspaceSessions, runs, runEvents } = schema

export const listWorkspaces = async (db: Database) => {
  return db.select().from(workspaceSessions).orderBy(asc(workspaceSessions.createdAt))
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
  const [workspace] = await db
    .insert(workspaceSessions)
    .values({
      name: input.name,
      rootPath: input.rootPath,
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
  const [run] = await db
    .insert(runs)
    .values({
      sessionId: workspaceId,
      prompt,
      status: "queued",
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

  return run
}
