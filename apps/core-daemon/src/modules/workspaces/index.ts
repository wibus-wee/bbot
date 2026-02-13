import { Elysia } from "elysia"

import type { Database } from "@bbot/database"

import {
  createRunBody,
  createWorkspaceBody,
  errorResponse,
  idParams,
  runResponse,
  workspaceSearchQuery,
  workspaceListResponse,
  workspaceResponse,
} from "@bbot/protocol"
import {
  createWorkspace,
  createWorkspaceRun,
  archiveWorkspace,
  getWorkspace,
  listWorkspaces,
  searchWorkspaces,
} from "./service"
import { serializeWorkspace } from "./serialize"
import { serializeRun } from "../runs/serialize"
import type { RunDispatcher } from "../runs/dispatcher"

export const createWorkspacesModule = (db: Database, dispatcher: RunDispatcher) =>
  new Elysia({ name: "workspaces" }).group("/workspaces", (app) =>
    app
      .post(
        "/",
        async ({ body, set }) => {
          const workspace = await createWorkspace(db, body)

          if (!workspace) {
            set.status = 500
            return { error: "Workspace not created" }
          }

          set.status = 201
          return serializeWorkspace(workspace)
        },
        {
          body: createWorkspaceBody,
          response: {
            201: workspaceResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/search",
        async ({ query }) => {
          const items = await searchWorkspaces(db, {
            chatId: query.chatId,
            userId: query.userId,
            query: query.query,
            status: query.status,
            limit: query.limit,
            offset: query.offset,
          })
          return items.map(serializeWorkspace)
        },
        {
          query: workspaceSearchQuery,
          response: {
            200: workspaceListResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/",
        async () => {
          const items = await listWorkspaces(db)
          return items.map(serializeWorkspace)
        },
        {
          response: {
            200: workspaceListResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:id",
        async ({ params, set }) => {
          const workspace = await getWorkspace(db, params.id)

          if (!workspace) {
            set.status = 404
            return { error: "Workspace not found" }
          }

          return serializeWorkspace(workspace)
        },
        {
          params: idParams,
          response: {
            200: workspaceResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/:id/archive",
        async ({ params, set }) => {
          const workspace = await getWorkspace(db, params.id)

          if (!workspace) {
            set.status = 404
            return { error: "Workspace not found" }
          }

          await dispatcher.cancelRunsForSession(params.id, "archived")

          const updated = await archiveWorkspace(db, params.id)

          if (!updated) {
            set.status = 500
            return { error: "Workspace not archived" }
          }

          return serializeWorkspace(updated)
        },
        {
          params: idParams,
          response: {
            200: workspaceResponse,
            404: errorResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/:id/runs",
        async ({ params, body, set }) => {
          const workspace = await getWorkspace(db, params.id)

          if (!workspace) {
            set.status = 404
            return { error: "Workspace not found" }
          }

          await dispatcher.cancelRunsForSession(params.id, "superseded")

          const run = await createWorkspaceRun(db, params.id, body.prompt)

          if (!run) {
            set.status = 500
            return { error: "Run not created" }
          }

          dispatcher.enqueue(run.id)

          set.status = 201
          return serializeRun(run)
        },
        {
          params: idParams,
          body: createRunBody,
          response: {
            201: runResponse,
            404: errorResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      ),
  )
