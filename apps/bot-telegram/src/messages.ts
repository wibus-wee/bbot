import type { Api } from "grammy"

export type TelegramApi = Pick<Api, "sendMessage" | "editMessageText" | "sendChatAction">

export const splitMessage = (value: string, chunkSize = 3500) => {
  if (value.length <= chunkSize) return [value]
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize))
  }
  return chunks
}

export const sendChunks = async (api: TelegramApi, chatId: number, text: string) => {
  const chunks = splitMessage(text)
  for (const chunk of chunks) {
    await api.sendMessage(chatId, chunk)
  }
}

type MessageUpdaterOptions = {
  throttleMs?: number
  maxLength?: number
  parseMode?: "HTML" | "MarkdownV2" | "Markdown"
  fallbackToNewMessage?: boolean
}

export const createMessageUpdater = (
  api: TelegramApi,
  chatId: number,
  options: MessageUpdaterOptions = {},
) => {
  const throttleMs = options.throttleMs ?? 600
  const maxLength = options.maxLength ?? 3800
  const parseMode = options.parseMode
  const fallbackToNewMessage = options.fallbackToNewMessage ?? true

  let messageId: number | undefined
  let currentText = ""
  let lastSentText = ""
  let lastFlushAt = 0
  let scheduled: NodeJS.Timeout | null = null
  let scheduledDelay = 0
  let resetAfterFlush = false
  let nextTextAfterReset: string | null = null

  const queueFlush = () => {
    const delay = Math.max(0, throttleMs - (Date.now() - lastFlushAt))
    if (scheduled) {
      if (delay >= scheduledDelay) {
        return
      }
      clearTimeout(scheduled)
    }
    scheduledDelay = delay
    scheduled = setTimeout(async () => {
      scheduled = null
      scheduledDelay = 0
      await flush()
    }, delay)
  }

  const flush = async () => {
    if (!currentText) {
      return
    }
    if (currentText === lastSentText) {
      return
    }
    try {
      if (messageId) {
        await api.editMessageText(chatId, messageId, currentText, {
          parse_mode: parseMode,
        })
      } else {
        const message = await api.sendMessage(chatId, currentText, {
          parse_mode: parseMode,
        })
        messageId = message.message_id
      }
      lastSentText = currentText
      lastFlushAt = Date.now()
    } catch {
      if (!fallbackToNewMessage) {
        return
      }
      try {
        const message = await api.sendMessage(chatId, currentText, {
          parse_mode: parseMode,
        })
        messageId = message.message_id
        lastSentText = currentText
        lastFlushAt = Date.now()
      } catch {
        return
      }
    }

    if (resetAfterFlush) {
      resetAfterFlush = false
      messageId = undefined
      lastSentText = ""
      currentText = nextTextAfterReset ?? ""
      nextTextAfterReset = null
      if (currentText) {
        await flush()
      }
    }
  }

  const append = (value: string) => {
    const line = value.endsWith("\n") ? value : `${value}\n`
    if (currentText.length + line.length > maxLength) {
      resetAfterFlush = true
      nextTextAfterReset = line
      queueFlush()
      return
    }
    currentText += line
    queueFlush()
  }

  const set = (value: string) => {
    const nextText =
      value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
    currentText = nextText
    queueFlush()
  }

  const close = async () => {
    if (scheduled) {
      clearTimeout(scheduled)
      scheduled = null
    }
    await flush()
  }

  return { append, set, close }
}
