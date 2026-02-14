import { asc, eq } from "drizzle-orm"

import { schema } from "@bbot/database"
import type { Database } from "@bbot/database"

const { systemConfigs } = schema

export const listSystemConfigs = async (db: Database) => {
  return db.select().from(systemConfigs).orderBy(asc(systemConfigs.key))
}

export const getSystemConfig = async (db: Database, key: string) => {
  const [config] = await db
    .select()
    .from(systemConfigs)
    .where(eq(systemConfigs.key, key))
    .limit(1)

  return config ?? null
}

export const upsertSystemConfig = async (
  db: Database,
  input: { key: string; value: unknown },
) => {
  const now = new Date()
  const [config] = await db
    .insert(systemConfigs)
    .values({
      key: input.key,
      value: input.value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemConfigs.key,
      set: {
        value: input.value,
        updatedAt: now,
      },
    })
    .returning()

  return config ?? null
}

export const deleteSystemConfig = async (db: Database, key: string) => {
  const [config] = await db
    .delete(systemConfigs)
    .where(eq(systemConfigs.key, key))
    .returning()

  return config ?? null
}
