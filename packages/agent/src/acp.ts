import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type KillTerminalCommandRequest,
  type KillTerminalCommandResponse,
  type PermissionOption,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type ToolCall,
  type ToolCallContent,
  type ToolCallUpdate,
  type TerminalExitStatus,
} from "@agentclientprotocol/sdk"
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable, Writable } from "node:stream"

export type AcpRuntimeConfig = {
  command: string
  args?: string
}

type RunAcpOptions = {
  prompt: string
  workspaceRoot: string
  contextMessages?: AgentMessage[]
  onEvent?: (event: AgentEvent) => void
  abortSignal?: AbortSignal
  config: AcpRuntimeConfig
}

type RunAcpResult = {
  outputMessages: AgentMessage[]
  errorMessage?: string
}

type TerminalRecord = {
  process: ChildProcessWithoutNullStreams
  outputChunks: Buffer[]
  totalBytes: number
  truncated: boolean
  outputLimit?: number | null
  exitStatus?: TerminalExitStatus
  exitPromise: Promise<TerminalExitStatus>
  resolveExit: (status: TerminalExitStatus) => void
}

type ToolCallState = {
  toolName: string
  args: unknown
  started: boolean
}

const DEFAULT_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

const parseArgs = (value?: string): string[] => {
  if (!value) return []
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const extractTextBlocks = (content: unknown): string[] => {
  if (!content) return []
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block && typeof block === "object")
    .map((block) => {
      const record = block as { type?: string; text?: string }
      if (record.type !== "text") return ""
      return typeof record.text === "string" ? record.text : ""
    })
    .filter((text) => text.trim().length > 0)
}

const buildContextText = (messages?: AgentMessage[]): string => {
  if (!messages || messages.length === 0) return ""
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return ""
      const role = "role" in message ? String(message.role) : "user"
      const blocks = extractTextBlocks((message as { content?: unknown }).content)
      const text = blocks.join(" ").trim()
      if (!text) return ""
      if (role === "toolResult") {
        const toolName =
          "toolName" in message ? String(message.toolName) : "tool"
        return `Tool ${toolName}: ${text}`
      }
      if (role === "assistant") return `Assistant: ${text}`
      return `User: ${text}`
    })
    .filter((entry) => entry.length > 0)
    .join("\n")
}

const buildPromptBlocks = (
  prompt: string,
  contextMessages?: AgentMessage[],
): ContentBlock[] => {
  const blocks: ContentBlock[] = []
  const contextText = buildContextText(contextMessages)
  if (contextText) {
    blocks.push({
      type: "text",
      text: `Context:\n${contextText}`,
    })
  }
  blocks.push({
    type: "text",
    text: prompt,
  })
  return blocks
}

const contentToText = (content: ContentBlock): string => {
  if (content.type === "text") return content.text
  if (content.type === "resource_link") return content.uri
  if (content.type === "resource") {
    const resource = content.resource
    if (resource && "text" in resource && typeof resource.text === "string") {
      return resource.text
    }
    if (resource && "uri" in resource && typeof resource.uri === "string") {
      return resource.uri
    }
  }
  return ""
}

const toolCallContentToText = (content: ToolCallContent): string => {
  if (content.type === "content") {
    return contentToText(content.content)
  }
  if (content.type === "diff") {
    return `Diff ${content.path}`
  }
  if (content.type === "terminal") {
    return `Terminal ${content.terminalId}`
  }
  return ""
}

const stringifyValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const buildToolResultPayload = (
  rawOutput: unknown,
  content?: ToolCallContent[] | null,
) => {
  const parts: string[] = []
  if (Array.isArray(content)) {
    for (const entry of content) {
      const text = toolCallContentToText(entry)
      if (text) parts.push(text)
    }
  }
  const rawText = stringifyValue(rawOutput)
  if (rawText) parts.push(rawText)

  const text = parts.join("\n")
  return {
    content: [{ type: "text", text }],
    details: {
      rawOutput,
      content,
    },
  }
}

const resolveToolName = (value: {
  title?: string | null
  kind?: string | null
}): string => {
  if (value.title) return value.title
  if (value.kind) return value.kind
  return "tool"
}

