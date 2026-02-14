import { z } from "zod"

const stdioServerSchema = z.object({
  name: z.string().min(1),
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
  stderr: z.enum(["inherit", "pipe", "ignore"]).optional(),
})

const streamableHttpServerSchema = z.object({
  name: z.string().min(1),
  transport: z.literal("streamableHttp"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
})

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  stdioServerSchema,
  streamableHttpServerSchema,
])

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

const mcpServersSchema = z.array(McpServerConfigSchema)

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid AGENT_MCP_SERVERS JSON: ${message}`)
  }
}

export const parseMcpServers = (raw?: string): McpServerConfig[] => {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []

  const parsed = parseJson(trimmed)
  const result = mcpServersSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid AGENT_MCP_SERVERS config: ${result.error.message}`)
  }

  const seen = new Set<string>()
  for (const server of result.data) {
    if (seen.has(server.name)) {
      throw new Error(`Duplicate MCP server name: ${server.name}`)
    }
    seen.add(server.name)
  }

  return result.data
}
