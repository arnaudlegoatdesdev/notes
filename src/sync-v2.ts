import { assertVaultOwner } from "./auth";
import type { CloudConnection, CloudFile, CloudQuota } from "./cloud";
import type { Attachment, VaultData } from "./core/types";
import {
  hasVault,
  importVaultStream,
  inspectManifest,
  sealManifest,
  type VaultSecret,
  type VaultSession,
} from "./core/vault";
import { readSyncState, writeSyncState } from "./sync-state";
import { mergeVault } from "./merge";
export { markDirty, readSyncState, writeSyncState } from "./sync-state";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const pattern = new RegExp(
  `^n-(${uuid})--(root|${uuid}(?:--${uuid}){0,2})\\.notes$`,
);
export interface Version {
  id: string;
  parents: string[];
  file: CloudFile;
}
export function history(files: CloudFile[]): Map<string, Version> {
  const versions = files.flatMap((file) => {
    const m = file.name.match(pattern);
    return m
      ? [{ id: m[1], parents: m[2] === "root" ? [] : m[2].split("--"), file }]
      : [];
  });
  const graph = new Map(versions.map((v) => [v.id, v]));
  if (graph.size !== versions.length)
    throw new Error("Un instantané existe en double sur Drive.");
  const done = new Set<string>();
  for (const version of versions) {
    const stack: [string, boolean][] = [[version.id, false]],
      visiting = new Set<string>();
    while (stack.length) {
      const [id, exit] = stack.pop()!;
      if (exit) {
        visiting.delete(id);
        done.add(id);
        continue;
      }
      if (done.has(id)) continue;
      if (visiting.has(id)) throw new Error("Historique Notes invalide.");
      const node = graph.get(id);
      if (!node) throw new Error("Un instantané Notes manque sur Drive.");
      visiting.add(id);
      stack.push([id, true]);
      for (const parent of node.parents) stack.push([parent, false]);
    }
  }
  return graph;
}
export function findHeads(files: CloudFile[]): Version[] {
  const graph = history(files),
    parents = new Set([...graph.values()].flatMap((v) => v.parents));
  return [...graph.values()]
    .filter((v) => !parents.has(v.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function findHead(files: CloudFile[]): Version | null {
  return findHeads(files)[0] || null;
}
function ancestors(
  graph: Map<string, Version>,
  id: string,
): Map<string, number> {
  const result = new Map<string, number>(),
    queue: [string, number][] = [[id, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [node, depth] = queue[i];
    if (result.has(node)) continue;
    result.set(node, depth);
    for (const parent of graph.get(node)?.parents || [])
      queue.push([parent, depth + 1]);
  }
  return result;
}
export function commonAncestor(
  graph: Map<string, Version>,
  ids: string[],
): string {
  const distances = ids.map((id) => ancestors(graph, id));
  const common = [...distances[0]]
    .filter(([id]) => distances.every((d) => d.has(id)))
    .map(([id]) => ({
      id,
      distance: Math.max(...distances.map((d) => d.get(id)!)),
    }));
  common.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  if (!common[0])
    throw new Error(
      "Drive contient des historiques distincts. Votre copie locale est conservée.",
    );
  return common[0].id;
}
const refs = (data: VaultData) =>
  new Map(
    data.messages.flatMap((m) => m.attachments.map((a) => [a.id, a] as const)),
  );
async function hash(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function accountKey(conn: CloudConnection): Promise<string> {
  if (!conn.account.trim()) throw new Error("Compte Drive non identifié.");
  return hash(
    new TextEncoder().encode(
      `${conn.provider}\0${conn.account.trim().toLowerCase()}`,
    ),
  );
}
function totalBytes(files: CloudFile[]): number {
  let total = 0;
  for (const f of files) {
    if (
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      !Number.isSafeInteger(total + f.size)
    )
      throw new Error("Taille Drive invalide.");
    total += f.size;
  }
  return total;
}
function loader(
  conn: CloudConnection,
  files: CloudFile[],
  local?: VaultSession,
) {
  return async (item: Attachment): Promise<Uint8Array> => {
    if (local && refs(local.data).has(item.id))
      return local.readEncryptedFile(item.id);
    const found = files.filter((f) => f.name === `blob-${item.id}.flion`);
    if (found.length !== 1 || found[0].size !== item.storedSize)
      throw new Error("Une pièce jointe manque ou existe en double sur Drive.");
    const bytes = await conn.read(found[0].id);
    if (bytes.byteLength !== item.storedSize)
      throw new Error("Une pièce jointe Drive est incomplète.");
    return bytes;
  };
}
function reader(
  conn: CloudConnection,
  graph: Map<string, Version>,
  secret: VaultSecret,
  owner: string,
  vaultId?: string,
) {
  const cache = new Map<
    string,
    Promise<{ data: VaultData; manifest: Uint8Array }>
  >();
  return (id: string) => {
    if (!cache.has(id))
      cache.set(
        id,
        (async () => {
          const v = graph.get(id);
          if (!v || v.file.size < 52 || v.file.size > 16 * 1024 ** 2)
            throw new Error("Instantané Drive invalide.");
          const manifest = await conn.read(v.file.id);
          if (manifest.byteLength !== v.file.size)
            throw new Error("Instantané Drive incomplet.");
          const data = await inspectManifest(secret, manifest);
          assertVaultOwner(data, owner);
          if (vaultId && data.id !== vaultId)
            throw new Error("Drive contient un autre espace Notes.");
          return { data, manifest };
        })(),
      );
    return cache.get(id)!;
  };
}
export async function openCloudVault(
  conn: CloudConnection,
  secret: VaultSecret,
  owner: string,
): Promise<VaultSession> {
  if (await hasVault())
    throw new Error(
      "Une copie existe déjà. Synchronisez-la ou exportez-la avant de la remplacer.",
    );
  const files = await conn.list(),
    graph = history(files),
    head = findHead(files);
  if (!head)
    throw new Error(
      "La première synchronisation n’est pas encore terminée. Réessayez depuis votre ordinateur.",
    );
  const remote = await reader(conn, graph, secret, owner)(head.id);
  const next = await importVaultStream(
    secret,
    remote.manifest,
    loader(conn, files),
    null,
  );
  writeSyncState({
    provider: conn.provider,
    accountKey: await accountKey(conn),
    vaultId: next.data.id,
    head: head.id,
    manifestHash: await hash(remote.manifest),
    dirty: false,
  });
  return next;
}
/** Immutable snapshots with merge parents keep simultaneous commits recoverable. */
export class SyncFailure extends Error {
  constructor(
    error: unknown,
    readonly session: VaultSession,
  ) {
    super(
      error instanceof Error ? error.message : "Synchronisation indisponible.",
      { cause: error },
    );
  }
}
export async function syncVault(
  conn: CloudConnection,
  original: VaultSession,
  secret: VaultSecret,
  owner: string,
) {
  let live = original;
  try {
    return await performSync(conn, original, secret, owner, (value) => {
      live = value;
    });
  } catch (error) {
    if (live !== original) throw new SyncFailure(error, live);
    throw error;
  }
}
async function performSync(
  conn: CloudConnection,
  original: VaultSession,
  secret: VaultSecret,
  owner: string,
  onSession: (value: VaultSession) => void,
): Promise<{
  session: VaultSession;
  quota: CloudQuota | null;
  changed: boolean;
  cloudBytes: number;
  pending?: boolean;
}> {
  let session = original;
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await session.storageRevision(),
      localManifest = await session.exportManifest(),
      local = session.data;
    assertVaultOwner(local, owner);
    const localHash = await hash(localManifest),
      account = await accountKey(conn),
      state = readSyncState();
    if (state?.accountKey && state.accountKey !== account)
      throw new Error("Reconnectez le compte Drive d’origine.");
    if (state?.vaultId && state.vaultId !== local.id)
      throw new Error("La liaison Drive appartient à un autre espace.");
    const files = await conn.list(),
      graph = history(files),
      heads = findHeads(files).slice(0, 3),
      read = reader(conn, graph, secret, owner, local.id);
    const cloudBytes = totalBytes(files);
    if (!heads.length && state?.head)
      throw new Error(
        "Les notes ont été supprimées sur Drive. La copie locale est conservée.",
      );
    if (state?.head && !graph.has(state.head))
      throw new Error(
        "Un instantané manque sur Drive. La copie locale est conservée.",
      );
    const sameHead = heads.length === 1 && heads[0].id === state?.head;
    let merged = local;
    if (heads.length && !sameHead) {
      let remote = (await read(heads[0].id)).data;
      if (heads.length > 1) {
        const base = (
          await read(
            commonAncestor(
              graph,
              heads.map((h) => h.id),
            ),
          )
        ).data;
        for (const head of heads.slice(1))
          remote = mergeVault(base, remote, (await read(head.id)).data);
      }
      if (state?.head)
        merged = mergeVault((await read(state.head)).data, local, remote);
      else {
        // Recover a missing local binding from the root snapshot.
        const roots = [...graph.values()].filter((v) => !v.parents.length);
        if (roots.length !== 1)
          throw new Error("Impossible de retrouver l’origine de ces notes.");
        merged = mergeVault((await read(roots[0].id)).data, local, remote);
      }
    }
    const remoteSame = sameHead
      ? state?.manifestHash === localHash
      : heads.length === 1 &&
        JSON.stringify((await read(heads[0].id)).data) ===
          JSON.stringify(merged);
    const localSame = JSON.stringify(merged) === JSON.stringify(local);
    const manifest = localSame
      ? localManifest
      : await sealManifest(secret, merged, localManifest);
    const missing: Attachment[] = [];
    for (const item of refs(merged).values()) {
      const found = files.filter((f) => f.name === `blob-${item.id}.flion`);
      if (found.length > 1 || (found[0] && found[0].size !== item.storedSize))
        throw new Error(
          "Une pièce jointe Drive est endommagée ou existe en double.",
        );
      if (!found.length) missing.push(item);
    }
    if (remoteSame && localSame && !missing.length) {
      if ((await session.storageRevision()) !== revision)
        throw new Error("Un autre onglet a modifié les notes. Réessayez.");
      writeSyncState({
        provider: conn.provider,
        accountKey: account,
        vaultId: local.id,
        head: heads[0].id,
        manifestHash: localHash,
        dirty: false,
      });
      return {
        session,
        quota: await conn.quota().catch(() => null),
        changed: session !== original,
        cloudBytes,
      };
    }
    const required = missing.reduce(
      (sum, item) => sum + item.storedSize,
      remoteSame ? 0 : manifest.byteLength,
    );
    if (cloudBytes + required > merged.preferences.limitBytes)
      throw new Error(
        "La limite Notes est atteinte. Augmentez-la dans les paramètres.",
      );
    const quota = await conn.quota();
    if (quota?.total !== undefined && required > quota.total - quota.used)
      throw new Error(
        "Google Drive est plein. Vos modifications restent enregistrées en local.",
      );
    for (const item of missing)
      await conn.create(
        `blob-${item.id}.flion`,
        await loader(conn, files, session)(item),
      );
    // A new head during upload is merged on the next iteration, without discarding local edits.
    const fresh = findHeads(await conn.list())
      .map((h) => h.id)
      .join(",");
    if (
      fresh !==
      findHeads(files)
        .map((h) => h.id)
        .join(",")
    )
      continue;
    if ((await session.storageRevision()) !== revision)
      throw new Error("Un autre onglet a modifié les notes. Réessayez.");
    let head = heads[0]?.id;
    if (!remoteSame) {
      head = crypto.randomUUID();
      await conn.create(
        `n-${head}--${heads.length ? heads.map((h) => h.id).join("--") : "root"}.notes`,
        manifest,
      );
    }
    if (!localSame) {
      const previous = session;
      session = await importVaultStream(
        secret,
        manifest,
        loader(conn, files, previous),
        revision,
      );
      onSession(session);
      // The caller retains original until success; keep it valid if a later network request fails.
    }
    const committedHash = await hash(await session.exportManifest());
    writeSyncState({
      provider: conn.provider,
      accountKey: account,
      vaultId: local.id,
      head: head!,
      manifestHash: committedHash,
      dirty: false,
    });
    const verified = findHeads(await conn.list()).map((h) => h.id);
    if (verified.length === 1 && verified[0] === head) {
      if (session !== original) original.lock();
      return {
        session,
        quota: await conn.quota().catch(() => quota),
        changed: session !== original,
        cloudBytes: totalBytes(await conn.list()),
      };
    }
    // An actual simultaneous publish forms a fork; the next pass creates its merge commit.
  }
  // Always return the live imported session even while another device is busy publishing.
  return {
    session,
    quota: null,
    changed: session !== original,
    cloudBytes: totalBytes(await conn.list()),
    pending: true,
  };
}
