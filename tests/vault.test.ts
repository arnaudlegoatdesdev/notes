import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalVault, createVault, hasVault, importVault, inspectManifest, unlockVault } from '../src/core/vault';
import type { VaultData } from '../src/core/types';

const password = 'un coffre vraiment secret';
function seed(limitBytes = 10 * 1024 * 1024): VaultData {
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), channels: [{ id: crypto.randomUUID(), name: 'Notes', description: 'Personnel', icon: 'hash' }], messages: [], preferences: { theme: 'slate', font: 'system', fontSize: 15, limitBytes } };
}
async function rawBytes(): Promise<string> {
  const req = indexedDB.open('flion-vault-v1');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const tx = db.transaction(['state', 'files']);
  const values = await Promise.all(['state', 'files'].map(name => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
  db.close();
  return JSON.stringify(values);
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
