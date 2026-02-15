import type { KvStore } from "../kv-store";
import type { MemoryTrait } from "./types";

export const createMemoryStore = (store: KvStore): MemoryTrait => {
  const prefix = "memory:";
  return {
    kind: "memory",
    append: async ({ key, value }) => {
      store.set(`${prefix}${key}`, JSON.stringify({ value }));
    },
    read: async ({ key }) => {
      const raw = store.get(`${prefix}${key}`);
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as { value?: string };
        return parsed.value ?? null;
      } catch {
        return null;
      }
    },
  };
};
