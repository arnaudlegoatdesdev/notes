import type { CloudConnection, CloudFile, CloudQuota } from './cloud';
import { importVault, inspectManifest, type VaultSession } from './core/vault';
import type { EncryptedBundle } from './core/types';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const pattern = new RegExp(`^s-(${uuid})--(${uuid}|root)\\.flion$`);
export interface SyncState { provider: string; head: string | null; dirty: boolean; }
const storageKey = 'flion.sync.v1';
export const readSyncState = (): SyncState | null => {
  try { const v = JSON.parse(localStorage.getItem(storageKey) || 'null'); return v && typeof v.provider === 'string' && typeof v.dirty === 'boolean' && (v.head === null || new RegExp(`^${uuid}$`).test(v.head)) ? v : null; } catch { return null; }
};
export function writeSyncState(state: SyncState | null) { if (state) localStorage.setItem(storageKey, JSON.stringify(state)); else localStorage.removeItem(storageKey); }
export function markDirty() { const s = readSyncState(); if (s) writeSyncState({ ...s, dirty: true }); }
export function findHead(files: CloudFile[]) {
  const versions = files.flatMap(file => { const m = file.name.match(pattern); return m ? [{ id: m[1], parent: m[2], file }] : []; });
  const parents = new Set(versions.map(v => v.parent));
  const heads = versions.filter(v => !parents.has(v.id));
  if (heads.length > 1) throw new Error('Deux appareils ont modifié le coffre. Exportez votre copie locale avant de résoudre le conflit.');
  if (versions.length && !heads.length) throw new Error('Historique cloud invalide. Votre copie locale est conservée.');
  return heads[0] || null;
}
export async function fetchCloudBundle(connection: CloudConnection, password: string): Promise<{ bundle: EncryptedBundle; head: string }> {
  const files = await connection.list(); const head = findHead(files);
  if (!head) throw new Error('Aucun coffre Flion sur ce compte.');
  const manifest = await connection.read(head.file.id);
  const data = await inspectManifest(password, manifest);
  const wanted = [...new Set(data.messages.flatMap(m => m.attachments.map(a => a.id)))];
  const blobs: Record<string, Uint8Array> = {};
  // Bounded sequential downloads avoid exhausting mobile memory/network.
  for (const id of wanted) {
    const matches = files.filter(f => f.name === `blob-${id}.flion`);
    if (matches.length !== 1) throw new Error('Une pièce jointe cloud manque ou existe en double. La copie locale est conservée.');
    blobs[id] = await connection.read(matches[0].id);
  }
  return { bundle: { manifest, files: blobs }, head: head.id };
}
export async function openCloudVault(connection: CloudConnection, password: string) {
  const { bundle, head } = await fetchCloudBundle(connection, password);
  const session = await importVault(password, bundle);
  writeSyncState({ provider: connection.provider, head, dirty: false });
  return session;
}
export async function syncVault(connection: CloudConnection, session: VaultSession, password: string): Promise<{ session: VaultSession; quota: CloudQuota | null; changed: boolean; cloudBytes: number }> {
  const files = await connection.list(); const head = findHead(files);
  const state = readSyncState();
  if (state && state.provider !== connection.provider) throw new Error('Ce coffre utilise un autre cloud. Exportez-le avant de changer de compte.');
  if (head && (!state || !state.head)) throw new Error('Ce compte contient déjà un coffre. Exportez votre copie locale puis ouvrez le coffre cloud depuis l’écran de connexion.');
  if (head?.id !== state?.head && head) {
    if (state?.dirty) throw new Error('Le coffre a changé sur un autre appareil. Vos modifications locales sont conservées. Exportez une sauvegarde avant d’ouvrir la version cloud.');
    const next = await openCloudVault(connection, password);
    session.lock();
    return { session: next, quota: await connection.quota(), changed: true, cloudBytes: files.reduce((n,f)=>n+f.size,0) };
  }
  if (!head && state?.head) throw new Error('Le coffre cloud a été supprimé. Votre copie locale est conservée.');
  if (head && !state?.dirty) return { session, quota: await connection.quota(), changed: false, cloudBytes: files.reduce((n,f)=>n+f.size,0) };
  const bundle = await session.exportBundle();
  const missing = Object.entries(bundle.files).filter(([id]) => !files.some(f => f.name === `blob-${id}.flion`));
  const required = missing.reduce((sum,[,bytes])=>sum+bytes.byteLength, bundle.manifest.byteLength);
  const cloudBytes = files.reduce((n,f)=>n+f.size,0);
  if (cloudBytes + required > session.data.preferences.limitBytes) throw new Error('La limite Flion serait dépassée. Augmentez-la ou nettoyez le cloud. Vos données restent sur cet appareil.');
  const quota = await connection.quota();
  if (quota?.total !== undefined && required > quota.total - quota.used) throw new Error('Le cloud est plein. Libérez de l’espace avant de réessayer. Vos données restent sur cet appareil.');
  // Do not overwrite manifests: concurrent uploads create distinct heads and are detected.
  for (const [id, bytes] of missing) await connection.create(`blob-${id}.flion`, bytes);
  const fresh = findHead(await connection.list());
  if (fresh?.id !== head?.id) throw new Error('Un autre appareil vient de synchroniser. Réessayez sans fermer cette page.');
  const nextId = crypto.randomUUID();
  await connection.create(`s-${nextId}--${head?.id ?? 'root'}.flion`, bundle.manifest);
  // Persist ancestry before post-write verification; never report a raced write as clean.
  writeSyncState({ provider: connection.provider, head: nextId, dirty: true });
  const verified = findHead(await connection.list());
  if (verified?.id !== nextId) throw new Error('La synchronisation a changé pendant l’envoi. Votre copie locale est conservée.');
  writeSyncState({ provider: connection.provider, head: nextId, dirty: false });
  return { session, quota: await connection.quota(), changed: false, cloudBytes: cloudBytes + required };
}
