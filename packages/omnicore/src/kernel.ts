import { promises as fs } from "fs";
import path from "path";

import { JsonlEventLog } from "./event-log";
import { createEvent, isInboundSignal, type Action, type ActionResult, type Event } from "./events";
import type { KernelConfig } from "./config";
import { decideActions } from "./reasoner";
import { createDefaultTraits } from "./traits";
import type { TraitRegistry } from "./traits/types";
import { buildContextView, writeContextView } from "./views/context-view";

export class OmniKernel {
  private readonly config: KernelConfig;
  private readonly traits: TraitRegistry;
  private readonly eventLog: JsonlEventLog;
  private readonly contextViewPath: string;
  private readonly contextStorePath: string;
  private readonly recentEvents: Event[] = [];
  private heartbeatStop: (() => void) | null = null;
  private channelStop: (() => void) | null = null;
  private processing: Promise<void> = Promise.resolve();
  private stopping = false;
  private exitAfterStop = false;

  constructor(config: KernelConfig, traits?: TraitRegistry) {
    this.config = config;
    this.traits = traits ?? createDefaultTraits(config);
    this.eventLog = new JsonlEventLog(path.join(config.dataDir, "events.log"));
    this.contextViewPath = path.join(config.dataDir, "views", "context.json");
    this.contextStorePath = path.join(config.dataDir, "views", "llm-context.json");
  }

  async start(): Promise<void> {
    await this.rebuildView();

    this.channelStop = this.traits.channel.start((event) => this.enqueue(event));
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
    this.channelStop?.();
    this.heartbeatStop?.();
    this.channelStop = null;
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
      const mission = await this.readMission();
      const actorId = isInboundSignal(event) ? event.actorId : null;
      const output = await decideActions({
        event,
        mission,
        contextPath: this.contextStorePath,
        modelSpec: this.config.modelSpec,
        actorId,
        executeAction: (action) => this.executeAction(action, event.traceId, event.id),
      });

      if (output.replyText && actorId) {
        await this.executeAction(
          { type: "send_message", actorId, text: output.replyText },
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
          await this.traits.channel.sendMessage({
            actorId: action.actorId,
            text: action.text,
            traceId,
          });
          result = { ok: true };
          break;
        case "run_bash": {
          const output = await this.traits.sandbox.run({ command: action.command });
          result = {
            ok: output.exitCode === 0,
            data: {
              stdout: output.stdout,
              stderr: output.stderr,
              exitCode: output.exitCode,
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
    await this.eventLog.append(event);
    this.recentEvents.push(event);
    if (this.recentEvents.length > 200) {
      this.recentEvents.splice(0, this.recentEvents.length - 200);
    }
    const view = buildContextView(this.recentEvents);
    await writeContextView(this.contextViewPath, view);
  }

  private async rebuildView(): Promise<void> {
    const events = await this.eventLog.readAll();
    this.recentEvents.splice(0, this.recentEvents.length, ...events.slice(-200));
    const view = buildContextView(this.recentEvents);
    await writeContextView(this.contextViewPath, view);
  }

  private async readMission(): Promise<string> {
    try {
      const contents = await fs.readFile(this.config.missionPath, "utf-8");
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
