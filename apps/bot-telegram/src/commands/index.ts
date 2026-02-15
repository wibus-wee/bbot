import { createAgentCommand } from "./agent"
import { createArchiveCommand } from "./archive"
import { createCancelCommand } from "./cancel"
import { createCompactCommand } from "./compact"
import { createDoctorCommand } from "./doctor"
import { createForkCommand } from "./fork"
import { createHelpCommand } from "./help"
import { createModeCommand } from "./mode"
import { createNewCommand } from "./new"
import { createProviderCommand } from "./provider"
import { createRestartCommand } from "./restart"
import { createResumeCommand } from "./resume"
import { createSessionCommand } from "./session"
import { createStartCommand } from "./start"
import { createStatusCommand } from "./status"
import { createSystemCommand } from "./system"
import type { CommandModule } from "./types"

export const createCommandModules = (): CommandModule[] => [
  createStartCommand(),
  createStatusCommand(),
  createNewCommand(),
  createResumeCommand(),
  createCancelCommand(),
  createSessionCommand(),
  createAgentCommand(),
  createSystemCommand(),
  createHelpCommand(),
  createDoctorCommand(),
  createModeCommand(),
  createProviderCommand(),
  createForkCommand(),
  createCompactCommand(),
  createArchiveCommand(),
  createRestartCommand(),
]

export type { CommandContext, CommandListItem, CommandModule } from "./types"