const selectPermissionOption = (
  options: PermissionOption[],
): PermissionOption | undefined => {
  const allowOnce = options.find((option) => option.kind === "allow_once")
  if (allowOnce) return allowOnce
  const allowAlways = options.find((option) => option.kind === "allow_always")
  if (allowAlways) return allowAlways
  return options[0]
}

const buildAssistantMessage = (text: string): AgentMessage => {
  const now = Date.now()
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "acp",
    provider: "acp",
    model: "acp",
    usage: DEFAULT_USAGE,
    stopReason: "stop",
    timestamp: now,
  }
}

const resolveStopReason = (stopReason: string): string | undefined => {
  if (stopReason === "end_turn") return undefined
  if (stopReason === "cancelled") return "ACP run cancelled"
  return `ACP run ended with stop reason: ${stopReason}`
}

const resolveFilePath = (workspaceRoot: string, inputPath: string): string => {
  if (path.isAbsolute(inputPath)) return inputPath
  return path.resolve(workspaceRoot, inputPath)
}

class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()

  constructor(private readonly workspaceRoot: string) {}

  async create(request: {
    command: string
    args?: string[]
    cwd?: string | null
    env?: { name: string; value: string }[]
    outputByteLimit?: number | null
  }): Promise<string> {
    const terminalId = randomUUID()
    const args = request.args ?? []
    const cwd = request.cwd ?? this.workspaceRoot
    const envOverrides = request.env ?? []
    const env = {
      ...process.env,
      ...Object.fromEntries(envOverrides.map((entry) => [entry.name, entry.value])),
    }

    const child = spawn(request.command, args, {
      cwd,
      env,
      stdio: "pipe",
    })

    const record = this.createRecord(child, request.outputByteLimit)
    this.terminals.set(terminalId, record)

    child.stdout.on("data", (chunk: Buffer) => {
      this.appendOutput(record, chunk)
    })

    child.stderr.on("data", (chunk: Buffer) => {
      this.appendOutput(record, chunk)
    })

    child.on("exit", (code, signal) => {
      const exitStatus = {
        exitCode: code ?? null,
        signal: signal ?? null,
      }
      record.exitStatus = exitStatus
      record.resolveExit(exitStatus)
    })

    return terminalId
  }

  getOutput(terminalId: string) {
    const record = this.getRecord(terminalId)
    return {
      output: Buffer.concat(record.outputChunks).toString("utf8"),
      truncated: record.truncated,
      exitStatus: record.exitStatus ?? null,
    }
  }

  async waitForExit(terminalId: string) {
    const record = this.getRecord(terminalId)
    const exitStatus = record.exitStatus ?? (await record.exitPromise)
    return {
      exitCode: exitStatus.exitCode ?? null,
      signal: exitStatus.signal ?? null,
    }
  }

  async kill(terminalId: string) {
    const record = this.getRecord(terminalId)
    if (!record.process.killed) {
      record.process.kill()
    }
  }

  async release(terminalId: string) {
    const record = this.getRecord(terminalId)
    if (!record.process.killed) {
      record.process.kill()
    }
    this.terminals.delete(terminalId)
  }

  private appendOutput(record: TerminalRecord, chunk: Buffer) {
    record.outputChunks.push(chunk)
    record.totalBytes += chunk.length
    if (typeof record.outputLimit !== "number") return
    while (record.totalBytes > record.outputLimit && record.outputChunks.length > 0) {
      const removed = record.outputChunks.shift()
      if (!removed) break
      record.totalBytes -= removed.length
      record.truncated = true
    }
  }

  private createRecord(
    process: ChildProcessWithoutNullStreams,
    outputLimit?: number | null,
  ): TerminalRecord {
    let resolveExit: (status: TerminalExitStatus) => void
    const exitPromise = new Promise<TerminalExitStatus>((resolve) => {
      resolveExit = resolve
    })

    return {
      process,
      outputChunks: [],
      totalBytes: 0,
      truncated: false,
      outputLimit,
      exitPromise,
      resolveExit: resolveExit!,
    }
  }

  private getRecord(terminalId: string): TerminalRecord {
    const record = this.terminals.get(terminalId)
    if (!record) {
      throw RequestError.resourceNotFound(terminalId)
    }
    return record
  }
}

