import type { CloudConnection, CloudFile, CloudQuota } from './cloud';
import { hasVault, importVaultStream, inspectManifest, unlockVault, type VaultSession } from './core/vault';
import type { Attachment, VaultData } from './core/types';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const uuidPattern = new RegExp(`^${uuid}$`);
const pattern = new RegExp(`^s-(${uuid})--(${uuid}|root)\\.flion$`);
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const storageKey = 'flion.sync.v1';
export interface SyncState {
  provider: string;
  head: string | null;
  dirty: boolean;
  accountKey?: string;
  vaultId?: string;
  manifestHash?: string;
}
export const readSyncState = (): SyncState | null => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!value || !['google', 'onedrive'].includes(value.provider) || typeof value.dirty !== 'boolean' || (value.head !== null && !uuidPattern.test(value.head))) return null;
    if (value.accountKey !== undefined && !/^[a-f0-9]{64}$/.test(value.accountKey)) return null;
    if (value.manifestHash !== undefined && !/^[a-f0-9]{64}$/.test(value.manifestHash)) return null;
    if (value.vaultId !== undefined && !uuidPattern.test(value.vaultId)) return null;
    return value;
  } catch { return null; }
};
export function writeSyncState(state: SyncState | null): void {
  if (state) localStorage.setItem(storageKey, JSON.stringify(state));
  else localStorage.removeItem(storageKey);
}
export function markDirty(): void { const state = readSyncState(); if (state) writeSyncState({ ...state, dirty: true }); }
function conflict(): never { throw new Error('Deux appareils ont modifié le coffre. Votre copie locale est conservée. Exportez une sauvegarde avant de résoudre le conflit.'); }

export function findHead(files: CloudFile[]) {
  const versions = files.flatMap(file => { const match = file.name.match(pattern); return match ? [{ id: match[1], parent: match[2], file }] : []; });
  const byId = new Map(versions.map(version => [version.id, version]));
  if (byId.size !== versions.length) throw new Error('Un instantané cloud existe en double. Votre copie locale est conservée.');
  const parents = new Set(versions.map(version => version.parent));
  const heads = versions.filter(version => !parents.has(version.id));
  if (heads.length > 1) conflict();
  if (versions.length && !heads.length) throw new Error('Historique cloud invalide. Votre copie locale est conservée.');
  // Reject missing ancestors and cycles even if another disconnected chain has a head.
  const visited = new Set<string>();
  for (const version of versions) {
    const chain = new Set<string>();
    let current: typeof version | undefined = version;
    while (current && !visited.has(current.id)) {
      if (chain.has(current.id)) throw new Error('Historique cloud invalide. Votre copie locale est conservée.');
      chain.add(current.id);
      if (current.parent === 'root') break;
      current = byId.get(current.parent);
      if (!current) throw new Error('Un ancêtre du coffre cloud est manquant. Votre copie locale est conservée.');
    }
    for (const id of chain) visited.add(id);
  }
  return heads[0] || null;
}
function references(data: VaultData): Map<string, Attachment> {
  return new Map(data.messages.flatMap(message => message.attachments.map(item => [item.id, item] as const)));
}
function cloudSize(files: CloudFile[]): number {
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !Number.isSafeInteger(total + file.size)) throw new Error('Le cloud a renvoyé une taille de fichier invalide.');
    total += file.size;
  }
  return total;
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function accountKey(connection: CloudConnection): Promise<string> {
  if (!connection.account.trim()) throw new Error('Le cloud n’a pas identifié le compte connecté.');
  return hash(new TextEncoder().encode(`${connection.provider}\0${connection.account.trim().toLowerCase()}`));
}
function checkBinding(state: SyncState | null, connection: CloudConnection, account: string, vaultId?: string): void {
  if (state && state.provider !== connection.provider) throw new Error('Ce coffre utilise un autre cloud. Exportez-le avant de changer de cloud.');
  if (state?.accountKey && state.accountKey !== account) throw new Error('Ce coffre est lié à un autre compte. Reconnectez le compte d’origine.');
  if (state?.vaultId && vaultId && state.vaultId !== vaultId) throw new Error('La liaison cloud appartient à un autre coffre. Votre copie locale est conservée.');
  if (state?.head && (!state.accountKey || !state.vaultId || !state.manifestHash)) throw new Error('La liaison de ce coffre est incomplète. Exportez votre copie locale avant de rouvrir le cloud.');
}
function isAncestor(files: CloudFile[], ancestor: string, headId: string): boolean {
  const versions = new Map(files.flatMap(file => { const match = file.name.match(pattern); return match ? [[match[1], match[2]] as const] : []; }));
  let current: string | undefined = headId;
  while (current && current !== 'root') { if (current === ancestor) return true; current = versions.get(current); }
  return false;
}
async function snapshot(session: VaultSession): Promise<{ manifest: Uint8Array; data: VaultData; manifestHash: string; revision: string }> {
  const revision = await session.storageRevision();
  const manifest = await session.exportManifest();
  const data = session.data;
  const manifestHash = await hash(manifest);
  if (await hash(await session.exportManifest()) !== manifestHash || await session.storageRevision() !== revision) throw new Error('Le coffre a changé pendant la synchronisation. Réessayez.');
  return { manifest, data, manifestHash, revision };
}

