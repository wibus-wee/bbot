import { Elysia } from "elysia"

import { createId } from "@bbot/shared"

import { logger } from "../logger"

type RequestState = {
  requestId: string
  startedAt: number
}

const REQUEST_ID_HEADER = "x-request-id"
const requestState = new WeakMap<Request, RequestState>()

const getRequestPath = (request: Request) => {
  try {
    return new URL(request.url).pathname
  } catch {
    return request.url
  }
}

const getRequestId = (request: Request) => {
  const existing = request.headers.get(REQUEST_ID_HEADER)
  if (existing && existing.trim()) {
    return existing.trim()
  }
  return createId("req")
}

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { message: String(error) }
}

export const requestLogger = new Elysia({ name: "request-logger" })
  .onRequest(({ request, set }) => {
    const requestId = getRequestId(request)
    const startedAt = Date.now()
    requestState.set(request, { requestId, startedAt })
    set.headers[REQUEST_ID_HEADER] = requestId

    logger.info(
      {
        requestId,
        method: request.method,
        path: getRequestPath(request),
      },
      "request.start",
    )
  })
  .onAfterHandle(({ request, set }) => {
    const state = requestState.get(request)
    if (!state) {
      return
    }
    const durationMs = Date.now() - state.startedAt
    const status = typeof set.status === "number" ? set.status : 200

    logger.info(
      {
        requestId: state.requestId,
        method: request.method,
        path: getRequestPath(request),
        status,
        durationMs,
      },
      "request.completed",
    )

    requestState.delete(request)
  })
  .onError(({ request, set, error }) => {
    const state = requestState.get(request)
    const requestId = state?.requestId ?? getRequestId(request)
    const startedAt = state?.startedAt ?? Date.now()
    const durationMs = Date.now() - startedAt
    const status = typeof set.status === "number" ? set.status : 500

    logger.error(
      {
        requestId,
        method: request.method,
        path: getRequestPath(request),
        status,
        durationMs,
        error: serializeError(error),
      },
      "request.error",
    )

    requestState.delete(request)
  })
