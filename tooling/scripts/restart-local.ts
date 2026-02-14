import { spawn, spawnSync } from "node:child_process"

import { resolveRepoRoot } from "@bbot/shared"

import { writeRestartReportIfNeeded } from "./restart-report-lib"

const RESTART_SCRIPT = {
  missingPm2: "pm2 not found. Install with: npm i -g pm2",
  restartReportWarning: "Warning: failed to write restart report",
}

const runCommand = async (
  command: string,
  args: string[],
  options: { cwd: string },
) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: "inherit" })
    child.on("error", (error) => reject(error))
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
      reject(new Error(`${command} failed (${suffix})`))
    })
  })
}

const ensurePm2 = () => {
  const result = spawnSync("pm2", ["-v"], { stdio: "ignore" })
  if (result.status === 0) return
  console.error(RESTART_SCRIPT.missingPm2)
  process.exit(1)
}

const main = async () => {
  const repoRoot = resolveRepoRoot()
  process.chdir(repoRoot)

  ensurePm2()

  try {
    await writeRestartReportIfNeeded(process.argv.slice(2))
  } catch (error) {
    console.warn(RESTART_SCRIPT.restartReportWarning, error)
  }

  await runCommand("pnpm", ["--filter", "@bbot/core-daemon", "build"], { cwd: repoRoot })
  await runCommand("pnpm", ["--filter", "@bbot/bot-telegram", "build"], { cwd: repoRoot })
  await runCommand("pm2", ["restart", "ecosystem.config.cjs"], { cwd: repoRoot })
}

void main().catch((error) => {
  console.error("Failed to restart local services", error)
  process.exitCode = 1
})
