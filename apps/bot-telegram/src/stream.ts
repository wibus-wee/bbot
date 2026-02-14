import { consola } from "consola"

import type { ApiClient } from "./api"
import {
  createChunkedMessageUpdater,
  type TelegramApi,
  // markdownToMarkdownV2,
} from "./messages"

export const streamRun = async (options: {
  apiClient: ApiClient
  botApi: TelegramApi
  chatId: number
  runId: string
  requestId?: string
  onTerminal?: (eventName: string) => void
}) => {
  const controller = new AbortController()
  let completed = false
  const messageUpdater = createChunkedMessageUpdater(options.botApi, options.chatId, {
    throttleMs: 600,
    maxLength: 3800,
    parseMode: "MarkdownV2",
    fallbackToNewMessage: false,
    // transform: markdownToMarkdownV2,
  })
  let assistantText = ""
  let thinkingText = ""
  let hasAssistantOutput = false
  let lastLiveSeq = 0
  let lastMessageSeq = 0
  const seenRunEventIds = new Set<string>()
  const seenMessageIds = new Set<string>()
  let failedText: string | null = null
  const typingInterval = setInterval(() => {
    void options.botApi.sendChatAction(options.chatId, "typing")
  }, 4500)

  void options.botApi.sendChatAction(options.chatId, "typing")

  const normalizeRunMessage = (message: string, prefix: string) =>
    message.startsWith(prefix) ? message.slice(prefix.length).trim() : message

  const renderThinking = (value: string) => {
    if (!value) return "_Thinking..._"
    return `_Thinking..._\n\n${value}`
  }

  const { stream } = await options.apiClient.sse.get({
    url: "/runs/{id}/stream",
    path: { id: options.runId },
    headers: options.requestId ? { "x-request-id": options.requestId } : undefined,
    signal: controller.signal,
    onSseEvent: (event) => {
      const eventName = event.event ?? ""
      if (eventName === "stream.ready") {
        return
      }

      const data = event.data as {
        message?: string
        text?: string
        id?: string
        sequence?: number
      } | undefined
      const message = data?.message ?? eventName
      const sequence = typeof data?.sequence === "number" ? data.sequence : null
      const eventId = typeof data?.id === "string" ? data.id : null

      const isLiveEvent = [
        "assistant.delta",
        "assistant.thinking",
        "assistant.thinking_delta",
        "assistant.thinking_start",
      ].includes(eventName)

      if (isLiveEvent && typeof sequence === "number") {
        if (sequence <= lastLiveSeq) return
        lastLiveSeq = sequence
      }

      if (eventName === "assistant.message") {
        if (typeof sequence === "number") {
          if (sequence <= lastMessageSeq) return
          lastMessageSeq = sequence
        }
        if (eventId) {
          if (seenMessageIds.has(eventId)) return
          seenMessageIds.add(eventId)
        }
      } else if (eventId) {
        if (seenRunEventIds.has(eventId)) return
        seenRunEventIds.add(eventId)
      }
      if (eventName === "assistant.delta") {
        const delta =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (delta) {
          assistantText += delta
          hasAssistantOutput = true
          messageUpdater.set(assistantText)
        }
        return
      }

      if (eventName === "assistant.message") {
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          assistantText = text
          hasAssistantOutput = true
          messageUpdater.set(assistantText)
        }
        return
      }

      if (eventName === "assistant.thinking_start") {
        thinkingText = ""
        if (!hasAssistantOutput) {
          messageUpdater.set(renderThinking(""))
        }
        return
      }

      if (eventName === "assistant.thinking_delta") {
        const delta =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (delta) {
          thinkingText += delta
          if (!hasAssistantOutput) {
            messageUpdater.set(renderThinking(thinkingText))
          }
        }
        return
      }

      if (eventName === "assistant.thinking") {
        const text =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.text === "string"
              ? data.text
              : message
        if (text) {
          thinkingText = text
          if (!hasAssistantOutput) {
            messageUpdater.set(renderThinking(thinkingText))
          }
        }
        return
      }

      if (eventName === "run.completed") {
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.failed") {
        failedText = normalizeRunMessage(message, "Run failed:")
        if (failedText) {
          messageUpdater.set(failedText)
        }
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }

      if (eventName === "run.canceled") {
        completed = true
        options.onTerminal?.(eventName)
        controller.abort()
        return
      }
    },
  })

  try {
    for await (const _ of stream) {
      if (completed) break
    }
  } catch (error) {
    if (!completed) {
      const message = error instanceof Error ? error.message : String(error)
      consola.warn(`SSE stream failed: ${message}`)
    }
  } finally {
    clearInterval(typingInterval)
    await messageUpdater.close()
  }
}
