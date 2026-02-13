import { createArchiveCommand } from "./archive"
import { createCancelCommand } from "./cancel"
import { createForkCommand } from "./fork"
import { createHelpCommand } from "./help"
import { createNewCommand } from "./new"
import { createPullCommand } from "./pull"
import { createResumeCommand } from "./resume"
import { createStartCommand } from "./start"
import type { CommandModule } from "./types"

export const createCommandModules = (): CommandModule[] => [
  createStartCommand(),
  createHelpCommand(),
  createNewCommand(),
  createForkCommand(),
  createResumeCommand(),
  createCancelCommand(),
  createArchiveCommand(),
  createPullCommand(),
]

export type { CommandContext, CommandListItem, CommandModule } from "./types"
