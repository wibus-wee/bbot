import { describe, expect, it } from "vitest"

import { parseMcpServers } from "../mcp/config"

describe("parseMcpServers", () => {
  it("returns empty list for empty input", () => {
    expect(parseMcpServers(undefined)).toEqual([])
    expect(parseMcpServers(" ")).toEqual([])
  })

  it("parses stdio server configs", () => {
    const raw = JSON.stringify([
      {
        name: "local",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      },
    ])

    const servers = parseMcpServers(raw)
    expect(servers).toHaveLength(1)
    expect(servers[0]?.name).toBe("local")
    expect(servers[0]?.transport).toBe("stdio")
  })

  it("rejects duplicate server names", () => {
    const raw = JSON.stringify([
      { name: "dup", transport: "stdio", command: "node" },
      { name: "dup", transport: "stdio", command: "node" },
    ])

    expect(() => parseMcpServers(raw)).toThrow(/Duplicate MCP server name/)
  })

  it("rejects unsupported transport", () => {
    const raw = JSON.stringify([
      { name: "legacy", transport: "sse", url: "https://example.com" },
    ])

    expect(() => parseMcpServers(raw)).toThrow(/Invalid AGENT_MCP_SERVERS/)
  })
})
