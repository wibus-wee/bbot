import { promises as fs } from "fs";
import path from "path";

import type Database from "better-sqlite3";
import { compactMessages } from "@bbot/agent";
import type { AgentMessage } from "@bbot/agent";
import { getModel, type Model } from "@mariozechner/pi-ai";

import type { KernelConfig } from "./config";
import { ConfigStore, type KernelSettings } from "./config-store";
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
import { SessionStore } from "./session-store";
import {
  buildConversationContext,
  collectConversationEntries,
  type ConversationEntriesResult,
} from "./conversation-context";
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
  private sessionStore: SessionStore | null = null;
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
    this.sessionStore = new SessionStore(this.db);

    await this.syncContextView();
    await this.syncSessionProjection();

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
    const normalized = this.normalizeSessionRootEvent(event);
    if (!normalized) {
      return;
    }

    await this.recordEvent(normalized);

    if (normalized.type === "signal.inbound" || normalized.type === "signal.internal") {
      const settings = this.configStore?.getKernelSettings();
      if (!settings || !this.kvStore) {
        return;
      }

      const actorId = isInboundSignal(normalized) ? normalized.actorId : null;
      const sessionId = normalized.sessionId;
      const sessionRoot = this.resolveSessionRoot(sessionId);
      const instructions = await this.readAgentInstructions(sessionRoot);
      const apiKey = this.configStore?.getSecret("llm.apiKey") ?? undefined;
      const conversation =
        this.eventStore
          ? collectConversationEntries(this.eventStore, sessionId, { excludeEventId: normalized.id })
          : null;

      const compactionOutcome =
        actorId && this.eventStore
          ? await this.maybeAutoCompact({
            actorId,
            sessionId,
            triggerEvent: normalized,
            settings,
            apiKey,
            conversation,
          })
          : null;

      const finalEntries = compactionOutcome?.entries ?? conversation?.entries ?? [];
      const contextMessages = finalEntries.length > 0 ? buildConversationContext(finalEntries) : undefined;

      if (settings.modelProvider && settings.modelName) {
        await this.ensureSessionRunStarted(sessionId, normalized, settings.modelProvider, settings.modelName);
      }
      const output = await decideActions({
        event: normalized,
        instructions,
        workspaceRoot: sessionRoot,
        modelProvider: settings.modelProvider,
        modelName: settings.modelName,
        baseUrl: settings.modelBaseUrl,
        thinkingLevel: settings.thinkingLevel,
        apiKey,
        actorId,
        contextMessages,
        emitStatus: actorId
          ? async (status) => {
              await this.executeAction(
                { type: "send_status", actorId, status },
                sessionId,
                normalized.traceId,
                normalized.id
              );
            }
          : undefined,
        logEvent: (logged) => this.recordEvent(logged),
      });

      if (output.replyText && actorId) {
        await this.executeAction(
          { type: "send_message", actorId, text: output.replyText },
          sessionId,
          normalized.traceId,
          normalized.id
        );
      }

      if (output.requestRestart) {
        await this.executeAction(
          { type: "restart", reason: "agent requested restart" },
          sessionId,
          normalized.traceId,
          normalized.id
        );
      }
    }
  }

  private async executeAction(
    action: Action,
    sessionId: string,
    traceId: string,
    causationId?: string
  ): Promise<ActionResult> {
    const requested = createEvent({
      type: "action.requested",
      actorId: null,
      traceId,
      sessionId,
      causationId,
      payload: { action },
    });
    await this.recordEvent(requested);

    let result: ActionResult;

    try {
      switch (action.type) {
        case "send_message":
          this.adapterHub?.sendAction(action, traceId, sessionId, causationId);
          result = { ok: true };
          break;
        case "send_status":
          this.adapterHub?.sendAction(action, traceId, sessionId, causationId);
          result = { ok: true };
          break;
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
      sessionId,
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
    if (this.sessionStore) {
      this.sessionStore.applyEvent(event, seq);
      this.sessionStore.saveCursor(seq);
    }
  }

  private resolveCompactionModel(settings: KernelSettings): Model<any> | null {
    if (!settings.modelProvider || !settings.modelName) {
      return null;
    }
    // @ts-expect-error - provider might be custom
    const baseModel = getModel(settings.modelProvider, settings.modelName);
    if (!baseModel) {
      return null;
    }
    return {
      ...baseModel,
      baseUrl: settings.modelBaseUrl ?? baseModel.baseUrl,
      headers: baseModel.headers,
    };
  }

  private resolveCompactionSettings(settings: KernelSettings, model: Model<any> | null) {
    const autoLimit =
      settings.compactionAutoCompactTokenLimit ??
      (model?.contextWindow ? Math.floor(model.contextWindow * 0.9) : undefined);

    return {
      enabled: settings.compactionEnabled,
      reserveTokens: settings.compactionReserveTokens,
      keepRecentTokens: settings.compactionKeepRecentTokens,
      autoCompactTokenLimit: autoLimit,
    };
  }

  private async runManualCompaction(input: {
    messages: AgentMessage[];
    model: Model<any>;
    settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
    apiKey?: string;
  }): Promise<{ messages: AgentMessage[]; didCompact: boolean; summary?: string }> {
    const initial = await compactMessages({
      messages: input.messages,
      model: input.model,
      settings: input.settings,
      apiKey: input.apiKey,
      force: true,
    });

    if (initial.didCompact) {
      return initial;
    }

    return compactMessages({
      messages: input.messages,
      model: input.model,
      settings: { ...input.settings, keepRecentTokens: 0 },
      apiKey: input.apiKey,
      force: true,
    });
  }

  private async maybeAutoCompact(input: {
    actorId: string;
    sessionId: string;
    triggerEvent: Event;
    settings: KernelSettings;
    apiKey?: string;
    conversation: ConversationEntriesResult | null;
  }): Promise<{ entries: ConversationEntriesResult["entries"] } | null> {
    if (!this.eventStore || !input.conversation) {
      return null;
    }

    const model = this.resolveCompactionModel(input.settings);
    if (!model) {
      return null;
    }

    const compaction = this.resolveCompactionSettings(input.settings, model);
    if (!compaction.enabled || !compaction.autoCompactTokenLimit) {
      return null;
    }

    if (input.conversation.usageTokens < compaction.autoCompactTokenLimit) {
      return null;
    }

    const contextMessages = buildConversationContext(input.conversation.entries);
    if (contextMessages.length === 0) {
      return null;
    }

    const result = await this.runManualCompaction({
      messages: contextMessages,
      model,
      settings: {
        enabled: compaction.enabled,
        reserveTokens: compaction.reserveTokens,
        keepRecentTokens: compaction.keepRecentTokens,
      },
      apiKey: input.apiKey,
    });

    if (!result.didCompact || !result.summary) {
      return null;
    }

    const summaryEvent = createEvent({
      type: "agent.summary",
      actorId: input.actorId,
      traceId: input.triggerEvent.traceId,
      sessionId: input.sessionId,
      causationId: input.triggerEvent.id,
      payload: { summary: result.summary },
    });
    await this.recordEvent(summaryEvent);

    const keptMessages = result.messages.slice(1);
    if (keptMessages.length > 0) {
      for (const message of keptMessages) {
        const keptEvent = createEvent({
          type: "agent.message",
          actorId: input.actorId,
          traceId: input.triggerEvent.traceId,
          sessionId: input.sessionId,
          causationId: input.triggerEvent.id,
          payload: { message },
        });
        await this.recordEvent(keptEvent);
      }
    }

    const refreshed = collectConversationEntries(this.eventStore, input.sessionId, {
      excludeEventId: input.triggerEvent.id,
    });
    return { entries: refreshed.entries };
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

  private async syncSessionProjection(): Promise<void> {
    if (!this.eventStore || !this.sessionStore) {
      return;
    }

    let cursor = this.sessionStore.loadCursor();
    const latestSeq = this.eventStore.getLatestSeq();
    if (cursor >= latestSeq) {
      return;
    }

    const pending = this.eventStore.readSince(cursor);
    for (const row of pending) {
      this.sessionStore.applyEvent(row.event, row.seq);
      cursor = row.seq;
    }
    this.sessionStore.saveCursor(cursor);
  }

  private resolveSessionRoot(sessionId: string): string {
    const stored = this.sessionStore?.getSession(sessionId);
    return stored?.rootPath ?? this.config.root;
  }

  private async readAgentInstructions(rootPath: string): Promise<string> {
    const pathToAgents = path.join(rootPath, "AGENTS.md");
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

  private async ensureSessionRunStarted(
    sessionId: string,
    trigger: Event,
    modelProvider?: string,
    modelName?: string
  ): Promise<void> {
    if (!this.sessionStore) {
      return;
    }
    const session = this.sessionStore.getSession(sessionId);
    if (session?.firstLlmSeq) {
      return;
    }
    const event = createEvent({
      type: "agent.run.start",
      actorId: null,
      traceId: trigger.traceId,
      sessionId,
      causationId: trigger.id,
      payload: { modelProvider, modelName },
    });
    await this.recordEvent(event);
  }

  private normalizeSessionRootEvent(event: Event): Event | null {
    if (event.type !== "session.root.set" && event.type !== "session.created") {
      return event;
    }
    const payload = event.payload as { rootPath?: string } | null;
    const rootPath = payload?.rootPath?.trim();
    if (!rootPath) {
      if (event.type === "session.root.set") {
        console.warn("[omnicore] session.root.set missing rootPath");
        return null;
      }
      return event;
    }

    if (event.type === "session.root.set") {
      const session = this.sessionStore?.getSession(event.sessionId);
      if (session?.firstLlmSeq) {
        console.warn("[omnicore] session.root.set rejected, session locked", event.sessionId);
        return null;
      }
    }

    const absoluteRoot = path.isAbsolute(rootPath)
      ? rootPath
      : path.resolve(this.config.root, rootPath);

    return {
      ...event,
      payload: { rootPath: absoluteRoot },
    };
  }

}

export const startKernel = async (config: KernelConfig): Promise<void> => {
  const kernel = new OmniKernel(config);
  await kernel.start();
};
