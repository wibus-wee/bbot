import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { consola } from 'consola';

const rootDir = join(__dirname, '../../..');

type RunOptions = {
  label: string;
  command: string;
  args: string[];
};

const runCommand = ({ label, command, args }: RunOptions): Promise<void> =>
  new Promise((resolve, reject) => {
    consola.info(`[sdk-generator] ${label}`);

    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootDir,
      env: process.env,
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = code !== null ? `exit code ${code}` : `signal ${signal ?? 'unknown'}`;
      reject(new Error(`${label} failed with ${reason}`));
    });
  });

const main = async (): Promise<void> => {
  await runCommand({
    label: 'openapi:generate',
    command: 'pnpm',
    args: ['--filter', '@bbot/core-daemon', 'run', 'openapi:generate'],
  });

  await runCommand({
    label: 'sdk:generate',
    command: 'pnpm',
    args: ['--filter', '@bbot/sdk', 'run', 'sdk:generate'],
  });

  consola.success('sdk workflow finished');
};

main().catch((error) => {
  consola.error(error);
  process.exitCode = 1;
});
