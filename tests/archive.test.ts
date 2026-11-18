import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { packBundle, packSession, requiresBackupPassword, unpackBundle } from '../src/archive';
import { clearLocalVault, createVault, inspectManifest, type VaultSession } from '../src/core/vault';
import { keyBytes, makeAccess } from '../src/access';
import type { EncryptedBundle, VaultData } from '../src/core/types';

const password = 'un coffre vraiment secret';
function seed(): VaultData {
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), channels: [{ id: crypto.randomUUID(), name: 'Notes', description: '', icon: 'hash' }], messages: [], preferences: { theme: 'slate', font: 'system', fontSize: 15, limitBytes: 1024 * 1024 } };
}
function file(blob: Blob): File { return new File([blob], 'backup.flion'); }
function sample(): EncryptedBundle {
  return { manifest: new Uint8Array(52).fill(4), files: { [crypto.randomUUID()]: new Uint8Array(40).fill(7) } };
}
beforeEach(async () => { await clearLocalVault(); });

describe('encrypted backup format', () => {
  it('locks a detached copy with a password and checks the verified recipient before loading content', async () => {
    const data = seed();
    data.owner = {provider:'google', subject:'source-account'};
    const access = makeAccess(data.owner.subject, data.id);
    const session = await createVault(keyBytes(access), data);
    const photo = await session.addFile(new File(['album bytes'], 'photo.png', {type:'image/png'}));
    await session.update(current => ({
      ...current, messages: [{id:crypto.randomUUID(), channelId:data.channels[0].id, text:'Album', createdAt:new Date().toISOString(), attachments:[photo], pinned:true}],
    }));
    const archive = file(await packSession(session, access, {password, recipients:['alice@example.test', 'bob@example.test']}));
    expect(await requiresBackupPassword(archive)).toBe(true);
    expect(new TextDecoder().decode(await archive.arrayBuffer())).not.toContain(access.key);
    await expect(unpackBundle(archive)).rejects.toThrow('mot de passe');
    await expect(unpackBundle(archive, {password:'mot de passe erroné', email:'alice@example.test'})).rejects.toThrow('incorrect');
    await expect(unpackBundle(archive, {password, email:'eve@example.test'})).rejects.toThrow('destinataires');
    const { access: protectedKey, files, manifest } = await unpackBundle(archive, {password, email:'BOB@example.test'});
    expect(protectedKey?.key).not.toBe(access.key);
    expect(files[photo.id]).not.toEqual(await session.readEncryptedFile(photo.id));
    await expect(inspectManifest(keyBytes(access), manifest)).rejects.toThrow();
    expect((await inspectManifest(keyBytes(protectedKey!), manifest)).messages[0].text).toBe('Album');
  });

  it('writes explicitly little-endian integers and round-trips exact typed-array views', async () => {
    const backing = new Uint8Array(100).fill(9);
    const bundle = sample(); bundle.manifest = backing.subarray(10, 62);
    const archive = packBundle(bundle);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('FLIONA01');
    expect([...bytes.subarray(8, 12)]).toEqual([2, 0, 0, 0]);
    expect([...bytes.subarray(12, 20)]).toEqual([8, 0, 0, 0, 52, 0, 0, 0]);
    expect(await unpackBundle(file(archive))).toEqual(bundle);
  });

  it('rejects trailing bytes, truncation, incorrect magic and malformed entry lengths', async () => {
    const good = new Uint8Array(await packBundle(sample()).arrayBuffer());
    await expect(unpackBundle(file(new Blob([good, new Uint8Array([0])])))).rejects.toThrow('invalide');
    await expect(unpackBundle(file(new Blob([good.subarray(0, good.length - 1)])))).rejects.toThrow('invalide');
    const wrongMagic = good.slice(); wrongMagic[0] ^= 1;
    await expect(unpackBundle(file(new Blob([wrongMagic])))).rejects.toThrow('n’est pas');
    const wrongLength = good.slice(); new DataView(wrongLength.buffer).setUint32(12, 129, true);
    await expect(unpackBundle(file(new Blob([wrongLength])))).rejects.toThrow('invalide');
  });

  it('rejects duplicate manifests, malformed UUIDs and invalid UTF-8 names', async () => {
    const bytes = new Uint8Array(await packBundle({ manifest: new Uint8Array(52), files: {} }).arrayBuffer());
    const twice = new Uint8Array(bytes.length * 2 - 12);
    twice.set(bytes); twice.set(bytes.subarray(12), bytes.length); new DataView(twice.buffer).setUint32(8, 2, true);
    await expect(unpackBundle(file(new Blob([twice])))).rejects.toThrow('invalide');
    expect(() => packBundle({ manifest: new Uint8Array(52), files: { ['-'.repeat(36)]: new Uint8Array(36) } })).toThrow('invalide');
    const badName = bytes.slice(); badName[20] = 255;
    await expect(unpackBundle(file(new Blob([badName])))).rejects.toThrow('invalide');
  });

  it('validates entry bounds without reading the whole archive into memory', async () => {
    const input = file(packBundle(sample()));
    const fullRead = vi.spyOn(input, 'arrayBuffer').mockRejectedValue(new Error('whole-file read is forbidden'));
    const unpacked = await unpackBundle(input);
    expect(unpacked.manifest).toHaveLength(52); expect(fullRead).not.toHaveBeenCalled();
    const oversize = new File([], 'oversize.flion');
    Object.defineProperty(oversize, 'size', { value: 512 * 1024 * 1024 + 1 });
    const sliceSpy = vi.spyOn(oversize, 'slice');
    await expect(unpackBundle(oversize)).rejects.toThrow('volumineuse');
    expect(sliceSpy).not.toHaveBeenCalled();
  });

  it('accepts 10,000 attachments plus their manifest', async () => {
    const bundle: EncryptedBundle = { manifest: new Uint8Array(52), files: {} };
    for (let i = 0; i < 10_000; i++) bundle.files[crypto.randomUUID()] = new Uint8Array(36);
    const result = await unpackBundle(file(packBundle(bundle)));
    expect(Object.keys(result.files)).toHaveLength(10_000);
  }, 20_000); // Exercise the complete format boundary on slower CI file/blob implementations.
});

