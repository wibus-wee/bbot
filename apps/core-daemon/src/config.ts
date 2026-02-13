import { z } from "zod"

import { loadEnv } from "@bbot/shared"

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://bbot:bbot@localhost:5432/bbot"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORE_API_TOKEN: z.string().min(1).optional(),
  NODE_ENV: z.string().optional(),
})

const env = loadEnv(schema)

export const config = {
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  coreApiToken: env.CORE_API_TOKEN ?? "",
  nodeEnv: env.NODE_ENV ?? "development",
}
