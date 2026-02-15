import type { KernelConfig } from "../config";
import type { ConfigStore } from "../config-store";
import type { KvStore } from "../kv-store";
import { createChannelMux } from "./channel-mux";
import { createCliChannel } from "./cli-channel";
import { createDiscordChannel } from "./discord-channel";
import { createHeartbeatTrait } from "./heartbeat";
import { createMemoryStore } from "./memory-fs";
import { createLocalSandbox } from "./sandbox-local";
import type { TraitRegistry } from "./types";

export interface TraitDependencies {
  configStore: ConfigStore;
  kvStore: KvStore;
  heartbeatMs: number;
}

export const createDefaultTraits = (
  config: KernelConfig,
  deps: TraitDependencies
): TraitRegistry => {
  const channels = [createCliChannel()];
  channels.push(
    createDiscordChannel({
      configStore: deps.configStore,
      kvStore: deps.kvStore,
    })
  );

  return {
    channel: createChannelMux(channels),
    heartbeat: createHeartbeatTrait(deps.heartbeatMs),
    sandbox: createLocalSandbox(config.sandboxRoot),
    memory: createMemoryStore(deps.kvStore),
  };
};
