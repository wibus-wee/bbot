const BEGIN_PATCH_MARKER = "*** Begin Patch"
const END_PATCH_MARKER = "*** End Patch"
const ADD_FILE_MARKER = "*** Add File: "
const DELETE_FILE_MARKER = "*** Delete File: "
const UPDATE_FILE_MARKER = "*** Update File: "
const MOVE_TO_MARKER = "*** Move to: "
const EOF_MARKER = "*** End of File"
const CHANGE_CONTEXT_MARKER = "@@ "
const EMPTY_CHANGE_CONTEXT_MARKER = "@@"

const PARSE_IN_STRICT_MODE = false

type ParseMode = "strict" | "lenient"

export type ApplyPatchArgs = {
  patch: string
  hunks: Hunk[]
}

export type Hunk =
  | {
      type: "add"
      path: string
      contents: string
    }
  | {
      type: "delete"
      path: string
    }
  | {
      type: "update"
      path: string
      movePath?: string
      chunks: UpdateFileChunk[]
    }

export type UpdateFileChunk = {
  changeContext?: string
  oldLines: string[]
  newLines: string[]
  isEndOfFile: boolean
}

export class InvalidPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidPatchError"
  }
}

export class InvalidHunkError extends Error {
  lineNumber: number

  constructor(message: string, lineNumber: number) {
    super(message)
    this.name = "InvalidHunkError"
    this.lineNumber = lineNumber
  }
}

export const parsePatch = (patch: string): ApplyPatchArgs => {
  const mode: ParseMode = PARSE_IN_STRICT_MODE ? "strict" : "lenient"
  return parsePatchText(patch, mode)
}

const parsePatchText = (patch: string, mode: ParseMode): ApplyPatchArgs => {
  const rawLines = patch.trim().split(/\r?\n/)
  let lines = rawLines

  try {
    checkPatchBoundariesStrict(lines)
  } catch (error) {
    if (mode === "strict") {
      throw error
    }
    lines = checkPatchBoundariesLenient(lines, error as Error)
  }

  const hunks: Hunk[] = []
  const lastLineIndex = Math.max(lines.length - 1, 0)
  let remainingLines = lines.slice(1, lastLineIndex)
  let lineNumber = 2

  while (remainingLines.length > 0) {
    const [hunk, hunkLines] = parseOneHunk(remainingLines, lineNumber)
    hunks.push(hunk)
    lineNumber += hunkLines
    remainingLines = remainingLines.slice(hunkLines)
  }

  return {
    patch: lines.join("\n"),
    hunks,
  }
}

const checkPatchBoundariesStrict = (lines: string[]): void => {
  const first = lines[0]
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined
  checkStartAndEndLinesStrict(first, last)
}

const checkPatchBoundariesLenient = (lines: string[], originalError: Error): string[] => {
  if (lines.length < 4) {
    throw originalError
  }
  const first = lines[0]
  const last = lines[lines.length - 1] ?? ""
  if (
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    last.endsWith("EOF")
  ) {
    const innerLines = lines.slice(1, lines.length - 1)
    checkPatchBoundariesStrict(innerLines)
    return innerLines
  }
  throw originalError
}

const checkStartAndEndLinesStrict = (
  firstLine?: string,
  lastLine?: string,
): void => {
  const first = firstLine?.trim()
  const last = lastLine?.trim()

  if (first === BEGIN_PATCH_MARKER && last === END_PATCH_MARKER) {
    return
  }
  if (first !== BEGIN_PATCH_MARKER) {
    throw new InvalidPatchError(
      "The first line of the patch must be '*** Begin Patch'",
    )
  }
  throw new InvalidPatchError(
    "The last line of the patch must be '*** End Patch'",
  )
}

