import { promises as fs } from "fs";
import path from "path";

import type { MemoryTrait } from "./types";

type MemoryStore = Record<string, string>;

export const createMemoryStore = (filePath: string): MemoryTrait => {
  const ensureDir = async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  };

  const load = async (): Promise<MemoryStore> => {
    try {
      const contents = await fs.readFile(filePath, "utf-8");
      return JSON.parse(contents) as MemoryStore;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  };

  const save = async (store: MemoryStore) => {
    await ensureDir();
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
  };

  return {
    kind: "memory",
    append: async ({ key, value }) => {
      const store = await load();
      store[key] = value;
      await save(store);
    },
    read: async ({ key }) => {
      const store = await load();
      return store[key] ?? null;
    },
  };
};
