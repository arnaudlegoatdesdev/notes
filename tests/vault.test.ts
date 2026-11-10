import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalVault, createVault, hasVault, importVault, importVaultStream, inspectManifest, unlockVault } from '../src/core/vault';
import type { VaultData } from '../src/core/types';

const password = 'un coffre vraiment secret';
function seed(limitBytes = 10 * 1024 * 1024): VaultData {
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), channels: [{ id: crypto.randomUUID(), name: 'Notes', description: 'Personnel', icon: 'hash' }], messages: [], preferences: { theme: 'slate', font: 'system', fontSize: 15, limitBytes } };
}
async function rawBytes(): Promise<string> {
  const req = indexedDB.open('notes-vault-v2');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const tx = db.transaction(['state', 'files']);
  const values = await Promise.all(['state', 'files'].map(name => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
  db.close();
  return JSON.stringify(values);
}
async function storedFileKeys(): Promise<string[]> {
  const req = indexedDB.open('notes-vault-v2');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const request = db.transaction('files').objectStore('files').getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close();
  return keys.map(String);
}
async function twoFileBundle() {
  const source = await createVault(password, seed());
  const first = await source.addFile(new File(['premier fichier'], 'premier.txt', { type: 'text/plain' }));
  const second = await source.addFile(new File(['second fichier'], 'second.txt', { type: 'text/plain' }));
  const next = source.data;
  next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'Deux fichiers', createdAt: new Date().toISOString(), attachments: [first, second], pinned: false });
  await source.save(next);
  const bundle = await source.exportBundle(); source.lock();
  await clearLocalVault();
  return { bundle, first, second, data: next };
}
beforeEach(async () => { await clearLocalVault(); });

