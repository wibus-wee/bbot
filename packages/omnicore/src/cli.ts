import { loadKernelConfig, loadSupervisorConfig } from "./config";
import { ConfigStore } from "./config-store";
import { openDb } from "./db";
import { runMigrations } from "./migrations";
import { startKernel } from "./kernel";
import { runSupervisor } from "./supervisor";

const command = process.argv[2];

const withConfigStore = async <T>(fn: (store: ConfigStore) => Promise<T>): Promise<T> => {
  const config = loadKernelConfig();
  const db = openDb({ path: config.dbPath });
  await runMigrations(db);
  const store = new ConfigStore(db);
  return fn(store);
};

const handleConfig = async () => {
  const sub = process.argv[3];
  switch (sub) {
    case "set-model": {
      const provider = process.argv[4];
      const model = process.argv[5];
      if (!provider || !model) {
        console.log("Usage: omnicore config set-model <provider> <model>");
        return;
      }
      await withConfigStore(async (store) => {
        store.setKernelSettings({ modelProvider: provider, modelName: model });
      });
      console.log("[omnicore] model updated");
      return;
    }
    case "set-secret": {
      const key = process.argv[4];
      const value = process.argv[5];
      if (!key || !value) {
        console.log("Usage: omnicore config set-secret <key> <value>");
        return;
      }
      await withConfigStore(async (store) => {
        store.setSecret(key, value);
      });
      console.log("[omnicore] secret updated");
      return;
    }
    case "show": {
      await withConfigStore(async (store) => {
        const settings = store.getKernelSettings();
        console.log(JSON.stringify(settings, null, 2));
      });
      return;
    }
    default:
      console.log("Usage: omnicore config <set-model|set-secret|show>");
  }
};

const main = async () => {
  switch (command) {
    case "kernel":
      await startKernel(loadKernelConfig());
      return;
    case "supervisor":
      await runSupervisor(loadSupervisorConfig());
      return;
    case "config":
      await handleConfig();
      return;
    default:
      console.log("Usage: omnicore <kernel|supervisor|config>");
  }
};

void main();
