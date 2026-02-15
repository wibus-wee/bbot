import { promises as fs } from "fs";
import path from "path";

import type { Event } from "./events";

export class JsonlEventLog {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(event: Event): Promise<void> {
    await this.ensureDir();
    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(this.filePath, line, "utf-8");
  }

  async readAll(): Promise<Event[]> {
    try {
      const contents = await fs.readFile(this.filePath, "utf-8");
      return contents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Event);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async tail(
    onEvent: (event: Event) => Promise<void>,
    options: { pollMs?: number; fromEnd?: boolean } = {}
  ): Promise<() => void> {
    const pollMs = options.pollMs ?? 500;
    let offset = 0;
    let stopped = false;

    const refreshOffset = async () => {
      try {
        const stats = await fs.stat(this.filePath);
        offset = options.fromEnd ? stats.size : 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        offset = 0;
      }
    };

    await this.ensureDir();
    await refreshOffset();

    const poll = async () => {
      if (stopped) {
        return;
      }
      try {
        const stats = await fs.stat(this.filePath);
        if (stats.size > offset) {
          const length = stats.size - offset;
          const handle = await fs.open(this.filePath, "r");
          try {
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, offset);
            offset = stats.size;
            const chunk = buffer.toString("utf-8");
            const lines = chunk.split("\n").map((line) => line.trim());
            for (const line of lines) {
              if (!line) {
                continue;
              }
              await onEvent(JSON.parse(line) as Event);
            }
          } finally {
            await handle.close();
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("[omnicore] event log tail error", error);
        }
      } finally {
        if (!stopped) {
          setTimeout(poll, pollMs);
        }
      }
    };

    setTimeout(poll, pollMs);

    return () => {
      stopped = true;
    };
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }
}
