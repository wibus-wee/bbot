import { Elysia } from "elysia"

import type { Database } from "@bbot/database"

import {
  cancelRunBody,
  createRunEventBody,
  errorResponse,
  runEventListResponse,
  runEventResponse,
  runIdParams,
  runResponse,
  runStreamResponse,
  toolExecutionListResponse,
} from "@bbot/protocol"
import {
  createRunEvent,
  getRun,
  listRunEvents,
  listRunSessionEntries,
  listToolExecutions,
} from "./service"
import {
  serializeRun,
  serializeRunEvent,
  serializeToolExecution,
} from "./serialize"
import type { RunDispatcher } from "./dispatcher"

export const createRunsModule = (db: Database, dispatcher: RunDispatcher) =>
  new Elysia({ name: "runs" }).group("/runs", (app) =>
    app
      .get(
        "/:id",
        async ({ params, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          return serializeRun(run)
        },
        {
          params: runIdParams,
          response: {
            200: runResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:id/events",
        async ({ params, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const events = await listRunEvents(db, params.id)
          return events.map(serializeRunEvent)
        },
        {
          params: runIdParams,
          response: {
            200: runEventListResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/:id/events",
        async ({ params, body, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const event = await createRunEvent(db, params.id, body)

          if (!event) {
            set.status = 500
            return { error: "RunEvent not created" }
          }

          set.status = 201
          return serializeRunEvent(event)
        },
        {
          params: runIdParams,
          body: createRunEventBody,
          response: {
            201: runEventResponse,
            404: errorResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:id/tool-executions",
        async ({ params, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const executions = await listToolExecutions(db, params.id)
          return executions.map(serializeToolExecution)
        },
        {
          params: runIdParams,
          response: {
            200: toolExecutionListResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .post(
        "/:id/cancel",
        async ({ params, body, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const reason =
            body &&
            typeof body === "object" &&
            "reason" in body &&
            typeof (body as { reason?: unknown }).reason === "string"
              ? (body as { reason: string }).reason
              : "user"

          const updated = await dispatcher.cancelRun(params.id, reason)

          if (!updated) {
            set.status = 500
            return { error: "Run not canceled" }
          }

          return serializeRun(updated)
        },
        {
          params: runIdParams,
          body: cancelRunBody.optional(),
          response: {
            200: runResponse,
            404: errorResponse,
            500: errorResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:id/stream",
        async ({ params, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          set.headers["content-type"] = "text/event-stream"
          set.headers["cache-control"] = "no-cache"
          set.headers["connection"] = "keep-alive"

          const encoder = new TextEncoder()
          let closed = false
          let lastTimestamp = 0
          let lastIds = new Set<string>()
          let lastMessageSequence = 0
          let lastLiveSeq = 0

          type AssistantBlock = { kind: "text"; text: string }

          const extractAssistantBlocks = (payload: unknown): AssistantBlock[] => {
            if (!payload || typeof payload !== "object") return []
            const payloadRecord = payload as Record<string, unknown>
            if (payloadRecord.role !== "assistant") return []
            if (!("content" in payloadRecord)) return []
            const content = payloadRecord.content
            if (typeof content === "string") {
              return content.trim()
                ? [{ kind: "text", text: content.trim() }]
                : []
            }
            const blocks = Array.isArray(content) ? content : []
            const extracted: AssistantBlock[] = []
            for (const block of blocks) {
              if (!block || typeof block !== "object") continue
              const record = block as Record<string, unknown>
              if (record.type === "text" && typeof record.text === "string") {
                if (record.text.trim()) {
                  extracted.push({ kind: "text", text: record.text })
                }
                continue
              }
            }
            return extracted
          }

          return new ReadableStream({
            async start(controller) {
              const send = (event: string, data: unknown) => {
                const payload = JSON.stringify(data)
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${payload}\n\n`),
                )
              }

              send("stream.ready", { runId: params.id })

              while (!closed) {
                const events = await listRunEvents(db, params.id)
                const terminalEvents: typeof events = []

                for (const event of events) {
                  const ts =
                    event.timestamp instanceof Date
                      ? event.timestamp.getTime()
                      : 0

                  if (ts < lastTimestamp) continue

                  if (ts > lastTimestamp) {
                    lastTimestamp = ts
                    lastIds = new Set<string>()
                  }

                  if (lastIds.has(event.id)) continue

                  lastIds.add(event.id)
                  if (
                    event.type === "run.completed" ||
                    event.type === "run.failed" ||
                    event.type === "run.canceled"
                  ) {
                    terminalEvents.push(event)
                    continue
                  }

                  send(event.type, {
                    id: event.id,
                    message: event.message,
                    payload: event.payload,
                    timestamp: event.timestamp,
                  })
                }

                const liveEvents = dispatcher.listLiveEvents(params.id, lastLiveSeq)
                for (const liveEvent of liveEvents) {
                  lastLiveSeq = Math.max(lastLiveSeq, liveEvent.seq)
                  send(liveEvent.type, {
                    message: liveEvent.message,
                    timestamp: liveEvent.timestamp,
                    sequence: liveEvent.seq,
                  })
                }

                const entries = await listRunSessionEntries(db, {
                  runId: params.id,
                  kinds: ["message"],
                  afterSequence: lastMessageSequence,
                })

                for (const entry of entries) {
                  if (typeof entry.sequence === "number") {
                    lastMessageSequence = Math.max(lastMessageSequence, entry.sequence)
                  }

                  const blocks = extractAssistantBlocks(entry.payload)
                  if (blocks.length === 0) continue
                  for (const block of blocks) {
                    send("assistant.message", {
                      id: entry.id,
                      message: block.text,
                      timestamp: entry.timestamp,
                      sequence: entry.sequence,
                    })
                  }
                }

                for (const event of terminalEvents) {
                  send(event.type, {
                    id: event.id,
                    message: event.message,
                    payload: event.payload,
                    timestamp: event.timestamp,
                  })
                }

                await new Promise((resolve) => setTimeout(resolve, 1000))
              }

              controller.close()
            },
            cancel() {
              closed = true
            },
          })
        },
        {
          params: runIdParams,
          response: {
            200: runStreamResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      ),
  )