const parseOneHunk = (lines: string[], lineNumber: number): [Hunk, number] => {
  const firstLine = lines[0]?.trim() ?? ""

  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const path = firstLine.slice(ADD_FILE_MARKER.length)
    let contents = ""
    let parsedLines = 1

    for (const addLine of lines.slice(1)) {
      if (addLine.startsWith("+")) {
        contents += addLine.slice(1) + "\n"
        parsedLines += 1
      } else {
        break
      }
    }

    return [
      {
        type: "add",
        path,
        contents,
      },
      parsedLines,
    ]
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    const path = firstLine.slice(DELETE_FILE_MARKER.length)
    return [
      {
        type: "delete",
        path,
      },
      1,
    ]
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const path = firstLine.slice(UPDATE_FILE_MARKER.length)
    let remainingLines = lines.slice(1)
    let parsedLines = 1

    let movePath: string | undefined
    const moveLine = remainingLines[0]
    if (moveLine?.startsWith(MOVE_TO_MARKER)) {
      movePath = moveLine.slice(MOVE_TO_MARKER.length)
      remainingLines = remainingLines.slice(1)
      parsedLines += 1
    }

    const chunks: UpdateFileChunk[] = []

    while (remainingLines.length > 0) {
      if (remainingLines[0]!.trim() === "") {
        parsedLines += 1
        remainingLines = remainingLines.slice(1)
        continue
      }

      if (remainingLines[0]!.startsWith("***")) {
        break
      }

      const [chunk, chunkLines] = parseUpdateFileChunk(
        remainingLines,
        lineNumber + parsedLines,
        chunks.length === 0,
      )
      chunks.push(chunk)
      parsedLines += chunkLines
      remainingLines = remainingLines.slice(chunkLines)
    }

    if (chunks.length === 0) {
      throw new InvalidHunkError(
        `Update file hunk for path '${path}' is empty`,
        lineNumber,
      )
    }

    return [
      {
        type: "update",
        path,
        movePath,
        chunks,
      },
      parsedLines,
    ]
  }

  throw new InvalidHunkError(
    `'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    lineNumber,
  )
}

const parseUpdateFileChunk = (
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): [UpdateFileChunk, number] => {
  if (lines.length === 0) {
    throw new InvalidHunkError(
      "Update hunk does not contain any lines",
      lineNumber,
    )
  }

  let changeContext: string | undefined
  let startIndex = 0

  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1
  } else if (lines[0]!.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0]!.slice(CHANGE_CONTEXT_MARKER.length)
    startIndex = 1
  } else if (!allowMissingContext) {
    throw new InvalidHunkError(
      `Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`,
      lineNumber,
    )
  }

  if (startIndex >= lines.length) {
    throw new InvalidHunkError(
      "Update hunk does not contain any lines",
      lineNumber + 1,
    )
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  }

  let parsedLines = 0

  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new InvalidHunkError(
          "Update hunk does not contain any lines",
          lineNumber + 1,
        )
      }
      chunk.isEndOfFile = true
      parsedLines += 1
      break
    }

    if (line.length === 0) {
      chunk.oldLines.push("")
      chunk.newLines.push("")
      parsedLines += 1
      continue
    }

    const marker = line[0]
    switch (marker) {
      case " ":
        chunk.oldLines.push(line.slice(1))
        chunk.newLines.push(line.slice(1))
        parsedLines += 1
        break
      case "+":
        chunk.newLines.push(line.slice(1))
        parsedLines += 1
        break
      case "-":
        chunk.oldLines.push(line.slice(1))
        parsedLines += 1
        break
      default:
        if (parsedLines === 0) {
          throw new InvalidHunkError(
            `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
            lineNumber + 1,
          )
        }
        return [chunk, parsedLines + startIndex]
    }
  }

  return [chunk, parsedLines + startIndex]
}

export const applyUpdateChunks = (
  originalContents: string,
  chunks: UpdateFileChunk[],
  pathLabel: string,
): string => {
  const originalLines = originalContents.split("\n")
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop()
  }

  const replacements = computeReplacements(originalLines, pathLabel, chunks)
  const updated = applyReplacements(originalLines, replacements)

  if (updated.length === 0 || updated[updated.length - 1] !== "") {
    updated.push("")
  }

  return updated.join("\n")
}

type Replacement = [startIndex: number, oldLength: number, newLines: string[]]

