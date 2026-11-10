import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudConnection, CloudFile, CloudQuota } from '../src/cloud/types';
import { clearLocalVault, createVault, importVault, unlockVault, type VaultSession } from '../src/core/vault';
import type { VaultData } from '../src/core/types';
import { fetchCloudSnapshot, findHead, markDirty, openCloudVault, readSyncState, syncVault, writeSyncState } from '../src/sync';

const password = 'un coffre vraiment secret';
function seed(limitBytes = 10 * 1024 * 1024): VaultData {
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), channels: [{ id: crypto.randomUUID(), name: 'Notes', description: '', icon: 'hash' }], messages: [], preferences: { theme: 'slate', font: 'system', fontSize: 15, limitBytes } };
}
class MemoryCloud implements CloudConnection {
  provider = 'google' as const;
  account = 'person@example.com';
  objects = new Map<string, { name: string; bytes: Uint8Array; size: number }>();
  created: string[] = [];
  reads: string[] = [];
  beforeSnapshot?: () => Promise<void>;
  beforeRead?: () => Promise<void>;
  quotaValue: CloudQuota | null = { used: 0, total: 100 * 1024 * 1024 };
  quotaFails = false;
  add(name: string, bytes: Uint8Array, size = bytes.byteLength): string {
    const id = crypto.randomUUID(); this.objects.set(id, { name, bytes: bytes.slice(), size }); return id;
  }
  async list(): Promise<CloudFile[]> { return [...this.objects].map(([id, item]) => ({ id, name: item.name, size: item.size })); }
  async read(id: string): Promise<Uint8Array> { this.reads.push(id); await this.beforeRead?.(); return this.objects.get(id)!.bytes.slice(); }
  async create(name: string, bytes: Uint8Array): Promise<CloudFile> {
    if (name.startsWith('s-')) await this.beforeSnapshot?.();
    if ([...this.objects.values()].some(item => item.name === name)) throw new Error('collision');
    const id = this.add(name, bytes); this.created.push(name); return { id, name, size: bytes.byteLength };
  }
  async quota(): Promise<CloudQuota | null> { if (this.quotaFails) throw new Error('network'); return this.quotaValue; }
  async disconnect(): Promise<void> {}
}
async function edit(session: VaultSession, text: string): Promise<void> {
  const data = session.data;
  data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text, createdAt: new Date().toISOString(), attachments: [], pinned: false });
  await session.save(data);
}
function version(id: string, parent = 'root'): CloudFile { return { id: crypto.randomUUID(), name: `s-${id}--${parent}.flion`, size: 100 }; }

beforeEach(async () => {
  await clearLocalVault();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
});

describe('cloud ancestry', () => {
  it('finds an empty or linear head and rejects forks, missing parents and hidden cycles', () => {
    const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID();
    expect(findHead([])).toBeNull();
    expect(findHead([version(a), version(b, a)])?.id).toBe(b);
    expect(() => findHead([version(a), version(b, a), version(c, a)])).toThrow('Deux appareils');
    expect(() => findHead([version(b, a)])).toThrow('ancêtre');
    expect(() => findHead([version(a), version(b, c), version(c, b)])).toThrow('invalide');
    expect(() => findHead([version(a), version(a)])).toThrow('double');
  });
});

