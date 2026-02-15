import type { Event } from "../events";

export interface ChannelTrait {
  kind: "channel";
  id: string;
  start: (emit: (event: Event) => Promise<void>) => () => void;
  sendMessage: (input: { actorId: string; text: string; traceId: string }) => Promise<void>;
}

export interface HeartbeatTrait {
  kind: "heartbeat";
  start: (emit: (event: Event) => Promise<void>) => () => void;
}

export interface SandboxTrait {
  kind: "sandbox";
  run: (input: { command: string }) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface MemoryTrait {
  kind: "memory";
  append: (input: { key: string; value: string }) => Promise<void>;
  read: (input: { key: string }) => Promise<string | null>;
}

export interface TraitRegistry {
  channel: ChannelTrait;
  heartbeat: HeartbeatTrait;
  sandbox: SandboxTrait;
  memory: MemoryTrait;
}
