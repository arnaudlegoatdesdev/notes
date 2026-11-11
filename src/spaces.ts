import type { Channel, Space, VaultData } from "./core/types";

// The vault ID gives every device the same first space for older notes.
export const spacesOf = (data: VaultData): Space[] =>
  data.spaces ?? [{ id: data.id, name: "Mon espace" }];
export const spaceOfChannel = (data: VaultData, channel: Channel): string =>
  channel.spaceId ?? data.id;
export function withSpaces(data: VaultData): VaultData {
  return {
    ...data,
    version: 2,
    spaces: spacesOf(data),
    channels: data.channels.map((channel) => ({
      ...channel, spaceId: spaceOfChannel(data, channel),
    })),
  };
}

export function channelsInSpace(data: VaultData, spaceId: string): Channel[] {
  const channels = data.channels.filter((c) => spaceOfChannel(data, c) === spaceId);
  const order = spacesOf(data).find((s) => s.id === spaceId)?.channelOrder;
  if (!order) return channels;
  const ranks = new Map(order.map((id, index) => [id, index]));
  // Unordered new channels and channels moved here are appended in their existing order.
  return channels.sort((a, b) => (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length));
}
