import { promises as fs } from "fs";
import path from "path";

import type Database from "better-sqlite3";

import type { KernelConfig } from "./config";
import { ConfigStore } from "./config-store";
import { openDb } from "./db";
import { SqliteEventStore } from "./event-store";
import { createEvent, isInboundSignal, type Action, type ActionResult, type Event } from "./events";
import { runMigrations } from "./migrations";
import { decideActions } from "./reasoner";
import { AdapterHub } from "./adapters/hub";
import { createDefaultTraits } from "./traits";
import type { TraitRegistry } from "./traits/types";
import { KvStore } from "./kv-store";
import { ProjectionStore } from "./projection-store";
import {
  applyEventToContextView,
  createEmptyContextView,
  type ContextView,
} from "./views/context-view";

export class OmniKernel {
  private readonly config: KernelConfig;
  private db: Database.Database | null = null;
  private eventStore: SqliteEventStore | null = null;
  private configStore: ConfigStore | null = null;
  private kvStore: KvStore | null = null;
  private projectionStore: ProjectionStore | null = null;
  private traits: TraitRegistry | null = null;
  private adapterHub: AdapterHub | null = null;
  private contextView: ContextView = createEmptyContextView();
  private contextCursor = 0;
  private heartbeatStop: (() => void) | null = null;
  private processing: Promise<void> = Promise.resolve();
  private stopping = false;
  private exitAfterStop = false;

  constructor(config: KernelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.db = openDb({ path: this.config.dbPath });
    await runMigrations(this.db);

    this.eventStore = new SqliteEventStore(this.db);
    this.configStore = new ConfigStore(this.db);
    this.kvStore = new KvStore(this.db);
    this.projectionStore = new ProjectionStore(this.db);

    await this.syncContextView();

    const settings = this.configStore.getKernelSettings();
    this.traits = createDefaultTraits(this.config, {
      heartbeatMs: settings.heartbeatMs,
    });

    this.adapterHub = new AdapterHub({
      port: this.config.adapterPort,
      onEvent: (event) => this.enqueue(event),
    });
    await this.adapterHub.start();
    this.heartbeatStop = this.traits.heartbeat.start((event) => this.enqueue(event));

    process.on("SIGINT", () => {
      void this.stop();
    });

    process.on("SIGTERM", () => {
      void this.stop();
    });

    console.log("[omnicore] kernel started");
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    await this.adapterHub?.stop();
    this.heartbeatStop?.();
    this.adapterHub = null;
    this.heartbeatStop = null;
    await this.processing;
    console.log("[omnicore] kernel stopped");
    if (this.exitAfterStop) {
      process.exit(0);
    }
  }

  private enqueue(event: Event): Promise<void> {
    this.processing = this.processing
      .then(() => this.processEvent(event))
      .catch((error) => {
        console.error("[omnicore] kernel error", error);
      });
    return this.processing;
  }

  private async processEvent(event: Event): Promise<void> {
    await this.recordEvent(event);

    if (event.type === "signal.inbound" || event.type === "signal.internal") {
      const settings = this.configStore?.getKernelSettings();
      if (!settings || !this.kvStore) {
        return;
      }

      const actorId = isInboundSignal(event) ? event.actorId : null;
      const instructions = await this.readAgentInstructions();
      const apiKey = this.configStore?.getSecret("llm.apiKey") ?? undefined;
      const output = await decideActions({
        event,
        instructions,
        workspaceRoot: this.config.root,
        modelProvider: settings.modelProvider,
        modelName: settings.modelName,
        apiKey,
        actorId,
        executeAction: (action) => this.executeAction(action, event.traceId, event.id),
        logEvent: (logged) => this.recordEvent(logged),
      });

      if (output.replyText && actorId) {
        await this.executeAction(
          { type: "send_message", actorId, text: output.replyText },
          event.traceId,
          event.id
        );
      }

      if (output.requestRestart) {
        await this.executeAction(
          { type: "restart", reason: "agent requested restart" },
          event.traceId,
          event.id
        );
      }
    }
  }

  private async executeAction(
    action: Action,
    traceId: string,
    causationId?: string
  ): Promise<ActionResult> {
    const requested = createEvent({
      type: "action.requested",
      actorId: null,
      traceId,
      causationId,
      payload: { action },
    });
    await this.recordEvent(requested);

    let result: ActionResult;

    try {
      switch (action.type) {
        case "send_message":
          this.adapterHub?.sendAction(action, traceId, causationId);
          result = { ok: true };
          break;
        case "run_bash": {
          const output = await this.traits?.sandbox.run({ command: action.command });
          result = {
            ok: output?.exitCode === 0,
            data: {
              stdout: output?.stdout ?? "",
              stderr: output?.stderr ?? "",
              exitCode: output?.exitCode ?? 1,
            },
          };
          break;
        }
        case "write_file": {
          const filePath = this.resolveSandboxPath(action.path);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, action.content, "utf-8");
          result = { ok: true, data: { path: filePath } };
          break;
        }
        case "read_file": {
          const filePath = this.resolveSandboxPath(action.path);
          const contents = await fs.readFile(filePath, "utf-8");
          result = { ok: true, data: { path: filePath, contents } };
          break;
        }
        case "restart":
          this.exitAfterStop = true;
          result = { ok: true, data: { reason: action.reason ?? "" } };
          break;
        default:
          result = { ok: false, error: "unknown action" };
      }
    } catch (error) {
      result = { ok: false, error: (error as Error).message };
    }

    const executed = createEvent({
      type: "action.executed",
      actorId: null,
      traceId,
      causationId: requested.id,
      payload: { action, result },
    });
    await this.recordEvent(executed);

    if (action.type === "restart") {
      void this.stop();
    }

    return result;
  }

  private async recordEvent(event: Event): Promise<void> {
    if (!this.eventStore || !this.projectionStore) {
      return;
    }
    const seq = this.eventStore.append(event);
    this.contextView = applyEventToContextView(this.contextView, event);
    this.contextCursor = seq;
    this.projectionStore.saveContextView(this.contextView, this.contextCursor);
  }

  private async syncContextView(): Promise<void> {
    if (!this.eventStore || !this.projectionStore) {
      return;
    }
    const stored = this.projectionStore.loadContextView();
    this.contextView = stored.view;
    this.contextCursor = stored.cursor;

    const latestSeq = this.eventStore.getLatestSeq();
    if (this.contextCursor < latestSeq) {
      const pending = this.eventStore.readSince(this.contextCursor);
      for (const row of pending) {
        this.contextView = applyEventToContextView(this.contextView, row.event);
        this.contextCursor = row.seq;
      }
      this.projectionStore.saveContextView(this.contextView, this.contextCursor);
    }
  }

  private async readAgentInstructions(): Promise<string> {
    const pathToAgents = path.join(this.config.root, "AGENTS.md");
    try {
      const contents = await fs.readFile(pathToAgents, "utf-8");
      return contents.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  private resolveSandboxPath(inputPath: string): string {
    const resolved = path.resolve(this.config.sandboxRoot, inputPath);
    const root = path.resolve(this.config.sandboxRoot);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (!(resolved === root || resolved.startsWith(rootWithSep))) {
      throw new Error("path is outside sandbox root");
    }
    return resolved;
  }
}

export const startKernel = async (config: KernelConfig): Promise<void> => {
  const kernel = new OmniKernel(config);
  await kernel.start();
};
