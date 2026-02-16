import type { KernelConfig } from "../config";
import { createHeartbeatTrait } from "./heartbeat";
import { createLocalSandbox } from "./sandbox-local";
import type { TraitRegistry } from "./types";

export interface TraitDependencies {
  heartbeatMs: number;
}

export const createDefaultTraits = (
  config: KernelConfig,
  deps: TraitDependencies
): TraitRegistry => ({
  heartbeat: createHeartbeatTrait(deps.heartbeatMs),
  sandbox: createLocalSandbox(config.sandboxRoot),
});
