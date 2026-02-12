import "dotenv/config"

import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { stringify } from "yaml"

import { createDatabase } from "@bbot/database"

import { createApp } from "../src/app"
import { config } from "../src/config"

const run = async () => {
  const { db, close } = createDatabase(config.databaseUrl)
  const app = createApp(db)

  try {
    const response = await app.handle(
      new Request("http://localhost/openapi/json"),
    )
    if (!response.ok) {
      throw new Error(`Failed to read OpenAPI: ${response.status}`)
    }

    const spec = await response.json()

    const repoRoot = resolve(process.cwd(), "../..")
    const protocolDir = resolve(repoRoot, "packages/protocol")

    await writeFile(
      resolve(protocolDir, "openapi.json"),
      JSON.stringify(spec, null, 2),
    )
  } finally {
    await close()
  }
}

void run()