describe('immutable synchronization', () => {
  it('uploads the initial root, persists exact binding and treats an unchanged vault as clean', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud();
    const bundleSpy = vi.spyOn(session, 'exportBundle');
    await syncVault(cloud, session, password);
    expect(cloud.created).toHaveLength(1);
    expect(cloud.created[0]).toMatch(/--root\.flion$/);
    expect(readSyncState()).toMatchObject({ provider: 'google', vaultId: session.data.id, dirty: false });
    expect(readSyncState()?.accountKey).toMatch(/^[a-f0-9]{64}$/);
    expect(readSyncState()?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    await syncVault(cloud, session, password);
    expect(cloud.created).toHaveLength(1);
    expect(bundleSpy).not.toHaveBeenCalled();
  });

  it('reads only missing encrypted attachments and never copies the whole bundle', async () => {
    const session = await createVault(password, seed());
    const attachment = await session.addFile(new File(['important'], 'document.txt'));
    const data = session.data;
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: 'Note', createdAt: new Date().toISOString(), attachments: [attachment], pinned: false });
    await session.save(data);
    const cloud = new MemoryCloud();
    const fileSpy = vi.spyOn(session, 'readEncryptedFile');
    const bundleSpy = vi.spyOn(session, 'exportBundle');
    await syncVault(cloud, session, password);
    expect(fileSpy).toHaveBeenCalledTimes(1);
    fileSpy.mockClear();
    await edit(session, 'Nouvelle note'); markDirty();
    await syncVault(cloud, session, password);
    expect(fileSpy).not.toHaveBeenCalled();
    expect(bundleSpy).not.toHaveBeenCalled();
    expect(cloud.created.filter(name => name.startsWith('blob-'))).toHaveLength(1);
    expect(cloud.created.filter(name => name.startsWith('s-'))).toHaveLength(2);
  });

  it('checks provider quota before reading attachments or creating cloud objects', async () => {
    const session = await createVault(password, seed());
    const file = await session.addFile(new File(['data'], 'file.txt'));
    const data = session.data;
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: '', createdAt: new Date().toISOString(), attachments: [file], pinned: false });
    await session.save(data);
    const cloud = new MemoryCloud(); cloud.quotaValue = { total: 100, used: 100 };
    const fileSpy = vi.spyOn(session, 'readEncryptedFile');
    await expect(syncVault(cloud, session, password)).rejects.toThrow('plein');
    expect(fileSpy).not.toHaveBeenCalled(); expect(cloud.created).toEqual([]);
    expect((await unlockVault(password)).data.messages[0].attachments).toHaveLength(1);
  });

  it('checks the Notes cloud budget including immutable history before any upload', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud(); cloud.add('orphan.flion', new Uint8Array(1), session.data.preferences.limitBytes);
    await expect(syncVault(cloud, session, password)).rejects.toThrow('limite Notes');
    expect(cloud.created).toEqual([]);
  });

  it('refuses another account of the same provider before touching that account', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud(); await syncVault(cloud, session, password);
    const other = new MemoryCloud(); other.account = 'other@example.com';
    const listSpy = vi.spyOn(other, 'list');
    await expect(syncVault(other, session, password)).rejects.toThrow('autre compte');
    expect(listSpy).not.toHaveBeenCalled(); expect(other.created).toEqual([]);
  });

  it('infers unsent edits from the manifest even when markDirty was missed', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud(); await syncVault(cloud, session, password);
    const baseline = readSyncState()!;
    const oldManifest = await session.exportManifest();
    await edit(session, 'À garder malgré le conflit');
    expect(readSyncState()?.dirty).toBe(false);
    cloud.add(`s-${crypto.randomUUID()}--${baseline.head}.flion`, oldManifest);
    await expect(syncVault(cloud, session, password)).rejects.toThrow('Deux appareils');
    expect(session.data.messages[0].text).toBe('À garder malgré le conflit');
    expect((await unlockVault(password)).data.messages[0].text).toBe('À garder malgré le conflit');
  });

  it('keeps edits made during upload dirty and sends them on the next attempt', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud();
    cloud.beforeSnapshot = async () => { cloud.beforeSnapshot = undefined; await edit(session, 'Modifié pendant l’envoi'); markDirty(); };
    await expect(syncVault(cloud, session, password)).rejects.toThrow('modification locale');
    expect(readSyncState()?.dirty).toBe(true);
    expect(session.data.messages[0].text).toBe('Modifié pendant l’envoi');
    await syncVault(cloud, session, password);
    expect(readSyncState()?.dirty).toBe(false);
    expect(cloud.created.filter(name => name.startsWith('s-'))).toHaveLength(2);
  });

  it('imports a clean descendant and returns its session even when the later quota check fails', async () => {
    const original = await createVault(password, seed());
    const cloud = new MemoryCloud(); await syncVault(cloud, original, password);
    const baseline = readSyncState()!;
    const bundle = await original.exportBundle();
    await edit(original, 'Note du téléphone');
    const remote = await original.exportManifest();
    cloud.add(`s-${crypto.randomUUID()}--${baseline.head}.flion`, remote);
    const restored = await importVault(password, bundle);
    writeSyncState(baseline);
    cloud.quotaFails = true;
    const result = await syncVault(cloud, restored, password);
    expect(result.changed).toBe(true); expect(result.quota).toBeNull();
    expect(result.session.data.messages[0].text).toBe('Note du téléphone');
    expect(() => restored.data).toThrow('verrouillé');
    expect(readSyncState()?.dirty).toBe(false);
  });

  it('preserves a local edit made while a remote descendant is downloading', async () => {
    const original = await createVault(password, seed());
    const cloud = new MemoryCloud(); await syncVault(cloud, original, password);
    const baseline = readSyncState()!;
    const bundle = await original.exportBundle();
    await edit(original, 'Note distante');
    cloud.add(`s-${crypto.randomUUID()}--${baseline.head}.flion`, await original.exportManifest());
    const restored = await importVault(password, bundle); writeSyncState(baseline);
    cloud.beforeRead = async () => { cloud.beforeRead = undefined; await edit(restored, 'Nouvelle note locale'); markDirty(); };
    await expect(syncVault(cloud, restored, password)).rejects.toThrow('Deux appareils');
    expect((await unlockVault(password)).data.messages[0].text).toBe('Nouvelle note locale');
  });
});

