#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync } = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const srcCliPath = path.join(packageRoot, "src/entry/cli.ts");
const distCliPath = path.join(packageRoot, "dist/entry/cli.js");
const args = process.argv.slice(2);
const logDir =
  process.env.BBOT_LOG_DIR || path.join(os.homedir(), ".bbot", "logs");
const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const logPath = path.join(logDir, `bbot-cli-${dateStamp}.log`);

const writeLog = (level, message, meta) => {
  try {
    mkdirSync(logDir, { recursive: true });
    const entry = {
      level,
      time: new Date().toISOString(),
      message,
      ...meta,
    };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch {}
};

if (!process.env.OMNICORE_KERNEL_CMD) {
  process.env.OMNICORE_KERNEL_CMD = __filename;
}
if (!process.env.OMNICORE_KERNEL_ARGS) {
  process.env.OMNICORE_KERNEL_ARGS = "kernel";
}

const resolveTsxCli = () => {
  try {
    const tsxPackageJson = require.resolve("tsx/package.json", {
      paths: [packageRoot, process.cwd()],
    });
    const tsxDir = path.dirname(tsxPackageJson);
    const tsxPackage = JSON.parse(require("fs").readFileSync(tsxPackageJson, "utf8"));
    return path.resolve(tsxDir, tsxPackage.bin);
  } catch {
    return null;
  }
};

const spawnCli = (targetPath, extraArgs = []) =>
  spawn(process.execPath, [...extraArgs, targetPath, ...args], { stdio: "inherit" });

let child;
if (existsSync(srcCliPath) && !process.env.BBOT_FORCE_DIST) {
  const tsxCliPath = resolveTsxCli();
  if (tsxCliPath) {
    child = spawnCli(srcCliPath, [tsxCliPath]);
  }
}

if (!child) {
  if (!existsSync(distCliPath)) {
    const message =
      "[bbot] CLI is not built. Run: pnpm --filter @bbot/omnicore build";
    console.error(message);
    writeLog("error", message);
    process.exit(1);
  }
  child = spawnCli(distCliPath);
}

const forwardSignal = (signal) => {
  if (child && !child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGHUP", () => forwardSignal("SIGHUP"));

child.on("error", (error) => {
  console.error("[bbot] child process error", error);
  writeLog("error", "[bbot] child process error", {
    error: error && error.message ? error.message : String(error),
  });
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
