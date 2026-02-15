import path from "path";

import type { KernelConfig } from "../config";
import { createChannelMux } from "./channel-mux";
import { createCliChannel } from "./cli-channel";
import { createHeartbeatTrait } from "./heartbeat";
import { createMemoryStore } from "./memory-fs";
import { createLocalSandbox } from "./sandbox-local";
import type { TraitRegistry } from "./types";

export const createDefaultTraits = (config: KernelConfig): TraitRegistry => {
  const channels = [createCliChannel()];

  return {
    channel: createChannelMux(channels),
    heartbeat: createHeartbeatTrait(config.heartbeatMs),
    sandbox: createLocalSandbox(config.sandboxRoot),
    memory: createMemoryStore(path.join(config.dataDir, "memory.json")),
  };
};
