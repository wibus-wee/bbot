import { existsSync } from "fs";
import path from "path";

export interface KernelConfig {
  root: string;
  dbPath: string;
  sandboxRoot: string;
  adapterPort: number;
}

export interface SupervisorConfig {
  dbPath: string;
  kernelCommand: string;
  kernelArgs: string[];
  kernelCwd: string;
  restartDebounceMs: number;
}

const findWorkspaceRoot = (startDir: string): string | null => {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    const pnpmWorkspace = path.join(current, "pnpm-workspace.yaml");
    const gitDir = path.join(current, ".git");
    if (existsSync(pnpmWorkspace) || existsSync(gitDir)) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }

  return null;
};

export const loadKernelConfig = (): KernelConfig => {
  const cwd = process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);
  const root = process.env.OMNICORE_ROOT ?? workspaceRoot ?? process.env.INIT_CWD ?? cwd;
  const dataDir = process.env.OMNICORE_DATA_DIR ?? path.join(root, ".omnicore");
  return {
    root,
    dbPath: process.env.OMNICORE_DB_PATH ?? path.join(dataDir, "omnicore.db"),
    sandboxRoot: process.env.OMNICORE_SANDBOX_ROOT ?? root,
    adapterPort: Number(process.env.OMNICORE_ADAPTER_PORT ?? "8787"),
  };
};

export const loadSupervisorConfig = (): SupervisorConfig => {
  const cwd = process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);
  const root = process.env.OMNICORE_ROOT ?? workspaceRoot ?? process.env.INIT_CWD ?? cwd;
  const dataDir = process.env.OMNICORE_DATA_DIR ?? path.join(root, ".omnicore");
  const kernelCommand = process.env.OMNICORE_KERNEL_CMD ?? "node";
  const kernelArgs = (process.env.OMNICORE_KERNEL_ARGS ?? "dist/cli.js kernel")
    .split(" ")
    .filter((part) => part.length > 0);
  return {
    dbPath: process.env.OMNICORE_DB_PATH ?? path.join(dataDir, "omnicore.db"),
    kernelCommand,
    kernelArgs,
    kernelCwd: process.env.OMNICORE_KERNEL_CWD ?? cwd,
    restartDebounceMs: Number(process.env.OMNICORE_RESTART_DEBOUNCE_MS ?? "1000"),
  };
};
