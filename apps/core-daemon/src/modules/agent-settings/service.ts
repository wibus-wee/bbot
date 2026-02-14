import type { Database } from "@bbot/database"

import { getSystemConfig } from "../system-configs/service"
import { normalizeAgentSettings } from "./merge"

const AGENT_SETTINGS_KEY = "agent.settings"

export const getGlobalAgentSettings = async (db: Database) => {
  const config = await getSystemConfig(db, AGENT_SETTINGS_KEY)
  if (!config) {
    return {}
  }
  return normalizeAgentSettings(config.value, AGENT_SETTINGS_KEY)
}
