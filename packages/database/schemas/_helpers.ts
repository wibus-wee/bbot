import { createId } from "@bbot/shared"
import { timestamp } from "drizzle-orm/pg-core"

export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" })

export const createdAt = () => timestamptz("created_at").defaultNow().notNull()

export const updatedAt = () =>
  timestamptz("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date())

export const accessedAt = () => timestamptz("accessed_at").defaultNow().notNull()

export const timestamps = {
  accessedAt: accessedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}

export const idGenerator = (prefix: string) => () => createId(prefix)