describe('bounded session export', () => {
  it('rejects an oversized backup before reading any attachment', async () => {
    const data = seed();
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: '', createdAt: new Date().toISOString(), attachments: Array.from({ length: 21 }, () => ({ id: crypto.randomUUID(), name: 'large.bin', mime: 'application/octet-stream', size: 25 * 1024 * 1024, storedSize: 25 * 1024 * 1024 + 36 })), pinned: false });
    const readFile = vi.fn();
    const fake = { data, exportManifest: async () => new Uint8Array(52), readEncryptedFile: readFile } as unknown as VaultSession;
    await expect(packSession(fake)).rejects.toThrow('512 Mo');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reads encrypted files individually and creates an importable backup', async () => {
    const session = await createVault(password, seed());
    const attachment = await session.addFile(new File(['private'], 'private.txt'));
    const data = session.data;
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: 'Note', createdAt: new Date().toISOString(), attachments: [attachment], pinned: false });
    await session.save(data);
    const bundleSpy = vi.spyOn(session, 'exportBundle');
    const fileSpy = vi.spyOn(session, 'readEncryptedFile');
    const backup = await packSession(session);
    expect(bundleSpy).not.toHaveBeenCalled(); expect(fileSpy).toHaveBeenCalledTimes(1);
    const unpacked = await unpackBundle(file(backup));
    expect(unpacked.manifest).toEqual(await session.exportManifest());
    expect(unpacked.files[attachment.id]).toEqual(await session.readEncryptedFile(attachment.id));
  });

  it('rejects a local edit during export instead of writing a mixed backup', async () => {
    const session = await createVault(password, seed());
    const attachment = await session.addFile(new File(['private'], 'private.txt'));
    const data = session.data;
    data.messages.push({ id: crypto.randomUUID(), channelId: data.channels[0].id, text: 'Note', createdAt: new Date().toISOString(), attachments: [attachment], pinned: false });
    await session.save(data);
    const actualRead = session.readEncryptedFile;
    vi.spyOn(session, 'readEncryptedFile').mockImplementation(async id => {
      const bytes = await actualRead(id);
      const changed = session.data; changed.messages[0].text = 'Modifié'; await session.save(changed);
      return bytes;
    });
    await expect(packSession(session)).rejects.toThrow('changé pendant l’export');
    expect(session.data.messages[0].text).toBe('Modifié');
  });
});
