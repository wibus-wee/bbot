import { toIsoRequired, toOptionalJson } from "../shared/serialize"

import type { schema } from "@bbot/database"

export const serializeWorkspace = (row: typeof schema.workspaceSessions.$inferSelect) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  rootPath: row.rootPath ?? undefined,
  metadata: toOptionalJson(row.metadata),
  accessedAt: toIsoRequired(row.accessedAt),
  createdAt: toIsoRequired(row.createdAt),
  updatedAt: toIsoRequired(row.updatedAt),
})
