import type { Api } from "grammy"

export type TelegramApi = Pick<Api, "sendMessage" | "editMessageText" | "sendChatAction">

export const escapeMarkdownV2 = (value: string) =>
  value.replace(/([\\_*\[\]\(\)~`>#+\-=|{}.!])/g, "\\$1")

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const escapeCode = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`")

const renderInlineMarkdownV2 = (input: string) => {
  const codeSpans: string[] = []
  const boldSpans: string[] = []
  const italicSpans: string[] = []

  let working = input.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000C${codeSpans.length}\u0000`
    codeSpans.push(code)
    return token
  })

  working = working.replace(/\*\*([^*]+)\*\*/g, (_match, inner: string) => {
    const token = `\u0000B${boldSpans.length}\u0000`
    boldSpans.push(inner)
    return token
  })

  working = working.replace(/_([^_]+)_/g, (_match, inner: string) => {
    const token = `\u0000I${italicSpans.length}\u0000`
    italicSpans.push(inner)
    return token
  })

  working = escapeMarkdownV2(working)

  working = working.replace(/\u0000B(\d+)\u0000/g, (_match, index: string) => {
    const slot = Number(index)
    if (!Number.isInteger(slot)) return ""
    const value = boldSpans[slot] ?? ""
    return `*${escapeMarkdownV2(value)}*`
  })

  working = working.replace(/\u0000I(\d+)\u0000/g, (_match, index: string) => {
    const slot = Number(index)
    if (!Number.isInteger(slot)) return ""
    const value = italicSpans[slot] ?? ""
    return `_${escapeMarkdownV2(value)}_`
  })

  working = working.replace(/\u0000C(\d+)\u0000/g, (_match, index: string) => {
    const slot = Number(index)
    if (!Number.isInteger(slot)) return ""
    const value = codeSpans[slot] ?? ""
    return `\`${escapeCode(value)}\``
  })

  return working
}

const renderMarkdownV2Lines = (input: string) => {
  const lines = input.split(/\r?\n/)
  return lines
    .map((line) => {
      const match = line.match(/^>\s?(.*)$/)
      if (match) {
        return `> ${renderInlineMarkdownV2(match[1] ?? "")}`
      }
      return renderInlineMarkdownV2(line)
    })
    .join("\n")
}

export const markdownToMarkdownV2 = (input: string) => {
  if (!input) return ""
  const parts = input.split(/```/g)
  const rendered: string[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const segment = parts[index] ?? ""
    if (index % 2 === 1) {
      let code = segment
      let language = ""
      const firstBreak = segment.indexOf("\n")
      if (firstBreak >= 0) {
        const firstLine = segment.slice(0, firstBreak).trim()
        if (firstLine && /^[a-zA-Z0-9_-]+$/.test(firstLine)) {
          language = firstLine
          code = segment.slice(firstBreak + 1)
        }
      }
      const header = language ? `\`\`\`${language}` : "```"
      rendered.push(`${header}\n${escapeCode(code)}\n\`\`\``)
    } else {
      rendered.push(renderMarkdownV2Lines(segment))
    }
  }

  return rendered.join("")
}


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
  mode?: "edit" | "new"
}

