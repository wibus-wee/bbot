import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { createLogger } from "@bbot/shared";

import { DEFAULT_SESSION_ID, type Action, type Event } from "../domain/events";
import type { AdapterMessage, KernelMessage } from "../domain/adapter-protocol";

const logger = createLogger({ name: "omnicore.adapter-hub" });

export interface AdapterHubOptions {
  port: number;
  onEvent: (event: Event) => Promise<void>;
}

type AdapterSession = {
  adapterId: string;
  socket: WebSocket;
};

export class AdapterHub {
  private readonly options: AdapterHubOptions;
  private server: WebSocketServer | null = null;
  private readonly adapters = new Map<string, AdapterSession>();

  constructor(options: AdapterHubOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({ port: this.options.port });
    this.server.on("connection", (socket: WebSocket) => this.handleConnection(socket));
    logger.info({ port: this.options.port }, "[omnicore] adapter hub listening");
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    for (const session of this.adapters.values()) {
      session.socket.close();
    }
    this.adapters.clear();
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }

  sendAction(action: Action, traceId: string, sessionId: string, causationId?: string): void {
    if (action.type !== "send_message" && action.type !== "send_status") {
      return;
    }
    const adapterId = this.getAdapterId(action.actorId);
    if (!adapterId) {
      logger.warn({ actorId: action.actorId }, "[omnicore] cannot route action, missing adapter id");
      return;
    }
    const session = this.adapters.get(adapterId);
    if (!session) {
      logger.warn({ adapterId }, "[omnicore] adapter not connected");
      return;
    }

    const message: KernelMessage = {
      type: "action",
      action,
      traceId,
      causationId,
      sessionId,
    };
    session.socket.send(JSON.stringify(message));
  }

  private handleConnection(socket: WebSocket): void {
    let adapterId: string | null = null;
    const helloTimeout = setTimeout(() => {
      if (!adapterId) {
        socket.close(1008, "hello required");
      }
    }, 5000);

    socket.on("message", async (raw: RawData) => {
      const data = this.safeParse(raw.toString());
      if (!data) {
        return;
      }
      if (data.type === "hello") {
        adapterId = data.adapterId.trim();
        if (!adapterId) {
          socket.close(1008, "invalid adapter id");
          return;
        }
        this.adapters.set(adapterId, { adapterId, socket });
        clearTimeout(helloTimeout);
        socket.send(JSON.stringify({ type: "ack" } satisfies KernelMessage));
        logger.info({ adapterId }, "[omnicore] adapter connected");
        return;
      }

      if (data.type === "event") {
        if (!adapterId) {
          socket.close(1008, "hello required");
          return;
        }
        const event = this.normalizeEvent(data.event, adapterId);
        await this.options.onEvent(event);
      }
    });

    socket.on("close", () => {
      if (adapterId) {
        this.adapters.delete(adapterId);
        logger.info({ adapterId }, "[omnicore] adapter disconnected");
      }
    });
  }

  private normalizeEvent(event: Event, adapterId: string): Event {
    const sessionId = event.sessionId ?? DEFAULT_SESSION_ID;
    if (!event.actorId) {
      return {
        ...event,
        sessionId,
      };
    }
    if (event.actorId.includes(":")) {
      return {
        ...event,
        sessionId,
      };
    }
    return {
      ...event,
      actorId: `${adapterId}:${event.actorId}`,
      sessionId,
    };
  }

  private getAdapterId(actorId: string): string | null {
    const [adapter] = actorId.split(":");
    return adapter || null;
  }

  private safeParse(raw: string): AdapterMessage | null {
    try {
      return JSON.parse(raw) as AdapterMessage;
    } catch (error) {
      logger.warn({ error }, "[omnicore] adapter message parse error");
      return null;
    }
  }
}
