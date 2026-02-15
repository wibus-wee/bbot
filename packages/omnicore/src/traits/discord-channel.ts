import { randomUUID } from "crypto";

import { Client, GatewayIntentBits, Partials } from "discord.js";

import type { ConfigStore } from "../config-store";
import type { KvStore } from "../kv-store";
import { createEvent, createTraceId, type Event } from "../events";
import type { ChannelTrait } from "./types";

type DiscordMapping = {
  actorByUserId: Record<string, string>;
  channelByActorId: Record<string, string>;
};

const MAPPING_KEY = "discord.mapping";

const createEmptyMapping = (): DiscordMapping => ({
  actorByUserId: {},
  channelByActorId: {},
});

const loadMapping = (store: KvStore): DiscordMapping => {
  const raw = store.get(MAPPING_KEY);
  if (!raw) {
    return createEmptyMapping();
  }
  try {
    const parsed = JSON.parse(raw) as DiscordMapping;
    return {
      actorByUserId: parsed.actorByUserId ?? {},
      channelByActorId: parsed.channelByActorId ?? {},
    };
  } catch {
    return createEmptyMapping();
  }
};

const saveMapping = (store: KvStore, mapping: DiscordMapping): void => {
  store.set(MAPPING_KEY, JSON.stringify(mapping));
};

export interface DiscordChannelConfig {
  configStore: ConfigStore;
  kvStore: KvStore;
}

export const createDiscordChannel = (config: DiscordChannelConfig): ChannelTrait => {
  let mapping = loadMapping(config.kvStore);
  let client: Client | null = null;
  let readyPromise: Promise<void> | null = null;

  const getActorId = (userId: string): string => {
    const existing = mapping.actorByUserId[userId];
    if (existing) {
      return existing;
    }
    const actorId = `actor:${randomUUID()}`;
    mapping.actorByUserId[userId] = actorId;
    saveMapping(config.kvStore, mapping);
    return actorId;
  };

  const rememberChannel = (actorId: string, channelId: string) => {
    mapping.channelByActorId[actorId] = channelId;
    saveMapping(config.kvStore, mapping);
  };

  return {
    kind: "channel",
    id: "discord",
    start: (emit: (event: Event) => Promise<void>) => {
      const connect = async () => {
        const token = config.configStore.getSecret("discord.token");
        if (!token) {
          console.log("[omnicore] discord token missing, channel disabled");
          return;
        }

        console.log("[omnicore] discord token loaded (length: %d)", token.length);

        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
          ],
          partials: [Partials.Channel],
        });

        client.once("ready", () => {
          console.log(`[omnicore] discord ready as ${client?.user?.tag ?? "unknown"}`);
        });

        client.on("error", (error) => {
          console.error("[omnicore] discord client error", error);
        });

        client.on("shardError", (error) => {
          console.error("[omnicore] discord shard error", error);
        });

        client.on("warn", (info) => {
          console.warn("[omnicore] discord warning", info);
        });

        client.on("messageCreate", async (message) => {
          if (message.author?.bot) {
            return;
          }
          const text = message.content?.trim();
          if (!text) {
            return;
          }
          try {
            const actorId = getActorId(message.author.id);
            rememberChannel(actorId, message.channelId);
            const event = createEvent({
              type: "signal.inbound",
              actorId,
              traceId: createTraceId(),
              payload: {
                kind: "message",
                text,
              },
            });
            await emit(event);
          } catch (error) {
            console.error("[omnicore] discord message error", error);
          }
        });

        console.log("[omnicore] connecting to discord...");

        readyPromise = client
          .login(token)
          .then(() => {
            console.log("[omnicore] discord channel connected");
          })
          .catch((error) => {
            console.error("[omnicore] discord login failed", error);
          });
      };

      void connect();

      return () => {
        if (client) {
          void client.destroy();
          client = null;
        }
      };
    },
    sendMessage: async ({ actorId, text }) => {
      if (!client) {
        return;
      }
      if (readyPromise) {
        await readyPromise;
      }
      const channelId = mapping.channelByActorId[actorId];
      if (!channelId) {
        console.warn("[omnicore] discord channel missing for actor", actorId);
        return;
      }
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        console.warn("[omnicore] discord channel not text-based", channelId);
        return;
      }
      if (!("send" in channel)) {
        console.warn("[omnicore] discord channel missing send", channelId);
        return;
      }
      const sendable = channel as { send: (options: { content: string }) => Promise<unknown> };
      await sendable.send({ content: text });
    },
  };
};