describe('opening cloud vaults', () => {
  it('rejects an unsent local copy before downloading another vault', async () => {
    const session = await createVault(password, seed());
    const cloud = new MemoryCloud(); await syncVault(cloud, session, password);
    await edit(session, 'Non envoyé'); markDirty();
    await expect(openCloudVault(cloud, password)).rejects.toThrow('modifications');
    expect(cloud.reads).toEqual([]);
    expect((await unlockVault(password)).data.messages[0].text).toBe('Non envoyé');
  });

  it('preserves a vault created in another tab during an initial cloud download', async () => {
    const old = await createVault(password, seed());
    const cloud = new MemoryCloud(); cloud.add(`s-${crypto.randomUUID()}--root.flion`, await old.exportManifest());
    await clearLocalVault(); writeSyncState(null);
    let localId = '';
    cloud.beforeRead = async () => { cloud.beforeRead = undefined; const local = await createVault(password, seed()); localId = local.data.id; };
    await expect(openCloudVault(cloud, password)).rejects.toThrow('autre onglet');
    expect((await unlockVault(password)).data.id).toBe(localId);
  });

  it('rejects oversized metadata before downloading the manifest', async () => {
    const cloud = new MemoryCloud(); cloud.add(`s-${crypto.randomUUID()}--root.flion`, new Uint8Array(52), 16 * 1024 * 1024 + 1);
    await expect(fetchCloudSnapshot(cloud, password)).rejects.toThrow('volumineux');
    expect(cloud.reads).toEqual([]);
  });

  it('accepts cloud metadata above 512 MiB without downloading attachment payloads eagerly', async () => {
    const session = await createVault(password, seed(1024 * 1024 * 1024));
    const initial = await session.exportManifest();
    const data = session.data;
    const attachments = Array.from({ length: 24 }, () => ({ id: crypto.randomUUID(), name: 'photo.bin', mime: 'application/octet-stream', size: 25 * 1024 * 1024, storedSize: 25 * 1024 * 1024 + 36 }));
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: '', createdAt: new Date().toISOString(), attachments, pinned: false });
    // Construct a valid manifest fixture without allocating 600 MiB of attachment data.
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: initial.slice(8, 24), iterations: 600_000 }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: initial.slice(0, 24) }, key, new TextEncoder().encode(JSON.stringify(data))));
    const manifest = new Uint8Array(36 + encrypted.byteLength); manifest.set(initial.subarray(0, 24)); manifest.set(iv, 24); manifest.set(encrypted, 36);
    const cloud = new MemoryCloud(); const manifestId = cloud.add(`s-${crypto.randomUUID()}--root.flion`, manifest);
    for (const item of attachments) cloud.add(`blob-${item.id}.flion`, new Uint8Array(36), item.storedSize);
    const remote = await fetchCloudSnapshot(cloud, password);
    expect(cloud.reads).toEqual([manifestId]);
    await expect(remote.load(attachments[0])).rejects.toThrow('incomplète');
    expect(cloud.reads).toHaveLength(2);
  });
});

describe('Google vault owner protection',()=>{
  it('rejects another Google subject before any cloud write',async()=>{
    const data=seed();data.owner={provider:'google',subject:'person-a'};
    const session=await createVault(password,data);const cloud=new MemoryCloud();
    await expect(syncVault(cloud,session,password,'person-b')).rejects.toThrow('autre compte Google');
    expect(cloud.created).toEqual([]);expect(session.data.owner?.subject).toBe('person-a');
  });
  it('rejects a foreign cloud owner before replacing local storage',async()=>{
    const data=seed();data.owner={provider:'google',subject:'person-a'};
    const original=await createVault(password,data);const cloud=new MemoryCloud();
    await syncVault(cloud,original,password,'person-a');
    await clearLocalVault();writeSyncState(null);
    await expect(openCloudVault(cloud,password,'person-b')).rejects.toThrow('autre compte Google');
    await expect(unlockVault(password)).rejects.toThrow('Aucun coffre');
    const opened=await openCloudVault(cloud,password,'person-a');
    expect(opened.data.owner?.subject).toBe('person-a');
  });
});