class AcpClient implements Client {
  private assistantText = ""
  private outputMessages: AgentMessage[] = []
  private thinkingOpen = false
  private toolCalls = new Map<string, ToolCallState>()

  constructor(
    private readonly options: {
      workspaceRoot: string
      onEvent?: (event: AgentEvent) => void
      terminalManager: TerminalManager
    },
  ) {}

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const selected = selectPermissionOption(params.options)
    if (!selected) {
      return { outcome: { outcome: "cancelled" } }
    }
    return {
      outcome: {
        outcome: "selected",
        optionId: selected.optionId,
      },
    }
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update
    if (update.sessionUpdate === "agent_message_chunk") {
      const text = contentToText(update.content)
      if (text) {
        this.assistantText += text
        this.options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: text },
        } as AgentEvent)
      }
      return
    }

    if (update.sessionUpdate === "tool_call") {
      this.handleToolCall(update)
      return
    }

    if (update.sessionUpdate === "tool_call_update") {
      this.handleToolCallUpdate(update)
      return
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      const text = contentToText(update.content)
      if (!text) return
      if (!this.thinkingOpen) {
        this.thinkingOpen = true
        this.options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_start" },
        } as AgentEvent)
      }
      this.options.onEvent?.({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: text },
      } as AgentEvent)
      return
    }
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const filePath = resolveFilePath(this.options.workspaceRoot, params.path)
    try {
      const content = await readFile(filePath, "utf8")
      return { content }
    } catch (error) {
      if (error instanceof Error) {
        throw RequestError.resourceNotFound(filePath)
      }
      throw error
    }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const filePath = resolveFilePath(this.options.workspaceRoot, params.path)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, params.content, "utf8")
    return {}
  }

  async createTerminal(
    params: CreateTerminalRequest,
  ): Promise<CreateTerminalResponse> {
    const terminalId = await this.options.terminalManager.create({
      command: params.command,
      args: params.args,
      cwd: params.cwd,
      env: params.env,
      outputByteLimit: params.outputByteLimit,
    })
    return { terminalId }
  }

  async terminalOutput(
    params: TerminalOutputRequest,
  ): Promise<TerminalOutputResponse> {
    const output = this.options.terminalManager.getOutput(params.terminalId)
    return {
      output: output.output,
      truncated: output.truncated,
      exitStatus: output.exitStatus,
    }
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    return this.options.terminalManager.waitForExit(params.terminalId)
  }

  async killTerminal(
    params: KillTerminalCommandRequest,
  ): Promise<KillTerminalCommandResponse> {
    await this.options.terminalManager.kill(params.terminalId)
    return {}
  }

  async releaseTerminal(
    params: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse | void> {
    await this.options.terminalManager.release(params.terminalId)
  }

  finalizeAssistantMessage() {
    if (this.thinkingOpen) {
      this.thinkingOpen = false
      this.options.onEvent?.({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end" },
      } as AgentEvent)
    }

    const text = this.assistantText
    if (!text.trim()) return
    const message = buildAssistantMessage(text)
    this.outputMessages.push(message)
    this.options.onEvent?.({ type: "message_end", message } as AgentEvent)
    this.assistantText = ""
  }

  getOutputMessages() {
    return this.outputMessages
  }

  private handleToolCall(update: ToolCall) {
    const toolCallId = update.toolCallId
    const toolName = resolveToolName(update)
    const args = update.rawInput ?? {}
    const state = this.getOrCreateToolCall(toolCallId, toolName, args)
    this.emitToolExecutionStart(toolCallId, state)
    this.handleToolStatus(toolCallId, update.status, update, state)
  }

  private handleToolCallUpdate(update: ToolCallUpdate) {
    const toolCallId = update.toolCallId
    const toolName = resolveToolName(update)
    const args = update.rawInput ?? this.toolCalls.get(toolCallId)?.args ?? {}
    const state = this.getOrCreateToolCall(toolCallId, toolName, args)
    this.emitToolExecutionStart(toolCallId, state)
    this.handleToolStatus(toolCallId, update.status ?? undefined, update, state)
  }

  private handleToolStatus(
    toolCallId: string,
    status: ToolCall["status"] | ToolCallUpdate["status"] | undefined,
    update: { rawOutput?: unknown; content?: ToolCallContent[] | null },
    state: ToolCallState,
  ) {
    const payload = buildToolResultPayload(update.rawOutput, update.content)
    if (status === "completed" || status === "failed") {
      this.emitToolExecutionEnd(toolCallId, state, payload, status === "failed")
      return
    }

    if (update.rawOutput !== undefined || update.content) {
      this.emitToolExecutionUpdate(toolCallId, state, payload)
    }
  }

  private getOrCreateToolCall(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): ToolCallState {
    const existing = this.toolCalls.get(toolCallId)
    if (existing) {
      if (toolName && existing.toolName === "tool") {
        existing.toolName = toolName
      }
      if (args !== undefined) {
        existing.args = args
      }
      return existing
    }
    const state = {
      toolName,
      args,
      started: false,
    }
    this.toolCalls.set(toolCallId, state)
    return state
  }

  private emitToolExecutionStart(toolCallId: string, state: ToolCallState) {
    if (state.started) return
    state.started = true
    this.options.onEvent?.({
      type: "tool_execution_start",
      toolCallId,
      toolName: state.toolName,
      args: state.args,
    } as AgentEvent)
  }

  private emitToolExecutionUpdate(
    toolCallId: string,
    state: ToolCallState,
    payload: unknown,
  ) {
    this.options.onEvent?.({
      type: "tool_execution_update",
      toolCallId,
      toolName: state.toolName,
      args: state.args,
      partialResult: payload,
    } as AgentEvent)
  }

  private emitToolExecutionEnd(
    toolCallId: string,
    state: ToolCallState,
    payload: unknown,
    isError: boolean,
  ) {
    this.options.onEvent?.({
      type: "tool_execution_end",
      toolCallId,
      toolName: state.toolName,
      result: payload,
      isError,
    } as AgentEvent)
    this.toolCalls.delete(toolCallId)
  }
}

