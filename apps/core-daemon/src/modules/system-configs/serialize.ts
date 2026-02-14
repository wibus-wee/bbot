import { toIsoRequired } from "../shared/serialize"

import type { schema } from "@bbot/database"

export const serializeSystemConfig = (
  row: typeof schema.systemConfigs.$inferSelect,
) => ({
  id: row.id,
  key: row.key,
  value: row.value,
  createdAt: toIsoRequired(row.createdAt),
  updatedAt: toIsoRequired(row.updatedAt),
})
