import { Elysia } from "elysia"

import type { Database } from "@bbot/database"

import {
  cancelRunBody,
  createRunEventBody,
  errorResponse,
  recoveryRunListResponse,
  runEventListResponse,
  runEventResponse,
  runIdParams,
  runListQuery,
  runListResponse,
  runResponse,
  runStreamResponse,
  runTraceQuery,
  runTraceListResponse,
  runTraceStreamQuery,
  runTraceStreamResponse,
  toolExecutionListResponse,
  type RunTraceItem,
} from "@bbot/protocol"
import {
  createRunEvent,
  getRun,
  listRuns,
  listAutoResumeRuns,
  listRunEvents,
  listRunEventsSince,
  listRunSessionEntries,
  listSessionEntriesSince,
  listToolExecutions,
  listToolExecutionsSince,
} from "./service"
import {
  serializeRun,
  serializeRunEvent,
  serializeSessionEntry,
  serializeToolExecution,
} from "./serialize"
import type { RunDispatcher } from "./dispatcher"

export const createRunsModule = (db: Database, dispatcher: RunDispatcher) =>
  new Elysia({ name: "runs" }).group("/runs", (app) =>
    app
      .get(
        "/recovery",
        async () => {
          const runs = await listAutoResumeRuns(db)
          const bySession = new Map<string, (typeof runs)[number]>()

          for (const run of runs) {
            if (!run.telegramChatId) continue
            const existing = bySession.get(run.sessionId)
            if (!existing || run.createdAt > existing.createdAt) {
              bySession.set(run.sessionId, run)
            }
          }

          const response = [] as Array<{
            runId: string
            sessionId: string
            status: (typeof runs)[number]["status"]
            prompt: string
            chatId: string
          }>

          for (const run of bySession.values()) {
            if (run.telegramChatId) {
              response.push({
                runId: run.runId,
                sessionId: run.sessionId,
                status: run.status,
                prompt: run.prompt,
                chatId: run.telegramChatId,
              })
            }
          }

          return response
        },
        {
          response: {
            200: recoveryRunListResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/",
        async ({ query }) => {
          const runs = await listRuns(db, {
            status: query.status,
            sessionId: query.sessionId,
            limit: query.limit,
            offset: query.offset,
          })
          return runs.map(serializeRun)
        },
        {
          query: runListQuery,
          response: {
            200: runListResponse,
            401: errorResponse,
          },
        },
      )
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
        "/trace/stream",
        async ({ query, set, request }) => {
          set.headers["content-type"] = "text/event-stream"
          set.headers["cache-control"] = "no-cache"
          set.headers["connection"] = "keep-alive"

          const parseLastEventId = (value: string | null) => {
            const cursor = { runTs: 0, toolTs: 0, entryTs: 0 }
            if (!value) return cursor
            const parts = value.split(";")
            for (const part of parts) {
              const [key, raw] = part.split("=")
              if (!key || raw === undefined) continue
              const parsed = Number.parseInt(raw, 10)
              if (!Number.isFinite(parsed)) continue
              if (key === "r") cursor.runTs = parsed
              if (key === "t") cursor.toolTs = parsed
              if (key === "e") cursor.entryTs = parsed
            }
            return cursor
          }

          const encoder = new TextEncoder()
          let closed = false
          const now = Date.now()
          const initialCursor = parseLastEventId(
            request.headers.get("last-event-id"),
          )
          let lastRunTimestamp = initialCursor.runTs || now
          let lastToolTimestamp = initialCursor.toolTs || now
          let lastEntryTimestamp = initialCursor.entryTs || now
          let lastRunIds = new Set<string>()
          let lastToolIds = new Set<string>()
          let lastEntryIds = new Set<string>()

          return new ReadableStream({
            async start(controller) {
              const formatCursor = () =>
                `r=${lastRunTimestamp};t=${lastToolTimestamp};e=${lastEntryTimestamp}`

              const send = (event: string, data: unknown) => {
                const payload = JSON.stringify(data)
                controller.enqueue(
                  encoder.encode(
                    `id: ${formatCursor()}\nevent: ${event}\ndata: ${payload}\n\n`,
                  ),
                )
              }

              send("stream.ready", { scope: "runs.trace" })

              while (!closed) {
                const runEvents = await listRunEventsSince(db, {
                  runId: query.runId,
                  sessionId: query.sessionId,
                  afterTimestamp: new Date(lastRunTimestamp),
                })

                for (const event of runEvents) {
                  const ts =
                    event.timestamp instanceof Date
                      ? event.timestamp.getTime()
                      : new Date(event.timestamp).getTime()

                  if (ts < lastRunTimestamp) continue
                  if (ts > lastRunTimestamp) {
                    lastRunTimestamp = ts
                    lastRunIds = new Set<string>()
                  }
                  if (lastRunIds.has(event.id)) continue
                  lastRunIds.add(event.id)

                  const serialized = serializeRunEvent(event)
                  const item: RunTraceItem = {
                    id: event.id,
                    runId: event.runId,
                    sessionId: event.sessionId,
                    timestamp: serialized.timestamp,
                    kind: "run_event",
                    event: serialized,
                  }

                  send("trace.item", item)
                }

                const toolExecutions = await listToolExecutionsSince(db, {
                  runId: query.runId,
                  sessionId: query.sessionId,
                  afterTimestamp: new Date(lastToolTimestamp),
                })

                for (const execution of toolExecutions) {
                  const endedAt = execution.endedAt ?? execution.startedAt
                  const ts =
                    endedAt instanceof Date
                      ? endedAt.getTime()
                      : new Date(endedAt).getTime()

                  if (ts < lastToolTimestamp) continue
                  if (ts > lastToolTimestamp) {
                    lastToolTimestamp = ts
                    lastToolIds = new Set<string>()
                  }
                  if (lastToolIds.has(execution.id)) continue
                  lastToolIds.add(execution.id)

                  const serialized = serializeToolExecution(execution)
                  const item: RunTraceItem = {
                    id: execution.id,
                    runId: execution.runId,
                    sessionId: execution.sessionId,
                    timestamp: new Date(endedAt).toISOString(),
                    kind: "tool_execution",
                    execution: serialized,
                  }

                  send("trace.item", item)
                }

                const sessionEntries = await listSessionEntriesSince(db, {
                  runId: query.runId,
                  sessionId: query.sessionId,
                  afterTimestamp: new Date(lastEntryTimestamp),
                })

                for (const entry of sessionEntries) {
                  const ts =
                    entry.timestamp instanceof Date
                      ? entry.timestamp.getTime()
                      : new Date(entry.timestamp).getTime()

                  if (ts < lastEntryTimestamp) continue
                  if (ts > lastEntryTimestamp) {
                    lastEntryTimestamp = ts
                    lastEntryIds = new Set<string>()
                  }
                  if (lastEntryIds.has(entry.id)) continue
                  lastEntryIds.add(entry.id)

                  const serialized = serializeSessionEntry(entry)
                  const item: RunTraceItem = {
                    id: entry.id,
                    runId: entry.runId ?? "",
                    sessionId: entry.sessionId,
                    timestamp: serialized.timestamp,
                    kind: "session_entry",
                    entry: serialized,
                  }

                  send("trace.item", item)
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
          query: runTraceStreamQuery,
          response: {
            200: runTraceStreamResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/trace",
        async ({ query }) => {
          const order = query.order ?? "desc"
          const limit = Math.max(1, Math.min(query.limit ?? 200, 1000))
          const afterTimestamp = query.after ? new Date(query.after) : undefined
          const beforeTimestamp = query.before ? new Date(query.before) : undefined

          const [events, executions, entries] = await Promise.all([
            listRunEventsSince(db, {
              runId: query.runId,
              sessionId: query.sessionId,
              afterTimestamp,
              beforeTimestamp,
              order,
              limit,
            }),
            listToolExecutionsSince(db, {
              runId: query.runId,
              sessionId: query.sessionId,
              afterTimestamp,
              beforeTimestamp,
              order,
              limit,
            }),
            listSessionEntriesSince(db, {
              runId: query.runId,
              sessionId: query.sessionId,
              afterTimestamp,
              beforeTimestamp,
              order,
              limit,
            }),
          ])

          const traceItems: Array<{
            sortTs: number
            sortId: string
            item: RunTraceItem
          }> = []

          for (const event of events) {
            const serialized = serializeRunEvent({
              id: event.id,
              runId: event.runId,
              type: event.type,
              message: event.message,
              payload: event.payload,
              timestamp: event.timestamp,
            })

            const item: RunTraceItem = {
              id: event.id,
              runId: event.runId,
              sessionId: event.sessionId,
              timestamp: serialized.timestamp,
              kind: "run_event",
              event: serialized,
            }

            traceItems.push({
              sortTs: new Date(event.timestamp).getTime(),
              sortId: event.id,
              item,
            })
          }

          for (const execution of executions) {
            const serialized = serializeToolExecution({
              id: execution.id,
              runId: execution.runId,
              tool: execution.tool,
              input: execution.input,
              output: execution.output,
              status: execution.status,
              error: execution.error,
              startedAt: execution.startedAt,
              endedAt: execution.endedAt,
            })

            const timestamp = execution.endedAt ?? execution.startedAt
            const item: RunTraceItem = {
              id: execution.id,
              runId: execution.runId,
              sessionId: execution.sessionId,
              timestamp: new Date(timestamp).toISOString(),
              kind: "tool_execution",
              execution: serialized,
            }

            traceItems.push({
              sortTs: new Date(timestamp).getTime(),
              sortId: execution.id,
              item,
            })
          }

          for (const entry of entries) {
            const serialized = serializeSessionEntry(entry)
            const item: RunTraceItem = {
              id: entry.id,
              runId: entry.runId ?? "",
              sessionId: entry.sessionId,
              timestamp: serialized.timestamp,
              kind: "session_entry",
              entry: serialized,
            }

            traceItems.push({
              sortTs: new Date(entry.timestamp).getTime(),
              sortId: entry.id,
              item,
            })
          }

          traceItems.sort((a, b) => {
            if (a.sortTs !== b.sortTs) {
              return order === "asc" ? a.sortTs - b.sortTs : b.sortTs - a.sortTs
            }
            if (a.sortId === b.sortId) return 0
            return order === "asc"
              ? a.sortId.localeCompare(b.sortId)
              : b.sortId.localeCompare(a.sortId)
          })

          return traceItems.slice(0, limit).map((entry) => entry.item)
        },
        {
          query: runTraceQuery,
          response: {
            200: runTraceListResponse,
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
      .get(
        "/:id/trace",
        async ({ params, set }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const [events, executions, entries] = await Promise.all([
            listRunEvents(db, params.id),
            listToolExecutions(db, params.id),
            listRunSessionEntries(db, { runId: params.id }),
          ])

          const sessionId = run.sessionId
          const traceItems: Array<{
            sortTs: number
            sortSeq?: number
            item: RunTraceItem
          }> = []

          for (const event of events) {
            const serialized = serializeRunEvent(event)
            const item: RunTraceItem = {
              id: event.id,
              runId: event.runId,
              sessionId,
              timestamp: serialized.timestamp,
              kind: "run_event",
              event: serialized,
            }
            traceItems.push({
              sortTs: new Date(event.timestamp).getTime(),
              item,
            })
          }

          for (const execution of executions) {
            const serialized = serializeToolExecution(execution)
            const timestamp = execution.endedAt ?? execution.startedAt
            const item: RunTraceItem = {
              id: execution.id,
              runId: execution.runId,
              sessionId,
              timestamp: new Date(timestamp).toISOString(),
              kind: "tool_execution",
              execution: serialized,
            }
            traceItems.push({
              sortTs: new Date(timestamp).getTime(),
              item,
            })
          }

          for (const entry of entries) {
            const serialized = serializeSessionEntry(entry)
            const item: RunTraceItem = {
              id: entry.id,
              runId: entry.runId ?? run.id,
              sessionId: entry.sessionId,
              timestamp: serialized.timestamp,
              kind: "session_entry",
              entry: serialized,
            }
            traceItems.push({
              sortTs: new Date(entry.timestamp).getTime(),
              sortSeq: entry.sequence,
              item,
            })
          }

          traceItems.sort((a, b) => {
            if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs
            const aSeq = a.sortSeq
            const bSeq = b.sortSeq
            if (typeof aSeq === "number" && typeof bSeq === "number") {
              return aSeq - bSeq
            }
            if (typeof aSeq === "number") return -1
            if (typeof bSeq === "number") return 1
            return 0
          })

          return traceItems.map((entry) => entry.item)
        },
        {
          params: runIdParams,
          response: {
            200: runTraceListResponse,
            404: errorResponse,
            401: errorResponse,
          },
        },
      )
      .get(
        "/:id/trace/stream",
        async ({ params, set, request }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const parseLastEventId = (value: string | null) => {
            const cursor = { runTs: 0, sessionSeq: 0, toolTs: 0 }
            if (!value) return cursor
            const parts = value.split(";")
            for (const part of parts) {
              const [key, raw] = part.split("=")
              if (!key || raw === undefined) continue
              const parsed = Number.parseInt(raw, 10)
              if (!Number.isFinite(parsed)) continue
              if (key === "r") cursor.runTs = parsed
              if (key === "s") cursor.sessionSeq = parsed
              if (key === "t") cursor.toolTs = parsed
            }
            return cursor
          }

          set.headers["content-type"] = "text/event-stream"
          set.headers["cache-control"] = "no-cache"
          set.headers["connection"] = "keep-alive"

          const encoder = new TextEncoder()
          let closed = false
          const initialCursor = parseLastEventId(
            request.headers.get("last-event-id"),
          )
          let lastRunTimestamp = initialCursor.runTs
          let lastRunIds = new Set<string>()
          let lastSessionSequence = initialCursor.sessionSeq
          let lastToolTimestamp = initialCursor.toolTs
          let lastToolIds = new Set<string>()

          return new ReadableStream({
            async start(controller) {
              const formatCursor = () =>
                `r=${lastRunTimestamp};s=${lastSessionSequence};t=${lastToolTimestamp}`

              const send = (event: string, data: unknown) => {
                const payload = JSON.stringify(data)
                controller.enqueue(
                  encoder.encode(
                    `id: ${formatCursor()}\nevent: ${event}\ndata: ${payload}\n\n`,
                  ),
                )
              }

              send("stream.ready", { runId: params.id })

              while (!closed) {
                const events = await listRunEvents(db, params.id)
                for (const event of events) {
                  const ts =
                    event.timestamp instanceof Date
                      ? event.timestamp.getTime()
                      : new Date(event.timestamp).getTime()

                  if (ts < lastRunTimestamp) continue
                  if (ts > lastRunTimestamp) {
                    lastRunTimestamp = ts
                    lastRunIds = new Set<string>()
                  }
                  if (lastRunIds.has(event.id)) continue
                  lastRunIds.add(event.id)

                  const serialized = serializeRunEvent(event)
                  send("trace.item", {
                    id: event.id,
                    runId: event.runId,
                    sessionId: run.sessionId,
                    timestamp: serialized.timestamp,
                    kind: "run_event",
                    event: serialized,
                  })
                }

                const executions = await listToolExecutions(db, params.id)
                for (const execution of executions) {
                  const endedAt = execution.endedAt ?? execution.startedAt
                  const ts =
                    endedAt instanceof Date
                      ? endedAt.getTime()
                      : new Date(endedAt).getTime()

                  if (ts < lastToolTimestamp) continue
                  if (ts > lastToolTimestamp) {
                    lastToolTimestamp = ts
                    lastToolIds = new Set<string>()
                  }
                  if (lastToolIds.has(execution.id)) continue
                  lastToolIds.add(execution.id)

                  const serialized = serializeToolExecution(execution)
                  send("trace.item", {
                    id: execution.id,
                    runId: execution.runId,
                    sessionId: run.sessionId,
                    timestamp: new Date(endedAt).toISOString(),
                    kind: "tool_execution",
                    execution: serialized,
                  })
                }

                const entries = await listRunSessionEntries(db, {
                  runId: params.id,
                  afterSequence: lastSessionSequence,
                })

                for (const entry of entries) {
                  if (typeof entry.sequence === "number") {
                    lastSessionSequence = Math.max(
                      lastSessionSequence,
                      entry.sequence,
                    )
                  }

                  const serialized = serializeSessionEntry(entry)
                  send("trace.item", {
                    id: entry.id,
                    runId: entry.runId ?? run.id,
                    sessionId: entry.sessionId,
                    timestamp: serialized.timestamp,
                    kind: "session_entry",
                    entry: serialized,
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
            200: runTraceStreamResponse,
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
        async ({ params, set, request }) => {
          const run = await getRun(db, params.id)

          if (!run) {
            set.status = 404
            return { error: "Run not found" }
          }

          const parseLastEventId = (value: string | null) => {
            const cursor = { timestamp: 0, messageSeq: 0, liveSeq: 0 }
            if (!value) return cursor
            const parts = value.split(";")
            for (const part of parts) {
              const [key, raw] = part.split("=")
              if (!key || raw === undefined) continue
              const parsed = Number.parseInt(raw, 10)
              if (!Number.isFinite(parsed)) continue
              if (key === "t") cursor.timestamp = parsed
              if (key === "m") cursor.messageSeq = parsed
              if (key === "l") cursor.liveSeq = parsed
            }
            return cursor
          }

          set.headers["content-type"] = "text/event-stream"
          set.headers["cache-control"] = "no-cache"
          set.headers["connection"] = "keep-alive"

          const encoder = new TextEncoder()
          let closed = false
          const initialCursor = parseLastEventId(
            request.headers.get("last-event-id"),
          )
          let lastTimestamp = initialCursor.timestamp
          let lastIds = new Set<string>()
          let lastMessageSequence = initialCursor.messageSeq
          let lastLiveSeq = initialCursor.liveSeq

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
              const formatCursor = () =>
                `t=${lastTimestamp};m=${lastMessageSequence};l=${lastLiveSeq}`

              const send = (event: string, data: unknown) => {
                const payload = JSON.stringify(data)
                controller.enqueue(
                  encoder.encode(
                    `id: ${formatCursor()}\nevent: ${event}\ndata: ${payload}\n\n`,
                  ),
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
