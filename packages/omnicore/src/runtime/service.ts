import os from "os";
import path from "path";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { spawn, spawnSync } from "child_process";

export interface ServiceInstallOptions {
  label: string;
  root: string;
  adapterPort: number;
  dataDir?: string;
  dbPath?: string;
  logsDir?: string | null;
  bbotBin?: string;
  start: boolean;
}

export interface ServiceUpdateOptions extends ServiceInstallOptions {}

export interface ServiceStatusOptions {
  label: string;
}

export interface ServiceControlOptions {
  label: string;
}

export interface ServiceLogsOptions {
  logsDir?: string;
  lines: number;
  follow: boolean;
}

export interface ServiceUninstallOptions {
  label: string;
}

type ServiceTarget = "launchd" | "systemd";

const detectTarget = (): ServiceTarget => {
  if (process.platform === "darwin") {
    return "launchd";
  }
  if (process.platform === "linux") {
    return "systemd";
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
};

const resolveUserId = (): number => {
  if (typeof process.getuid === "function") {
    return process.getuid();
  }
  const uid = Number(process.env.UID ?? "");
  if (!Number.isFinite(uid)) {
    throw new Error("Unable to resolve user id for launchd.");
  }
  return uid;
};

const resolveBbotBin = (explicit?: string): string => {
  if (explicit?.trim()) {
    return path.resolve(process.cwd(), explicit.trim());
  }
  const envBin = process.env.BBOT_BIN;
  if (envBin?.trim()) {
    return envBin.trim();
  }
  const result = spawnSync("which", ["bbot"], { encoding: "utf8" });
  const found = result.stdout?.trim();
  if (result.status === 0 && found) {
    return found;
  }
  throw new Error("Cannot locate `bbot` binary. Pass --bin <path>.");
};

const ensureDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
};

const ensureParentDir = async (filePath: string): Promise<void> => {
  await ensureDir(path.dirname(filePath));
};

const quoteSystemd = (value: string): string => {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${escaped}"`;
};

const renderLaunchdPlist = (
  label: string,
  bbotBin: string,
  root: string,
  env: Record<string, string>,
  logsDir: string | null
): string => {
  const envEntries = Object.entries(env)
    .map(
      ([key, value]) =>
        `      <key>${key}</key>\n      <string>${value}</string>`
    )
    .join("\n");

  const logEntries = logsDir
    ? `  <key>StandardOutPath</key>
  <string>${path.join(logsDir, "omnicore.out.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, "omnicore.err.log")}</string>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${bbotBin}</string>
    <string>supervisor</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${root}</string>

  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
${logEntries}</dict>
</plist>
`;
};

const renderSystemdUnit = (
  label: string,
  bbotBin: string,
  root: string,
  env: Record<string, string>,
  logsDir: string | null
): string => {
  const envLines = Object.entries(env)
    .map(([key, value]) => `Environment=${key}=${quoteSystemd(value)}`)
    .join("\n");

  const logLines = logsDir
    ? `StandardOutput=append:${path.join(logsDir, "omnicore.out.log")}
StandardError=append:${path.join(logsDir, "omnicore.err.log")}`
    : "";

  const execStart = `${quoteSystemd(bbotBin)} supervisor`;

  return `[Unit]
Description=BBot OmniCore Supervisor (${label})
After=network.target

[Service]
Type=simple
WorkingDirectory=${root}
${envLines}
ExecStart=${execStart}
Restart=on-failure
RestartSec=2
${logLines}

[Install]
WantedBy=default.target
`;
};