export const runAcpAgent = async (options: RunAcpOptions): Promise<RunAcpResult> => {
  const { config, prompt, contextMessages, onEvent, workspaceRoot, abortSignal } = options
  const fallbackArgs = parseArgs(config.args)
  const commandParts = config.args ? [config.command, ...fallbackArgs] : parseArgs(config.command)
  const command = commandParts[0]
  const args = config.args ? fallbackArgs : commandParts.slice(1)

  if (!command) {
    return {
      outputMessages: [],
      errorMessage: "ACP command is empty",
    }
  }

  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })

  child.stderr.on("data", () => {})

  const input = Writable.toWeb(child.stdin)
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const stream = ndJsonStream(input, output)
  const terminalManager = new TerminalManager(workspaceRoot)
  const client = new AcpClient({ workspaceRoot, onEvent, terminalManager })
  const connection = new ClientSideConnection(() => client, stream)

  let sessionId: string | null = null

  const cancelHandler = async () => {
    if (!sessionId) return
    try {
      await connection.cancel({ sessionId })
    } catch {
      // Best-effort cancel
    }
  }

  const abortListener = () => {
    void cancelHandler()
  }

  if (abortSignal) {
    if (abortSignal.aborted) {
      await cancelHandler()
    } else {
      abortSignal.addEventListener("abort", abortListener)
    }
  }

  try {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    })

    const session = await connection.newSession({
      cwd: workspaceRoot,
      mcpServers: [],
    })
    sessionId = session.sessionId

    const promptBlocks = buildPromptBlocks(prompt, contextMessages)
    const response = await connection.prompt({
      sessionId,
      prompt: promptBlocks,
    })

    client.finalizeAssistantMessage()

    return {
      outputMessages: client.getOutputMessages(),
      errorMessage: resolveStopReason(response.stopReason),
    }
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortListener)
    }
    try {
      child.stdin.end()
    } catch {
      // ignore close errors
    }
    child.kill()
  }
}
