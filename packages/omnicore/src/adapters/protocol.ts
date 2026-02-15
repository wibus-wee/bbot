import type { Action, Event } from "../events";

export type AdapterHello = {
  type: "hello";
  adapterId: string;
  capabilities?: string[];
};

export type AdapterEvent = {
  type: "event";
  event: Event;
};

export type AdapterMessage = AdapterHello | AdapterEvent;

export type KernelAction = {
  type: "action";
  action: Action;
  traceId: string;
  causationId?: string;
  sessionId: string;
};

export type KernelAck = {
  type: "ack";
  id?: string;
};

export type KernelMessage = KernelAction | KernelAck;
