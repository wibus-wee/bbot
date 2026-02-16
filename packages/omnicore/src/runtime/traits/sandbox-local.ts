import { spawn } from "child_process";

import type { SandboxTrait } from "./types";

export const createLocalSandbox = (sandboxRoot: string): SandboxTrait => {
  return {
    kind: "sandbox",
    run: async ({ command }) => {
      const child = spawn("bash", ["-lc", command], {
        cwd: sandboxRoot,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on("close", (code) => {
          resolve(code ?? 0);
        });
      });

      return {
        stdout,
        stderr,
        exitCode,
      };
    },
  };
};
