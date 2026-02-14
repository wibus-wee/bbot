import { Client } from "@modelcontextprotocol/sdk/client"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { Type } from "@mariozechner/pi-ai"
import type { ImageContent, TextContent } from "@mariozechner/pi-ai"
import type { AgentTool } from "@mariozechner/pi-agent-core"

import type { McpServerConfig } from "./config"

const MCP_CLIENT_INFO = { name: "bbot-agent", version: "0.0.0" }
const MCP_PARAMETERS_SCHEMA = Type.Object({}, { additionalProperties: true })
const MAX_SCHEMA_DESCRIPTION_LENGTH = 1200
const MAX_TEXT_BLOCK_LENGTH = 2000

type McpContentBlock = { type: string; [key: string]: unknown }

type McpCallToolResult = {
  content?: McpContentBlock[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

type LogFn = (message: string) => void

interface McpToolConnection {
  server: McpServerConfig
  client: Client
  tools: AgentTool[]
  close: () => Promise<void>
}

export interface CreateMcpToolsResult {
  tools: AgentTool[]
  close: () => Promise<void>
}

const normalizeServerName = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) return "server"
  const normalized = trimmed.replace(/[^a-zA-Z0-9_-]+/g, "-")
  return normalized || "server"
}

const buildToolName = (server: McpServerConfig, toolName: string): string =>
  `mcp.${normalizeServerName(server.name)}.${toolName}`

const createRequestInit = (
  headers?: Record<string, string>,
): RequestInit | undefined => {
  if (!headers) return undefined
  return { headers }
}

const assertUnreachable = (value: never): never => {
  throw new Error(`Unsupported MCP transport: ${String(value)}`)
}

const createTransport = (server: McpServerConfig) => {
  switch (server.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        stderr: server.stderr,
      })
    case "streamableHttp":
      return new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: createRequestInit(server.headers),
      })
    default:
      return assertUnreachable(server)
  }
}

const safeJsonStringify = (value: unknown, maxLength: number): string | undefined => {
  try {
    const raw = JSON.stringify(value)
    if (!raw) return undefined
    if (raw.length <= maxLength) return raw
    return `${raw.slice(0, maxLength)}...`
  } catch {
    return undefined
  }
}

const buildToolDescription = (server: McpServerConfig, tool: Tool): string => {
  const parts: string[] = []
  if (tool.description) {
    parts.push(tool.description.trim())
  }
  parts.push(`MCP server: ${server.name}.`)

  const schemaText = safeJsonStringify(
    tool.inputSchema,
    MAX_SCHEMA_DESCRIPTION_LENGTH,
  )
  if (schemaText) {
    parts.push(`Input schema: ${schemaText}`)
  }

  return parts.join(" ").trim() || `MCP tool from ${server.name}.`
}

const toTextContent = (text: string): TextContent => ({
  type: "text",
  text,
})

const toImageContent = (data: string, mimeType: string): ImageContent => ({
  type: "image",
  data,
  mimeType,
})

const formatResourceText = (block: McpContentBlock): string | undefined => {
  const resource = block.resource
  if (!resource || typeof resource !== "object") {
    return undefined
  }
  const typedResource = resource as Record<string, unknown>
  const uri = typeof typedResource.uri === "string" ? typedResource.uri : undefined
  const mimeType =
    typeof typedResource.mimeType === "string" ? typedResource.mimeType : undefined

  if (typeof typedResource.text === "string") {
    const snippet = typedResource.text.slice(0, MAX_TEXT_BLOCK_LENGTH)
    return `Resource ${uri ?? "(unknown)"}: ${snippet}`
  }

  if (typeof typedResource.blob === "string") {
    const size = typedResource.blob.length
    const mime = mimeType ?? "application/octet-stream"
    return `Resource ${uri ?? "(unknown)"}: ${mime} (${size} bytes base64)`
  }

  return uri ? `Resource ${uri}` : undefined
}

