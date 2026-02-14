import { createArchiveCommand } from "./archive"
import { createCancelCommand } from "./cancel"
import { createCompactCommand } from "./compact"
import { createForkCommand } from "./fork"
import { createHelpCommand } from "./help"
import { createNewCommand } from "./new"
import { createProviderCommand } from "./provider"
import { createPullCommand } from "./pull"
import { createResumeCommand } from "./resume"
import { createStartCommand } from "./start"
import type { CommandModule } from "./types"

export const createCommandModules = (): CommandModule[] => [
  createStartCommand(),
  createHelpCommand(),
  createProviderCommand(),
  createNewCommand(),
  createForkCommand(),
  createResumeCommand(),
  createCompactCommand(),
  createCancelCommand(),
  createArchiveCommand(),
  createPullCommand(),
]

export type { CommandContext, CommandListItem, CommandModule } from "./types"
