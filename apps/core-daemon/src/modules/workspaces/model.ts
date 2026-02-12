import { t } from "elysia"

import { dateTimeString } from "../shared/model"

export const createWorkspaceBody = t.Object({
  name: t.String({ minLength: 1 }),
  rootPath: t.Optional(t.String()),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
})

export type CreateWorkspaceBody = typeof createWorkspaceBody.static

export const createRunBody = t.Object({
  prompt: t.String({ minLength: 1 }),
})

export type CreateRunBody = typeof createRunBody.static

export const workspaceStatus = t.Union([t.Literal("active"), t.Literal("archived")])

export const workspaceResponse = t.Object({
  id: t.String(),
  name: t.String(),
  status: workspaceStatus,
  rootPath: t.Optional(t.String()),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  accessedAt: dateTimeString,
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

export const workspaceListResponse = t.Array(workspaceResponse)