const normalizeMcpContent = (
  content: McpContentBlock[] | undefined,
  structuredContent?: Record<string, unknown>,
): Array<TextContent | ImageContent> => {
  const blocks = content ?? []
  const normalized: Array<TextContent | ImageContent> = []

  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        if (typeof block.text === "string") {
          normalized.push(toTextContent(block.text))
        }
        break
      }
      case "image": {
        const data = typeof block.data === "string" ? block.data : undefined
        const mimeType =
          typeof block.mimeType === "string" ? block.mimeType : undefined
        if (data && mimeType) {
          normalized.push(toImageContent(data, mimeType))
        } else if (mimeType) {
          normalized.push(toTextContent(`Image result (${mimeType})`))
        } else {
          normalized.push(toTextContent("Image result"))
        }
        break
      }
      case "resource_link": {
        const name = typeof block.name === "string" ? block.name : "(unnamed)"
        const uri = typeof block.uri === "string" ? block.uri : "(unknown uri)"
        const description =
          typeof block.description === "string" ? block.description : ""
        const mimeType =
          typeof block.mimeType === "string" ? block.mimeType : ""
        const suffix = [description, mimeType].filter(Boolean).join(" ")
        const line = suffix
          ? `Resource link: ${name} (${uri}) ${suffix}`
          : `Resource link: ${name} (${uri})`
        normalized.push(toTextContent(line))
        break
      }
      case "resource": {
        const resourceText = formatResourceText(block)
        if (resourceText) {
          normalized.push(toTextContent(resourceText))
        }
        break
      }
      case "audio": {
        const mimeType =
          typeof block.mimeType === "string" ? block.mimeType : "audio"
        normalized.push(toTextContent(`Audio result (${mimeType})`))
        break
      }
      default: {
        const fallback = safeJsonStringify(block, MAX_TEXT_BLOCK_LENGTH)
        if (fallback) {
          normalized.push(toTextContent(`Unhandled MCP content: ${fallback}`))
        }
      }
    }
  }

  if (normalized.length === 0 && structuredContent) {
    const structuredText = safeJsonStringify(
      structuredContent,
      MAX_TEXT_BLOCK_LENGTH,
    )
    if (structuredText) {
      normalized.push(toTextContent(`Structured content: ${structuredText}`))
    }
  }

  if (normalized.length === 0) {
    normalized.push(toTextContent("(no content)"))
  }

  return normalized
}

const contentToErrorText = (
  content: Array<TextContent | ImageContent>,
  structuredContent?: Record<string, unknown>,
): string => {
  const parts = content.map((item) => {
    if (item.type === "text") return item.text
    return `[image:${item.mimeType}]`
  })

  if (parts.length > 0) {
    return parts.join("\n")
  }

  const structuredText = structuredContent
    ? safeJsonStringify(structuredContent, MAX_TEXT_BLOCK_LENGTH)
    : undefined
  return structuredText ?? "MCP tool returned an error"
}

const normalizeArguments = (params: unknown): Record<string, unknown> => {
  if (!params || typeof params !== "object") return {}
  return params as Record<string, unknown>
}

const createMcpAgentTool = (
  server: McpServerConfig,
  client: Client,
  tool: Tool,
): AgentTool => {
  return {
    name: buildToolName(server, tool.name),
    label: `mcp:${server.name}:${tool.name}`,
    description: buildToolDescription(server, tool),
    parameters: MCP_PARAMETERS_SCHEMA,
    execute: async (_toolCallId, params, signal) => {
      const args = normalizeArguments(params)
      const result = (await client.callTool(
        { name: tool.name, arguments: args },
        CallToolResultSchema,
        signal ? { signal } : undefined,
      )) as McpCallToolResult

      const normalizedContent = normalizeMcpContent(
        result.content,
        result.structuredContent,
      )

      if (result.isError) {
        throw new Error(
          contentToErrorText(normalizedContent, result.structuredContent),
        )
      }

      const details: Record<string, unknown> = {
        mcp: {
          server: server.name,
          tool: tool.name,
        },
      }

      if (result.structuredContent) {
        details.structuredContent = result.structuredContent
      }

      return {
        content: normalizedContent,
        details,
      }
    },
  }
}

const connectMcpServer = async (
  server: McpServerConfig,
): Promise<McpToolConnection> => {
  const client = new Client(MCP_CLIENT_INFO, { capabilities: {} })
  const transport = createTransport(server)

  try {
    await client.connect(transport)
    const toolsResult = await client.listTools()
    const tools = toolsResult.tools.map((tool) =>
      createMcpAgentTool(server, client, tool),
    )

    return {
      server,
      client,
      tools,
      close: async () => {
        await client.close()
      },
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to connect MCP server ${server.name}: ${message}`)
  }
}

const collectConnections = async (
  servers: McpServerConfig[],
  logger?: LogFn,
): Promise<McpToolConnection[]> => {
  if (servers.length === 0) return []

  const connections = await Promise.all(
    servers.map(async (server) => {
      try {
        return await connectMcpServer(server)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger?.(`[agent] ${message}`)
        return null
      }
    }),
  )

  return connections.filter(
    (connection): connection is McpToolConnection => Boolean(connection),
  )
}

export const createMcpTools = async (options: {
  servers: McpServerConfig[]
  logger?: LogFn
}): Promise<CreateMcpToolsResult> => {
  const connections = await collectConnections(options.servers, options.logger)
  if (connections.length === 0) {
    return {
      tools: [],
      close: async () => undefined,
    }
  }

  return {
    tools: connections.flatMap((connection) => connection.tools),
    close: async () => {
      await Promise.all(
        connections.map(async (connection) => {
          try {
            await connection.close()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            options.logger?.(
              `[agent] Failed to close MCP server ${connection.server.name}: ${message}`,
            )
          }
        }),
      )
    },
  }
}
