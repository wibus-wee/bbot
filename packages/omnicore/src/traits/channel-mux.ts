import type { Event } from "../events";
import type { ChannelTrait } from "./types";

export const createChannelMux = (channels: ChannelTrait[]): ChannelTrait => {
  const actorToChannel = new Map<string, ChannelTrait>();

  return {
    kind: "channel",
    id: "mux",
    start: (emit: (event: Event) => Promise<void>) => {
      const stops = channels.map((channel) =>
        channel.start(async (event) => {
          if (event.actorId) {
            actorToChannel.set(event.actorId, channel);
          }
          await emit(event);
        })
      );

      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
    sendMessage: async (input) => {
      const channel = actorToChannel.get(input.actorId) ?? channels[0];
      if (!channel) {
        return;
      }
      await channel.sendMessage(input);
    },
  };
};
