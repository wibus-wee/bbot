export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024
export const GREP_MAX_LINE_LENGTH = 500

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: "lines" | "bytes" | null
  totalLines: number
  totalBytes: number
  outputLines: number
  outputBytes: number
  lastLinePartial: boolean
  firstLineExceedsLimit: boolean
  maxLines: number
  maxBytes: number
}

export interface TruncationOptions {
  maxLines?: number
  maxBytes?: number
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function truncateLine(
  line: string,
  maxLength: number = GREP_MAX_LINE_LENGTH,
): { text: string; wasTruncated: boolean } {
  if (line.length <= maxLength) return { text: line, wasTruncated: false }
  return { text: `${line.slice(0, maxLength)}...`, wasTruncated: true }
}

export function truncateHead(
  content: string,
  options: TruncationOptions = {},
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8")
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    }
  }

  const outputLinesArr: string[] = []
  let outputBytesCount = 0
  let truncatedBy: "lines" | "bytes" = "lines"

  for (let i = 0; i < lines.length && i < maxLines; i += 1) {
    const line = lines[i] ?? ""
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0)

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes"
      break
    }

    outputLinesArr.push(line)
    outputBytesCount += lineBytes
  }

  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines"
  }

  const outputContent = outputLinesArr.join("\n")
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8")

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

export function truncateTail(
  content: string,
  options: TruncationOptions = {},
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const outputLinesArr: string[] = []
  let outputBytesCount = 0
  let truncatedBy: "lines" | "bytes" = "lines"
  let lastLinePartial = false

  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i -= 1) {
    const line = lines[i] ?? ""
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0)

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes"
      if (outputLinesArr.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes)
        outputLinesArr.unshift(truncatedLine)
        outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8")
        lastLinePartial = true
      }
      break
    }

    outputLinesArr.unshift(line)
    outputBytesCount += lineBytes
  }

  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines"
  }

  const outputContent = outputLinesArr.join("\n")
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8")

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

function truncateStringToBytesFromEnd(value: string, maxBytes: number): string {
  let start = 0
  let end = value.length

  while (start < end) {
    const mid = Math.floor((start + end) / 2)
    const slice = value.slice(mid)
    const bytes = Buffer.byteLength(slice, "utf-8")
    if (bytes > maxBytes) {
      start = mid + 1
    } else {
      end = mid
    }
  }

  return value.slice(end)
}
