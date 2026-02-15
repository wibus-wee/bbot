import path from "path";

export interface KernelConfig {
  dataDir: string;
  missionPath: string;
  heartbeatMs: number;
  sandboxRoot: string;
  modelSpec?: string;
}

export interface SupervisorConfig {
  dataDir: string;
  kernelCommand: string;
  kernelArgs: string[];
  kernelCwd: string;
  restartDebounceMs: number;
}

export const loadKernelConfig = (): KernelConfig => {
  const cwd = process.cwd();
  const root = process.env.OMNICORE_ROOT ?? process.env.INIT_CWD ?? cwd;
  return {
    dataDir: process.env.OMNICORE_DATA_DIR ?? path.join(root, ".omnicore"),
    missionPath: process.env.OMNICORE_MISSION_PATH ?? path.join(root, "MISSION.md"),
    heartbeatMs: Number(process.env.OMNICORE_HEARTBEAT_MS ?? "60000"),
    sandboxRoot: process.env.OMNICORE_SANDBOX_ROOT ?? root,
    modelSpec: process.env.OMNICORE_MODEL,
  };
};

export const loadSupervisorConfig = (): SupervisorConfig => {
  const cwd = process.cwd();
  const root = process.env.OMNICORE_ROOT ?? process.env.INIT_CWD ?? cwd;
  const kernelCommand = process.env.OMNICORE_KERNEL_CMD ?? "node";
  const kernelArgs = (process.env.OMNICORE_KERNEL_ARGS ?? "dist/cli.js kernel")
    .split(" ")
    .filter((part) => part.length > 0);
  return {
    dataDir: process.env.OMNICORE_DATA_DIR ?? path.join(root, ".omnicore"),
    kernelCommand,
    kernelArgs,
    kernelCwd: process.env.OMNICORE_KERNEL_CWD ?? cwd,
    restartDebounceMs: Number(process.env.OMNICORE_RESTART_DEBOUNCE_MS ?? "1000"),
  };
};
