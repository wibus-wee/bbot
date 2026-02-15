import type { Event } from "../events";

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

export interface TraitRegistry {
  heartbeat: HeartbeatTrait;
  sandbox: SandboxTrait;
}