const runCommand = (cmd: string, args: string[]): void => {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with code ${result.status}`);
  }
};

const runCommandAllowFailure = (cmd: string, args: string[]): void => {
  spawnSync(cmd, args, { stdio: "inherit" });
};

const resolveServiceName = (label: string): string => {
  return label.endsWith(".service") ? label : `${label}.service`;
};

const writeLaunchdPlist = async (
  label: string,
  bbotBin: string,
  root: string,
  env: Record<string, string>,
  logsDir: string | null
): Promise<string> => {
  const home = os.homedir();
  const agentsDir = path.join(home, "Library", "LaunchAgents");
  await ensureDir(agentsDir);
  const plistPath = path.join(agentsDir, `${label}.plist`);
  const plist = renderLaunchdPlist(label, bbotBin, root, env, logsDir);
  await writeFile(plistPath, plist, "utf8");
  return plistPath;
};

const writeSystemdUnit = async (
  label: string,
  bbotBin: string,
  root: string,
  env: Record<string, string>,
  logsDir: string | null
): Promise<string> => {
  const home = os.homedir();
  const systemdDir = path.join(home, ".config", "systemd", "user");
  await ensureDir(systemdDir);
  const serviceName = resolveServiceName(label);
  const unitPath = path.join(systemdDir, serviceName);
  const unit = renderSystemdUnit(label, bbotBin, root, env, logsDir);
  await writeFile(unitPath, unit, "utf8");
  return unitPath;
};

const prepareServiceEnv = async (
  options: ServiceInstallOptions
): Promise<{
  label: string;
  root: string;
  bbotBin: string;
  logsDir: string | null;
  env: Record<string, string>;
}> => {
  const label = options.label.trim();
  const root = path.resolve(options.root);
  const bbotBin = resolveBbotBin(options.bbotBin);
  const logsDir = options.logsDir ? path.resolve(options.logsDir) : null;

  const env: Record<string, string> = {
    OMNICORE_ROOT: root,
    OMNICORE_ADAPTER_PORT: String(options.adapterPort),
    OMNICORE_KERNEL_CMD: bbotBin,
    OMNICORE_KERNEL_ARGS: "kernel",
    OMNICORE_KERNEL_CWD: root,
  };

  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }

  if (options.dataDir?.trim()) {
    env.OMNICORE_DATA_DIR = path.resolve(options.dataDir.trim());
  }
  if (options.dbPath?.trim()) {
    env.OMNICORE_DB_PATH = path.resolve(options.dbPath.trim());
  }

  await ensureDir(root);
  if (env.OMNICORE_DATA_DIR) {
    await ensureDir(env.OMNICORE_DATA_DIR);
  }
  if (env.OMNICORE_DB_PATH) {
    await ensureParentDir(env.OMNICORE_DB_PATH);
  }
  if (logsDir) {
    await ensureDir(logsDir);
  }

  return {
    label,
    root,
    bbotBin,
    logsDir,
    env,
  };
};

export const installService = async (options: ServiceInstallOptions): Promise<void> => {
  const target = detectTarget();
  const { label, root, bbotBin, logsDir, env } = await prepareServiceEnv(options);

  if (target === "launchd") {
    const plistPath = await writeLaunchdPlist(label, bbotBin, root, env, logsDir);
    const domain = `gui/${resolveUserId()}`;
    runCommand("launchctl", ["bootstrap", domain, plistPath]);
    runCommand("launchctl", ["enable", `${domain}/${label}`]);
    if (options.start) {
      runCommand("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    }
    return;
  }

  const serviceName = resolveServiceName(label);
  await writeSystemdUnit(label, bbotBin, root, env, logsDir);
  runCommand("systemctl", ["--user", "daemon-reload"]);
  runCommand("systemctl", ["--user", "enable", serviceName]);
  if (options.start) {
    runCommand("systemctl", ["--user", "restart", serviceName]);
  }
};

export const updateService = async (options: ServiceUpdateOptions): Promise<void> => {
  const target = detectTarget();
  const { label, root, bbotBin, logsDir, env } = await prepareServiceEnv(options);

  if (target === "launchd") {
    const plistPath = await writeLaunchdPlist(label, bbotBin, root, env, logsDir);
    const domain = `gui/${resolveUserId()}`;
    runCommandAllowFailure("launchctl", ["bootout", domain, plistPath]);
    runCommand("launchctl", ["bootstrap", domain, plistPath]);
    runCommand("launchctl", ["enable", `${domain}/${label}`]);
    if (options.start) {
      runCommand("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    }
    return;
  }

  const serviceName = resolveServiceName(label);
  await writeSystemdUnit(label, bbotBin, root, env, logsDir);
  runCommand("systemctl", ["--user", "daemon-reload"]);
  runCommand("systemctl", ["--user", "enable", serviceName]);
  if (options.start) {
    runCommand("systemctl", ["--user", "restart", serviceName]);
  }
};

export const serviceStatus = (options: ServiceStatusOptions): void => {
  const target = detectTarget();
  const label = options.label.trim();

  if (target === "launchd") {
    const domain = `gui/${resolveUserId()}`;
    runCommand("launchctl", ["print", `${domain}/${label}`]);
    return;
  }

  const serviceName = resolveServiceName(label);
  runCommand("systemctl", ["--user", "status", serviceName]);
};

export const startService = (options: ServiceControlOptions): void => {
  const target = detectTarget();
  const label = options.label.trim();

  if (target === "launchd") {
    const domain = `gui/${resolveUserId()}`;
    runCommand("launchctl", ["enable", `${domain}/${label}`]);
    runCommand("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    return;
  }

  const serviceName = resolveServiceName(label);
  runCommand("systemctl", ["--user", "start", serviceName]);
};

export const stopService = (options: ServiceControlOptions): void => {
  const target = detectTarget();
  const label = options.label.trim();

  if (target === "launchd") {
    const domain = `gui/${resolveUserId()}`;
    runCommandAllowFailure("launchctl", ["stop", `${domain}/${label}`]);
    return;
  }

  const serviceName = resolveServiceName(label);
  runCommand("systemctl", ["--user", "stop", serviceName]);
};

export const restartService = (options: ServiceControlOptions): void => {
  const target = detectTarget();
  const label = options.label.trim();

  if (target === "launchd") {
    const domain = `gui/${resolveUserId()}`;
    runCommand("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    return;
  }

  const serviceName = resolveServiceName(label);
  runCommand("systemctl", ["--user", "restart", serviceName]);
};

export const serviceLogs = (options: ServiceLogsOptions): void => {
  const logsDir = options.logsDir
    ? path.resolve(options.logsDir)
    : loadDefaultLogsDir();
  const outLog = path.join(logsDir, "omnicore.out.log");
  const errLog = path.join(logsDir, "omnicore.err.log");

  const files = [outLog, errLog].filter((file) => existsSync(file));
  if (files.length === 0) {
    throw new Error(`No log files found in ${logsDir}`);
  }

  const args = ["-n", String(options.lines)];
  if (options.follow) {
    args.push("-f");
  }
  args.push(...files);

  const child = spawn("tail", args, { stdio: "inherit" });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
};

export const uninstallService = async (options: ServiceUninstallOptions): Promise<void> => {
  const target = detectTarget();
  const label = options.label.trim();

  if (target === "launchd") {
    const home = os.homedir();
    const plistPath = path.join(home, "Library", "LaunchAgents", `${label}.plist`);
    const domain = `gui/${resolveUserId()}`;
    if (existsSync(plistPath)) {
      runCommand("launchctl", ["bootout", domain, plistPath]);
      await rm(plistPath);
    }
    return;
  }

  const home = os.homedir();
  const systemdDir = path.join(home, ".config", "systemd", "user");
  const serviceName = resolveServiceName(label);
  const unitPath = path.join(systemdDir, serviceName);
  runCommandAllowFailure("systemctl", ["--user", "disable", "--now", serviceName]);
  runCommandAllowFailure("systemctl", ["--user", "daemon-reload"]);
  if (existsSync(unitPath)) {
    await rm(unitPath);
  }
};

export const loadDefaultWorkspaceRoot = (): string => {
  return path.join(os.homedir(), ".bbot", "workspace");
};

export const loadDefaultLogsDir = (): string => {
  return path.join(os.homedir(), ".bbot", "logs");
};