type ChunkedMessageUpdaterOptions = MessageUpdaterOptions & {
  transform?: (value: string) => string
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
  const mode = options.mode ?? "edit"

  let messageId: number | undefined
  let currentText = ""
  let lastSentText = ""
  let lastFlushAt = 0
  let scheduled: NodeJS.Timeout | null = null
  let scheduledDelay = 0
  let resetAfterFlush = false
  let nextTextAfterReset: string | null = null

  const getEscapedText = (value: string) => {
    if (parseMode !== "MarkdownV2") return null
    const escaped = escapeMarkdownV2(value)
    return escaped === value ? null : escaped
  }

  const sendMessageSafe = async (value: string) => {
    try {
      const message = await api.sendMessage(chatId, value, {
        parse_mode: parseMode,
      })
      messageId = message.message_id
    } catch (error) {
      const escaped = getEscapedText(value)
      if (!escaped) throw error
      const message = await api.sendMessage(chatId, escaped, {
        parse_mode: parseMode,
      })
      messageId = message.message_id
    }
  }

  const editMessageSafe = async (value: string) => {
    if (!messageId) return
    try {
      await api.editMessageText(chatId, messageId, value, {
        parse_mode: parseMode,
      })
    } catch (error) {
      const escaped = getEscapedText(value)
      if (!escaped) throw error
      await api.editMessageText(chatId, messageId, escaped, {
        parse_mode: parseMode,
      })
    }
  }

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
    const nextText =
      mode === "new" && lastSentText && currentText.startsWith(lastSentText)
        ? currentText.slice(lastSentText.length)
        : currentText
    if (!nextText) {
      lastSentText = currentText
      return
    }
    try {
      if (mode === "edit" && messageId) {
        await editMessageSafe(currentText)
      } else {
        await sendMessageSafe(nextText)
      }
      lastSentText = currentText
      lastFlushAt = Date.now()
    } catch {
      if (!fallbackToNewMessage) {
        return
      }
      try {
        await sendMessageSafe(currentText)
        lastSentText = currentText
        lastFlushAt = Date.now()
      } catch {
        return
      }
    }

    if (mode === "new") {
      messageId = undefined
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

  const append = (value: string, addNewline = true) => {
    const line =
      addNewline && !value.endsWith("\n") ? `${value}\n` : value
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

  const reset = () => {
    currentText = ""
    lastSentText = ""
    messageId = undefined
    resetAfterFlush = false
    nextTextAfterReset = null
  }

  return { append, set, close, reset }
}

const splitRenderedChunks = (
  value: string,
  maxLength: number,
  transform: (value: string) => string,
) => {
  if (!value) return []
  const normalizedMax = Math.max(1, maxLength)
  const lines = value.split(/\r?\n/)
  const chunks: string[] = []
  let buffer = ""

  const render = (text: string) => transform(text)
  const fits = (text: string) => render(text).length <= normalizedMax

  const pushBuffer = () => {
    if (!buffer) return
    chunks.push(render(buffer))
    buffer = ""
  }

  const takePrefix = (text: string) => {
    let low = 1
    let high = text.length
    let best = 1
    let bestRendered = render(text.slice(0, 1))

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const rendered = render(text.slice(0, mid))
      if (rendered.length <= normalizedMax) {
        best = mid
        bestRendered = rendered
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    if (bestRendered.length > normalizedMax) {
      return {
        prefix: text.slice(0, 1),
        rendered: bestRendered.slice(0, Math.max(1, normalizedMax - 1)) + "…",
      }
    }

    return { prefix: text.slice(0, best), rendered: bestRendered }
  }

  for (const line of lines) {
    const candidate = buffer ? `${buffer}\n${line}` : line
    if (fits(candidate)) {
      buffer = candidate
      continue
    }

    pushBuffer()

    if (!fits(line)) {
      let remaining = line
      while (remaining.length > 0) {
        const { prefix, rendered } = takePrefix(remaining)
        chunks.push(rendered)
        remaining = remaining.slice(prefix.length)
      }
      buffer = ""
      continue
    }

    buffer = line
  }

  pushBuffer()
  return chunks
}

export const createChunkedMessageUpdater = (
  api: TelegramApi,
  chatId: number,
  options: ChunkedMessageUpdaterOptions = {},
) => {
  const maxLength = options.maxLength ?? 3800
  const transform = options.transform ?? ((value) => value)
  const parseMode = options.parseMode
  const throttleMs = options.throttleMs
  const fallbackToNewMessage = options.fallbackToNewMessage
  const mode = options.mode

  const updaters: Array<ReturnType<typeof createMessageUpdater>> = []
  let currentChunks: string[] = []

  const ensureUpdater = (index: number) => {
    if (!updaters[index]) {
      updaters[index] = createMessageUpdater(api, chatId, {
        maxLength,
        parseMode,
        throttleMs,
        fallbackToNewMessage,
        mode,
      })
    }
    return updaters[index]!
  }

  const set = (value: string) => {
    if (!value) return
    const nextChunks = splitRenderedChunks(value, maxLength, transform)
    for (let index = 0; index < nextChunks.length; index += 1) {
      const chunk = nextChunks[index] ?? ""
      if (!chunk) continue
      if (currentChunks[index] === chunk) continue
      ensureUpdater(index).set(chunk)
    }
    currentChunks = nextChunks
  }

  const close = async () => {
    await Promise.all(updaters.map((updater) => updater.close()))
  }

  return { set, close }
}
