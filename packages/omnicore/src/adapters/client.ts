import WebSocket, { type RawData } from "ws";

import type { Event } from "../events";
import type { AdapterHello, AdapterMessage, KernelAction, KernelAck, KernelMessage } from "./protocol";

export type AdapterClientOptions = {
  adapterId: string;
  url: string;
  capabilities?: string[];
  onAction?: (action: KernelAction) => void | Promise<void>;
  onAck?: (ack: KernelAck) => void | Promise<void>;
  onOpen?: () => void;
  onClose?: (code?: number, reason?: string) => void;
  onReconnect?: (delayMs: number, attempts: number) => void;
  onError?: (error: Error) => void;
};

export class AdapterClient {
  private readonly options: AdapterClientOptions;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private readonly pending: AdapterMessage[] = [];

  constructor(options: AdapterClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.connectSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(message: AdapterMessage): void {
    this.sendNow(message);
  }

  sendEvent(event: Event): void {
    this.send({ type: "event", event });
  }

  private connectSocket(): void {
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.socket = new WebSocket(this.options.url);

    this.socket.on("open", () => {
      this.reconnectAttempts = 0;
      this.sendHello();
      this.flushPending();
      this.options.onOpen?.();
    });

    this.socket.on("message", (raw: RawData) => {
      const data = this.safeParse(raw.toString());
      if (!data) {
        return;
      }
      if (data.type === "action") {
        this.emitAction(data);
      }
      if (data.type === "ack") {
        this.emitAck(data);
      }
    });

    this.socket.on("close", (code: number, reason: Buffer) => {
      this.socket = null;
      this.options.onClose?.(code, reason.toString());
      this.scheduleReconnect();
    });

    this.socket.on("error", (error: Error) => {
      this.options.onError?.(error);
    });
  }

  private sendHello(): void {
    const hello: AdapterHello = {
      type: "hello",
      adapterId: this.options.adapterId,
      capabilities: this.options.capabilities,
    };
    this.sendNow(hello);
  }

  private emitAction(action: KernelAction): void {
    if (!this.options.onAction) {
      return;
    }
    Promise.resolve(this.options.onAction(action)).catch((error: unknown) => {
      if (error instanceof Error) {
        this.options.onError?.(error);
        return;
      }
      this.options.onError?.(new Error("adapter action handler failed"));
    });
  }

  private emitAck(ack: KernelAck): void {
    if (!this.options.onAck) {
      return;
    }
    Promise.resolve(this.options.onAck(ack)).catch((error: unknown) => {
      if (error instanceof Error) {
        this.options.onError?.(error);
        return;
      }
      this.options.onError?.(new Error("adapter ack handler failed"));
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect) {
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    this.options.onReconnect?.(delay, this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, delay);
  }

  private sendNow(message: AdapterMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pending.push(message);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private flushPending(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (this.pending.length > 0) {
      const message = this.pending.shift();
      if (message) {
        this.socket.send(JSON.stringify(message));
      }
    }
  }

  private safeParse(raw: string): KernelMessage | null {
    try {
      return JSON.parse(raw) as KernelMessage;
    } catch (error) {
      if (error instanceof Error) {
        this.options.onError?.(error);
      } else {
        this.options.onError?.(new Error("adapter message parse error"));
      }
      return null;
    }
  }
}
