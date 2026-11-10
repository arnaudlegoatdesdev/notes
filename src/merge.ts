import type { Channel, Message, VaultData } from "./core/types";
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
  const channels = collection<Channel>(
      base.channels,
      left.channels,
      right.channels,
    ),
    live = new Set(channels.map((x) => x.id));
  const mergedMessages = collection<Message>(
    base.messages,
    left.messages,
    right.messages,
  );
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
  const messages = mergedMessages
    .filter((m) => live.has(m.channelId))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  return structuredClone({
    ...left,
    owner: left.owner || right.owner || base.owner,
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
    channels: stamp(base.channels, next.channels),
    messages: stamp(base.messages, next.messages),
    preferences: equal(base.preferences, next.preferences)
      ? next.preferences
      : { ...next.preferences, changedAt: now },
  };
}