export async function fetchCloudSnapshot(connection: CloudConnection, password: string, expectedVaultId?: string, expectedHead?: string): Promise<{ manifest: Uint8Array; head: string; load: (attachment: Attachment) => Promise<Uint8Array> }> {
  const files = await connection.list();
  cloudSize(files);
  const head = findHead(files);
  if (!head) throw new Error('Aucun coffre Notes sur ce compte.');
  if (expectedHead && !isAncestor(files, expectedHead, head.id)) conflict();
  if (head.file.size < 52 || head.file.size > MAX_MANIFEST_BYTES) throw new Error('Le manifeste cloud est trop volumineux ou invalide.');
  const manifest = await connection.read(head.file.id);
  if (manifest.byteLength !== head.file.size) throw new Error('Le manifeste cloud est incomplet. Votre copie locale est conservée.');
  const data = await inspectManifest(password, manifest);
  if (expectedVaultId && data.id !== expectedVaultId) throw new Error('Le compte contient un autre coffre. Votre copie locale est conservée.');
  const wanted = references(data);
  const byName = new Map<string, CloudFile[]>();
  for (const file of files) byName.set(file.name, [...(byName.get(file.name) ?? []), file]);
  const downloads = new Map<string, { file: CloudFile; storedSize: number }>();
  for (const [id, item] of wanted) {
    const matches = byName.get(`blob-${id}.flion`) ?? [];
    if (matches.length !== 1 || matches[0].size !== item.storedSize) throw new Error('Une pièce jointe cloud manque ou existe en double. La copie locale est conservée.');
    downloads.set(id, { file: matches[0], storedSize: item.storedSize });
  }
  return {
    manifest, head: head.id,
    load: async attachment => {
      const download = downloads.get(attachment.id);
      if (!download || download.storedSize !== attachment.storedSize) throw new Error('Une pièce jointe ne correspond pas au manifeste cloud.');
      const bytes = await connection.read(download.file.id);
      if (bytes.byteLength !== download.storedSize) throw new Error('Une pièce jointe cloud est incomplète. Votre copie locale est conservée.');
      return bytes;
    },
  };
}

export async function openCloudVault(connection: CloudConnection, password: string) {
  const account = await accountKey(connection);
  const state = readSyncState();
  const localExists = await hasVault();
  let expectedManifest: Uint8Array | undefined;
  let expectedRevision: string | null = null;
  let expectedVaultId: string | undefined;
  if (localExists) {
    checkBinding(state, connection, account);
    if (!state?.head || state.dirty) throw new Error('Votre copie locale contient des modifications. Exportez-la puis supprimez uniquement la copie de cet appareil avant d’ouvrir le cloud.');
    const local = await unlockVault(password);
    try {
      expectedManifest = await local.exportManifest();
      expectedRevision = await local.storageRevision();
      expectedVaultId = local.data.id;
      if (await hash(expectedManifest) !== state.manifestHash) throw new Error('Votre copie locale a changé. Exportez une sauvegarde avant d’ouvrir le cloud.');
    } finally { local.lock(); }
  }
  const { manifest, head, load } = await fetchCloudSnapshot(connection, password, expectedVaultId, localExists ? state?.head ?? undefined : undefined);
  const session = await importVaultStream(password, manifest, load, expectedRevision);
  writeSyncState({ provider: connection.provider, accountKey: account, vaultId: session.data.id, manifestHash: await hash(manifest), head, dirty: false });
  return session;
}