describe('coffre chiffré', () => {
  it('conserve notes et fichiers après verrouillage sans texte clair dans IndexedDB', async () => {
    const input = seed();
    const session = await createVault(password, input);
    input.channels[0].name = 'Mutation interdite';
    expect(session.data.channels[0].name).toBe('Notes');
    const file = await session.addFile(new File(['document hautement personnel'], 'important.txt', { type: 'text/plain' }));
    const next = session.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'ma note privée', createdAt: new Date().toISOString(), attachments: [file], pinned: false });
    await session.save(next);
    next.messages[0].text = 'mutation après sauvegarde';
    expect((await rawBytes())).not.toContain('ma note privée');
    expect((await rawBytes())).not.toContain('important.txt');
    session.lock();
    expect(() => session.data).toThrow('verrouillé');
    const reopened = await unlockVault(password);
    expect(reopened.data.messages[0].text).toBe('ma note privée');
    expect(await (await reopened.readFile(file)).text()).toBe('document hautement personnel');
    expect(await hasVault()).toBe(true);
  });

  it('rejette mauvais mot de passe et coffre altéré sans remplacer le coffre existant', async () => {
    const original = await createVault(password, seed());
    const id = original.data.id;
    await expect(unlockVault('un autre mot de passe')).rejects.toThrow('incorrect');
    const bundle = await original.exportBundle();
    bundle.manifest[bundle.manifest.length - 1] ^= 1;
    await expect(importVault(password, bundle)).rejects.toThrow('incorrect');
    expect((await unlockVault(password)).data.id).toBe(id);
  });

  it('exporte et importe un coffre avec pièce jointe authentifiée', async () => {
    const original = await createVault(password, seed());
    const file = await original.addFile(new File(['photo binaire'], 'photo.png', { type: 'image/png' }));
    const next = original.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: '', createdAt: new Date().toISOString(), attachments: [file], pinned: true });
    await original.save(next);
    const bundle = await original.exportBundle();
    await clearLocalVault();
    const imported = await importVault(password, bundle);
    expect(imported.data).toEqual(next);
    expect(await (await imported.readFile(file)).text()).toBe('photo binaire');
    const damaged = await imported.exportBundle();
    damaged.files[file.id][damaged.files[file.id].length - 1] ^= 1;
    await expect(importVault(password, damaged)).rejects.toThrow('endommagée');
    expect(await (await imported.readFile(file)).text()).toBe('photo binaire');
  });

  it('rejette fichiers manquants et objets superflus à l’import', async () => {
    const session = await createVault(password, seed());
    const bundle = await session.exportBundle();
    bundle.files[crypto.randomUUID()] = new Uint8Array(36);
    await expect(importVault(password, bundle)).rejects.toThrow('valide');
    expect(await hasVault()).toBe(true);
  });

  it('lit seulement le manifeste et rejette une pièce jointe manquante avant remplacement', async () => {
    const session = await createVault(password, seed());
    const file = await session.addFile(new File(['important'], 'garder.txt'));
    const next = session.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'À garder', createdAt: new Date().toISOString(), attachments: [file], pinned: false });
    await session.save(next);
    const manifest = await session.exportManifest();
    expect(await inspectManifest(password, manifest)).toEqual(next);
    expect((await session.readEncryptedFile(file.id)).byteLength).toBe(file.storedSize);
    await expect(importVault(password, { manifest, files: {} })).rejects.toThrow('manquante');
    expect((await unlockVault(password)).data).toEqual(next);
    await session.save(next);
    expect(await session.exportManifest()).not.toEqual(manifest);
  });

  it('préserve données et quota sur échec d’écriture', async () => {
    const session = await createVault(password, seed(2000));
    const before = session.data;
    const used = await session.usedBytes();
    await expect(session.addFile(new File([new Uint8Array(2000)], 'trop.bin'))).rejects.toThrow('limite');
    expect(await session.usedBytes()).toBe(used);
    const next = session.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'x'.repeat(3000), createdAt: new Date().toISOString(), attachments: [], pinned: false });
    await expect(session.save(next)).rejects.toThrow('limite');
    expect(session.data).toEqual(before);
    expect((await unlockVault(password)).data).toEqual(before);
  });

  it('refuse de supprimer un fichier encore référencé et les sessions concurrentes', async () => {
    const session = await createVault(password, seed());
    const stale = await unlockVault(password);
    const file = await session.addFile(new File(['contenu'], 'test.txt'));
    await expect(stale.save(stale.data)).rejects.toThrow('autre onglet');
    const next = session.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: '', createdAt: new Date().toISOString(), attachments: [file], pinned: false });
    await session.save(next);
    await expect(session.removeFile(file.id)).rejects.toThrow('d’abord');
    next.messages = [];
    await session.save(next);
    await session.removeFile(file.id);
    expect((await session.exportBundle()).files).toEqual({});
  });

  it('récupère la place des pièces jointes abandonnées au déverrouillage', async () => {
    const session = await createVault(password, seed());
    const baseline = await session.usedBytes();
    await session.addFile(new File(['brouillon abandonné'], 'brouillon.txt'));
    expect(await session.usedBytes()).toBeGreaterThan(baseline);
    session.lock();
    const reopened = await unlockVault(password);
    expect(await reopened.usedBytes()).toBe(baseline);
    expect((await reopened.exportBundle()).files).toEqual({});
  });

  it('refuse une importation distante fondée sur une copie locale devenue ancienne', async () => {
    const session = await createVault(password, seed());
    const downloaded = await session.exportBundle();
    const lease = await session.storageRevision();
    const next = session.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'Modification pendant le téléchargement', createdAt: new Date().toISOString(), attachments: [], pinned: false });
    await session.save(next);
    await expect(importVault(password, downloaded, lease)).rejects.toThrow('autre onglet');
    expect((await unlockVault(password)).data).toEqual(next);
  });

  it('protège une importation qui avait commencé sur un appareil sans coffre', async () => {
    const original = await createVault(password, seed());
    const downloaded = await original.exportBundle();
    await clearLocalVault();
    const concurrent = await createVault(password, seed());
    await expect(importVault(password, downloaded, null)).rejects.toThrow('autre onglet');
    expect((await unlockVault(password)).data.id).toBe(concurrent.data.id);
    await clearLocalVault();
    expect((await importVault(password, downloaded, null)).data.id).toBe(original.data.id);
  });

  it('conserve le coffre original et nettoie les étapes si un téléchargement échoue à mi-chemin', async () => {
    const { bundle, second } = await twoFileBundle();
    const original = await createVault(password, seed());
    const originalData = original.data;
    const originalManifest = await original.exportManifest();
    const lease = await original.storageRevision();
    let calls = 0;
    await expect(importVaultStream(password, bundle.manifest, async item => {
      calls += 1;
      expect(await original.exportManifest()).toEqual(originalManifest);
      if (item.id === second.id) {
        expect((await storedFileKeys()).some(key => key.startsWith('stage:'))).toBe(true);
        throw new Error('Réseau interrompu');
      }
      return bundle.files[item.id];
    }, lease)).rejects.toThrow('Réseau interrompu');
    expect(calls).toBe(2);
    expect(await storedFileKeys()).toEqual([]);
    expect(original.data).toEqual(originalData);
    expect((await unlockVault(password)).data).toEqual(originalData);
  });

  it('importe séquentiellement puis réutilise les objets authentifiés et maintient leurs pointeurs', async () => {
    const { bundle, first, data } = await twoFileBundle();
    let loads = 0;
    const imported = await importVaultStream(password, bundle.manifest, async item => {
      loads += 1;
      if (loads === 2) expect(await storedFileKeys()).toHaveLength(1);
      return bundle.files[item.id];
    }, null);
    expect(loads).toBe(2);
    expect(imported.data).toEqual(data);
    expect(await (await imported.readFile(first)).text()).toBe('premier fichier');
    const beforeKeys = await storedFileKeys();
    const refreshed = await importVaultStream(password, bundle.manifest, async () => { throw new Error('Aucun téléchargement attendu'); }, await imported.storageRevision());
    expect(await storedFileKeys()).toEqual(beforeKeys);
    expect(await refreshed.exportBundle()).toEqual(bundle);
    const extra = await refreshed.addFile(new File(['après import'], 'nouveau.txt'));
    const next = refreshed.data;
    next.messages[0].attachments = [extra];
    await refreshed.save(next);
    for (const attachment of data.messages[0].attachments) await refreshed.removeFile(attachment.id);
    expect(await storedFileKeys()).toEqual([extra.id]);
    expect(await (await refreshed.readFile(extra)).text()).toBe('après import');
    expect((await unlockVault(password)).data).toEqual(next);
  });

  it('refuse la bascule atomique si la copie locale change pendant les transferts', async () => {
    const { bundle } = await twoFileBundle();
    const original = await createVault(password, seed());
    const next = original.data;
    next.messages.push({ id: crypto.randomUUID(), channelId: next.channels[0].id, text: 'À conserver', createdAt: new Date().toISOString(), attachments: [], pinned: false });
    const lease = await original.storageRevision();
    let changed = false;
    await expect(importVaultStream(password, bundle.manifest, async item => {
      if (!changed) { changed = true; await original.save(next); }
      return bundle.files[item.id];
    }, lease)).rejects.toThrow('autre onglet');
    expect((await unlockVault(password)).data).toEqual(next);
    expect(await storedFileKeys()).toEqual([]);
  });

  it('nettoie les étapes laissées par un arrêt sans toucher les fichiers actifs', async () => {
    const { bundle, first } = await twoFileBundle();
    const imported = await importVaultStream(password, bundle.manifest, async item => bundle.files[item.id], null);
    const liveKeys = await storedFileKeys();
    const open = indexedDB.open('notes-vault-v2');
    const db = await new Promise<IDBDatabase>(resolve => { open.onsuccess = () => resolve(open.result); });
    const tx = db.transaction('files', 'readwrite');
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    tx.objectStore('files').put(new Uint8Array([1, 2, 3]), 'stage:interrupted:orphan');
    await done; db.close();
    imported.lock();
    const reopened = await unlockVault(password);
    expect(await storedFileKeys()).toEqual(liveKeys);
    expect(await (await reopened.readFile(first)).text()).toBe('premier fichier');
  });

  it('explique une saturation du disque et garde le coffre précédent', async () => {
    const { bundle } = await twoFileBundle();
    const original = await createVault(password, seed());
    const initial = original.data;
    const put = IDBObjectStore.prototype.put;
    let staged = 0;
    const mock = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (typeof key === 'string' && key.startsWith('stage:') && ++staged === 2) throw new DOMException('Device full', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    try {
      await expect(importVaultStream(password, bundle.manifest, async item => bundle.files[item.id], await original.storageRevision())).rejects.toThrow('stockage de cet appareil est plein');
    } finally { mock.mockRestore(); }
    expect((await unlockVault(password)).data).toEqual(initial);
    expect(await storedFileKeys()).toEqual([]);
  });

  it('annule une opération de chiffrement quand le coffre est verrouillé', async () => {
    const session = await createVault(password, seed());
    let resume!: (bytes: ArrayBuffer) => void;
    const slowFile = new File(['secret'], 'secret.txt');
    slowFile.arrayBuffer = () => new Promise(resolve => { resume = resolve; });
    const adding = session.addFile(slowFile);
    // Wait until the file read has started after the IndexedDB snapshot.
    for (let i = 0; i < 100 && !resume; i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(resume).toBeTypeOf('function');
    session.lock();
    resume(new TextEncoder().encode('secret').buffer);
    await expect(adding).rejects.toThrow('verrouillé');
    expect(Object.keys((await (await unlockVault(password)).exportBundle()).files)).toHaveLength(0);
  });
});


describe('minimum password length', () => {
  it('accepts exactly8 characters for create, unlock and encrypted backup import, and rejects7', async () => {
    await expect(createVault('1234567', seed())).rejects.toThrow('8 à');
    const session = await createVault('12345678', seed());
    const expected = session.data;
    const bundle = await session.exportBundle();
    session.lock();
    const reopened = await unlockVault('12345678');
    expect(reopened.data).toEqual(expected);
    reopened.lock();
    const imported = await importVault('12345678', bundle);
    expect(imported.data).toEqual(expected);
    await expect(unlockVault('1234567')).rejects.toThrow('8 à');
  });
});
