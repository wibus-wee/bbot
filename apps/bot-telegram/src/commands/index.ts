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
import { createStartCommand } from "./start"
import { createStatusCommand } from "./status"
import type { CommandModule } from "./types"

export const createCommandModules = (): CommandModule[] => [
  createStartCommand(),
  createHelpCommand(),
  createStatusCommand(),
  createDoctorCommand(),
  createModeCommand(),
  createProviderCommand(),
  createNewCommand(),
  createForkCommand(),
  createResumeCommand(),
  createCompactCommand(),
  createCancelCommand(),
  createArchiveCommand(),
  createRestartCommand(),
]

export type { CommandContext, CommandListItem, CommandModule } from "./types"