let synchronizing = false;
export async function syncVault(connection: CloudConnection, session: VaultSession, password: string): Promise<{ session: VaultSession; quota: CloudQuota | null; changed: boolean; cloudBytes: number }> {
  if (synchronizing) throw new Error('Une synchronisation est déjà en cours.');
  synchronizing = true;
  try { return await performSync(connection, session, password); }
  finally { synchronizing = false; }
}
async function performSync(connection: CloudConnection, session: VaultSession, password: string): Promise<{ session: VaultSession; quota: CloudQuota | null; changed: boolean; cloudBytes: number }> {
  const local = await snapshot(session);
  const account = await accountKey(connection);
  const state = readSyncState();
  checkBinding(state, connection, account, local.data.id);
  const dirty = !state?.head || state.dirty || state.manifestHash !== local.manifestHash;
  const files = await connection.list();
  const cloudBytes = cloudSize(files);
  const head = findHead(files);
  if (head && (!state || !state.head)) throw new Error('Ce compte contient déjà un coffre. Exportez votre copie locale puis ouvrez le coffre cloud depuis l’écran de connexion.');
  if (!head && state?.head) throw new Error('Le coffre cloud a été supprimé. Votre copie locale est conservée.');
  if (head && state?.head !== head.id) {
    if (dirty || !isAncestor(files, state!.head!, head.id)) conflict();
    const { manifest, head: importedHead, load } = await fetchCloudSnapshot(connection, password, local.data.id, state!.head!);
    const latest = readSyncState();
    checkBinding(latest, connection, account, local.data.id);
    if (latest?.head !== state!.head || latest?.dirty || await hash(await session.exportManifest()) !== local.manifestHash) conflict();
    const next = await importVaultStream(password, manifest, load, local.revision);
    const importedHash = await hash(manifest);
    writeSyncState({ provider: connection.provider, accountKey: account, vaultId: next.data.id, head: importedHead, manifestHash: importedHash, dirty: false });
    session.lock();
    // A quota lookup failure must never discard the newly imported session reference.
    let quota: CloudQuota | null = null;
    try { quota = await connection.quota(); } catch { /* Data has already been safely imported. */ }
    return { session: next, quota, changed: true, cloudBytes };
  }
  const refs = references(local.data);
  const missing: Attachment[] = [];
  const byName = new Map<string, CloudFile[]>();
  for (const file of files) byName.set(file.name, [...(byName.get(file.name) ?? []), file]);
  for (const [id, item] of refs) {
    const existing = byName.get(`blob-${id}.flion`) ?? [];
    if (existing.length > 1 || (existing[0] && existing[0].size !== item.storedSize)) throw new Error('Une pièce jointe cloud est endommagée ou existe en double. Votre copie locale est conservée.');
    if (!existing.length) missing.push(item);
  }
  if (head && !dirty && !missing.length) return { session, quota: await connection.quota(), changed: false, cloudBytes };
  const required = missing.reduce((sum, item) => sum + item.storedSize, local.manifest.byteLength);
  if (cloudBytes + required > local.data.preferences.limitBytes) throw new Error('La limite Notes serait dépassée. Augmentez-la dans les paramètres. Vos données restent sur cet appareil.');
  const quota = await connection.quota();
  if (quota?.total !== undefined && required > quota.total - quota.used) throw new Error('Le cloud est plein. Libérez de l’espace avant de réessayer. Vos données restent sur cet appareil.');
  // Read only missing encrypted attachments, one at a time, after quota checks.
  for (const item of missing) {
    const bytes = await session.readEncryptedFile(item.id);
    if (bytes.byteLength !== item.storedSize) throw new Error('Une pièce jointe locale est incomplète.');
    await connection.create(`blob-${item.id}.flion`, bytes);
  }
  const fresh = findHead(await connection.list());
  if ((fresh?.id ?? null) !== (head?.id ?? null)) throw new Error('Un autre appareil vient de synchroniser. Réessayez sans fermer cette page.');
  const latest = readSyncState();
  checkBinding(latest, connection, account, local.data.id);
  if ((latest?.head ?? null) !== (state?.head ?? null)) conflict();
  const nextId = crypto.randomUUID();
  await connection.create(`s-${nextId}--${head?.id ?? 'root'}.flion`, local.manifest);
  // Save ancestry as dirty first: any failed post-write check remains recoverable.
  const sent: SyncState = { provider: connection.provider, accountKey: account, vaultId: local.data.id, head: nextId, manifestHash: local.manifestHash, dirty: true };
  writeSyncState(sent);
  const verified = findHead(await connection.list());
  if (verified?.id !== nextId) throw new Error('La synchronisation a changé pendant l’envoi. Votre copie locale est conservée.');
  const currentHash = await hash(await session.exportManifest());
  const changedDuringUpload = currentHash !== local.manifestHash;
  writeSyncState({ ...sent, dirty: changedDuringUpload });
  if (changedDuringUpload) throw new Error('Une modification locale attend encore son envoi. Relancez la synchronisation.');
  let updatedQuota: CloudQuota | null = quota;
  try { updatedQuota = await connection.quota(); } catch { /* The committed snapshot is already confirmed. */ }
  return { session, quota: updatedQuota, changed: false, cloudBytes: cloudBytes + required };
}