const computeReplacements = (
  originalLines: string[],
  pathLabel: string,
  chunks: UpdateFileChunk[],
): Replacement[] => {
  const replacements: Replacement[] = []
  let lineIndex = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(
        originalLines,
        [chunk.changeContext],
        lineIndex,
        false,
      )
      if (contextIndex === undefined) {
        throw new Error(
          `Failed to find context '${chunk.changeContext}' in ${pathLabel}`,
        )
      }
      lineIndex = contextIndex + 1
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex =
        originalLines.length > 0 &&
        originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length
      replacements.push([insertionIndex, 0, [...chunk.newLines]])
      continue
    }

    let pattern = chunk.oldLines
    let newSlice = chunk.newLines

    let found = seekSequence(
      originalLines,
      pattern,
      lineIndex,
      chunk.isEndOfFile,
    )

    if (found === undefined && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1)
      if (newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1)
      }
      found = seekSequence(
        originalLines,
        pattern,
        lineIndex,
        chunk.isEndOfFile,
      )
    }

    if (found === undefined) {
      throw new Error(
        `Failed to find expected lines in ${pathLabel}:\n${chunk.oldLines.join("\n")}`,
      )
    }

    replacements.push([found, pattern.length, [...newSlice]])
    lineIndex = found + pattern.length
  }

  replacements.sort((a, b) => a[0] - b[0])

  return replacements
}

const applyReplacements = (
  lines: string[],
  replacements: Replacement[],
): string[] => {
  const updated = [...lines]

  for (const [startIndex, oldLength, newLines] of [...replacements].reverse()) {
    for (let i = 0; i < oldLength; i += 1) {
      if (startIndex < updated.length) {
        updated.splice(startIndex, 1)
      }
    }

    newLines.forEach((line, offset) => {
      updated.splice(startIndex + offset, 0, line)
    })
  }

  return updated
}

const seekSequence = (
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): number | undefined => {
  if (pattern.length === 0) {
    return start
  }

  if (pattern.length > lines.length) {
    return undefined
  }

  const searchStart =
    eof && lines.length >= pattern.length
      ? lines.length - pattern.length
      : start

  for (let i = searchStart; i <= lines.length - pattern.length; i += 1) {
    let ok = true
    for (let p = 0; p < pattern.length; p += 1) {
      if (lines[i + p] !== pattern[p]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  for (let i = searchStart; i <= lines.length - pattern.length; i += 1) {
    let ok = true
    for (let p = 0; p < pattern.length; p += 1) {
      if (lines[i + p]!.trimEnd() !== pattern[p]!.trimEnd()) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  for (let i = searchStart; i <= lines.length - pattern.length; i += 1) {
    let ok = true
    for (let p = 0; p < pattern.length; p += 1) {
      if (lines[i + p]!.trim() !== pattern[p]!.trim()) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  const normalise = (value: string): string => {
    let out = ""
    for (const char of value.trim()) {
      switch (char) {
        case "\u2010":
        case "\u2011":
        case "\u2012":
        case "\u2013":
        case "\u2014":
        case "\u2015":
        case "\u2212":
          out += "-"
          break
        case "\u2018":
        case "\u2019":
        case "\u201A":
        case "\u201B":
          out += "'"
          break
        case "\u201C":
        case "\u201D":
        case "\u201E":
        case "\u201F":
          out += '"'
          break
        case "\u00A0":
        case "\u2002":
        case "\u2003":
        case "\u2004":
        case "\u2005":
        case "\u2006":
        case "\u2007":
        case "\u2008":
        case "\u2009":
        case "\u200A":
        case "\u202F":
        case "\u205F":
        case "\u3000":
          out += " "
          break
        default:
          out += char
      }
    }
    return out
  }

  for (let i = searchStart; i <= lines.length - pattern.length; i += 1) {
    let ok = true
    for (let p = 0; p < pattern.length; p += 1) {
      if (normalise(lines[i + p]!) !== normalise(pattern[p]!)) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  return undefined
}
