import type { Message } from "./core/types";

export function continuesMessageGroup(previous: Message | undefined, next: Message): boolean {
  if (!previous || previous.channelId !== next.channelId) return false;
  const first = new Date(previous.createdAt), second = new Date(next.createdAt);
  const interval = second.getTime() - first.getTime();
  return interval >= 0 && interval < 5 * 60_000 && first.toDateString() === second.toDateString();
}
