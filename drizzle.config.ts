import { defineConfig } from "drizzle-kit"

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://bbot:bbot@localhost:5432/bbot"

export default defineConfig({
  dialect: "postgresql",
  strict: true,
  schema: "./packages/database/schemas/index.ts",
  out: "./packages/database/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
})
