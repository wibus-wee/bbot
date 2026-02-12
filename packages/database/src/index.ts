import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "../schemas"

export type Database = ReturnType<typeof createDatabase>["db"]

export const createDatabase = (connectionString: string) => {
  const pool = new Pool({ connectionString })
  const db = drizzle(pool, { schema })

  const close = async () => {
    await pool.end()
  }

  return { db, pool, close }
}

export { schema }
