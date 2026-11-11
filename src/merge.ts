import type { Channel, Message, Space, VaultData } from "./core/types";
import { withSpaces } from "./spaces";
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function later<T extends { changedAt?: string }>(a: T, b: T): T {
  const at =
    a.changedAt ||
    ("updatedAt" in a ? String(a.updatedAt || "") : "") ||
    ("createdAt" in a ? String(a.createdAt) : "");
  const bt =
    b.changedAt ||
    ("updatedAt" in b ? String(b.updatedAt || "") : "") ||
    ("createdAt" in b ? String(b.createdAt) : "");
  return at === bt
    ? JSON.stringify(a) > JSON.stringify(b)
      ? a
      : b
    : at > bt
      ? a
      : b;
}
function fields<T extends { changedAt?: string }>(
  base: T | undefined,
  left: T,
  right: T,
): T {
  const result = { ...left } as Record<string, unknown>,
    winner = later(left, right) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const b = (base as Record<string, unknown> | undefined)?.[key],
      l = (left as Record<string, unknown>)[key],
      r = (right as Record<string, unknown>)[key];
    result[key] = equal(l, r)
      ? l
      : equal(b, l)
        ? r
        : equal(b, r)
          ? l
          : winner[key];
    if (result[key] === undefined) delete result[key];
  }
  return result as T;
}
function collection<T extends { id: string; changedAt?: string }>(
  base: T[],
  left: T[],
  right: T[],
): T[] {
  const b = new Map(base.map((x) => [x.id, x])),
    l = new Map(left.map((x) => [x.id, x])),
    r = new Map(right.map((x) => [x.id, x]));
  const ids = [
    ...base.map((x) => x.id),
    ...[...new Set([...l.keys(), ...r.keys()])]
      .filter((id) => !b.has(id))
      .sort(),
  ];
  return ids.flatMap((id) => {
    const old = b.get(id),
      a = l.get(id),
      c = r.get(id);
    if (old && (!a || !c)) return []; // A deletion wins over an edit to the deleted item.
    return a && c ? [fields(old, a, c)] : a ? [a] : c ? [c] : [];
  });
}
/** Three-way merge: independent changes survive, equal-field edits use a stable winner. */
export function mergeVault(
  base: VaultData,
  left: VaultData,
  right: VaultData,
): VaultData {
  if (
    new Set([base.id, left.id, right.id]).size !== 1 ||
    new Set([base.createdAt, left.createdAt, right.createdAt]).size !== 1
  )
    throw new Error("Ces notes appartiennent à des espaces différents.");
  const owners = [
    base.owner?.subject,
    left.owner?.subject,
    right.owner?.subject,
  ].filter(Boolean);
  if (new Set(owners).size > 1)
    throw new Error("Ces notes appartiennent à des comptes différents.");
  base = withSpaces(base);
  left = withSpaces(left);
  right = withSpaces(right);
  const spaces = collection<Space>(base.spaces!, left.spaces!, right.spaces!);
  const channels = collection<Channel>(
      base.channels,
      left.channels,
      right.channels,
    ),
    live = new Set(channels.map((x) => x.id));
  const movedOut = new Map<string, VaultData>();
  for (const [survivor, deleted] of [[left, right], [right, left]]) {
    const deletedChannels = new Set(deleted.channels.map((c) => c.id));
    const deletedSpaces = new Set(deleted.spaces!.map((s) => s.id));
    const originalChannels = new Map(base.channels.map((c) => [c.id, c]));
    for (const c of survivor.channels) {
      const original = originalChannels.get(c.id);
      // Moving a channel out of a deleted space is independent of that deletion.
      if (!live.has(c.id) && original && c.spaceId !== original.spaceId &&
          !deletedChannels.has(c.id) && !deletedSpaces.has(original.spaceId!)) {
        channels.push(c);
        live.add(c.id);
        movedOut.set(c.id, survivor);
      }
    }
  }
  const mergedMessages = collection<Message>(
    base.messages,
    left.messages,
    right.messages,
  );
  const liveMessages = new Set(mergedMessages.map((m) => m.id));
  for (const survivor of [left, right]) {
    for (const message of survivor.messages) {
      if (movedOut.get(message.channelId) === survivor && !liveMessages.has(message.id)) {
        mergedMessages.push(message);
        liveMessages.add(message.id);
      }
    }
  }
  // Preserve notes sent offline while the other device was deleting their channel.
  const previousMessages = new Set(base.messages.map((m) => m.id));
  for (const message of mergedMessages) {
    if (live.has(message.channelId) || previousMessages.has(message.id))
      continue;
    const restored = [...left.channels, ...right.channels].find(
      (c) => c.id === message.channelId,
    );
    if (restored) {
      channels.push(restored);
      live.add(restored.id);
    }
  }
  // A channel created or moved offline must keep its destination space alive.
  const liveSpaces = new Set(spaces.map((s) => s.id));
  const originalChannels = new Map(base.channels.map((c) => [c.id, c]));
  const newNoteChannels = new Set(mergedMessages.filter((m) => !previousMessages.has(m.id)).map((m) => m.channelId));
  for (let i = channels.length - 1; i >= 0; i--) {
    const c = channels[i];
    if (liveSpaces.has(c.spaceId!)) continue;
    const previous = originalChannels.get(c.id);
    const newContent = newNoteChannels.has(c.id);
    if (!previous || previous.spaceId !== c.spaceId || newContent) {
      const restored = [...left.spaces!, ...right.spaces!, ...base.spaces!].find((s) => s.id === c.spaceId);
      if (restored) { spaces.push(restored); liveSpaces.add(restored.id); continue; }
    }
    channels.splice(i, 1);
    live.delete(c.id);
  }
  // Concurrent deletions of different spaces still leave a usable empty space.
  if (!spaces.length) spaces.push({ id: base.id, name: "Mon espace" });
  const messages = mergedMessages
    .filter((m) => live.has(m.channelId))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  return structuredClone({
    ...left,
    owner: left.owner || right.owner || base.owner,
    spaces,
    channels,
    messages,
    preferences: fields(base.preferences, left.preferences, right.preferences),
  });
}
export function stampChanges(
  base: VaultData,
  next: VaultData,
  now = new Date().toISOString(),
): VaultData {
  base = withSpaces(base);
  next = withSpaces(next);
  const stamp = <T extends { id: string; changedAt?: string }>(
    old: T[],
    values: T[],
  ): T[] =>
    values.map((value) => {
      const prior = old.find((x) => x.id === value.id);
      return equal(prior, value) ? value : { ...value, changedAt: now };
    });
  return {
    ...next,
    spaces: stamp(base.spaces!, next.spaces!),
    channels: stamp(base.channels, next.channels),
    messages: stamp(base.messages, next.messages),
    preferences: equal(base.preferences, next.preferences)
      ? next.preferences
      : { ...next.preferences, changedAt: now },
  };
}
