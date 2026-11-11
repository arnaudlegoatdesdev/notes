import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createData } from '../src/seed';
import { channelsInSpace, spacesOf, withSpaces } from '../src/spaces';
import { mergeVault, stampChanges } from '../src/merge';
import { clearLocalVault, createVault, inspectManifest, sealManifest, unlockVault } from '../src/core/vault';
import type { VaultData } from '../src/core/types';

const key = new Uint8Array(32).fill(9);
function seed() {
  const data = withSpaces(createData());
  data.channels.push({id: crypto.randomUUID(), spaceId: data.id, name: 'Notes', description: '', icon: 'hash'});
  return data;
}
function addNote(data: VaultData, text: string) {
  data.messages.push({id: crypto.randomUUID(), channelId: data.channels[0].id, text, createdAt: new Date().toISOString(), attachments: [], pinned: false});
}
beforeEach(() => clearLocalVault());
describe('spaces and OLED theme', () => {
  it('opens existing notes in a deterministic first space without changing their contents', async () => {
    const legacy = seed();
    legacy.version = 1;
    delete legacy.spaces;
    delete legacy.channels[0].spaceId;
    addNote(legacy, 'À conserver');
    const session = await createVault(key, legacy);
    session.lock();
    const opened = (await unlockVault(key)).data;
    expect(opened).toEqual(legacy);
    expect(withSpaces(opened)).toEqual(withSpaces(structuredClone(legacy)));
    expect(spacesOf(opened)).toEqual([{id: legacy.id, name: 'Mon espace'}]);
    const next = withSpaces(opened);
    expect(next.version).toBe(2);
    next.preferences.theme = 'onyx';
    const encrypted = await sealManifest(key, next);
    expect(await inspectManifest(key, encrypted)).toEqual(next);
  });
  it('merges independent spaces, a rename and a channel move in either device order', () => {
    const base = seed();
    addNote(base, 'Note existante');
    const pc = structuredClone(base), phone = structuredClone(base);
    const work = {id: crypto.randomUUID(), name: 'Travail'};
    pc.spaces!.push(work);
    pc.channels[0].spaceId = work.id;
    phone.spaces![0].name = 'Personnel';
    phone.spaces!.push({id: crypto.randomUUID(), name: 'Voyages'});
    phone.messages[0].text = 'Modifiée sur mobile';
    const left = stampChanges(base, pc), right = stampChanges(base, phone);
    const merged = mergeVault(base, left, right);
    expect(merged).toEqual(mergeVault(base, right, left));
    expect(merged.spaces!.map((s) => s.name)).toEqual(expect.arrayContaining(['Personnel', 'Travail', 'Voyages']));
    expect(merged.channels[0].spaceId).toBe(work.id);
    expect(merged.messages[0].text).toBe('Modifiée sur mobile');
  });
  it('keeps a new offline note and restores its channel and space after remote deletion', async () => {
    const base = seed();
    base.spaces!.push({id: crypto.randomUUID(), name: 'Autre'});
    const pc = structuredClone(base), phone = structuredClone(base);
    pc.spaces = pc.spaces!.slice(1);
    pc.channels = [];
    addNote(phone, 'Envoyée hors ligne');
    const merged = mergeVault(base, stampChanges(base, pc), stampChanges(base, phone));
    expect(merged.messages[0].text).toBe('Envoyée hors ligne');
    expect(merged.channels[0].spaceId).toBe(base.id);
    expect(merged.spaces!.some((s) => s.id === base.id)).toBe(true);
    await expect(sealManifest(key, merged)).resolves.toBeInstanceOf(Uint8Array);
  });
  it('preserves a channel and its existing notes moved out of a space deleted on the other device', async () => {
    const base = seed();
    const destination = {id: crypto.randomUUID(), name: 'Travail'};
    base.spaces!.push(destination);
    addNote(base, 'À garder avec le salon');
    const moved = structuredClone(base), deleted = structuredClone(base);
    moved.channels[0].spaceId = destination.id;
    deleted.spaces = [destination];
    deleted.channels = [];
    deleted.messages = [];
    const left = stampChanges(base, moved), right = stampChanges(base, deleted);
    const merged = mergeVault(base, left, right);
    expect(merged.spaces).toEqual([destination]);
    expect(merged.channels[0].spaceId).toBe(destination.id);
    expect(merged.messages[0].text).toBe('À garder avec le salon');
    expect(merged).toEqual(mergeVault(base, right, left));
    await expect(sealManifest(key, merged)).resolves.toBeInstanceOf(Uint8Array);
  });
  it('does not resurrect a deleted space without new content', () => {
    const base = seed();
    addNote(base, 'Supprimée');
    const other = {id: crypto.randomUUID(), name: 'Autre'};
    base.spaces!.push(other);
    const deleted = structuredClone(base);
    deleted.spaces = [other];
    deleted.channels = [];
    deleted.messages = [];
    const merged = mergeVault(base, deleted, base);
    expect(merged.spaces).toEqual([other]);
    expect(merged.channels).toEqual([]);
    expect(merged.messages).toEqual([]);
  });
  it('preserves an empty usable space when devices delete different last spaces concurrently', async () => {
    const base = seed();
    base.spaces!.push({id: crypto.randomUUID(), name: 'Autre'});
    base.channels = [];
    const pc = structuredClone(base), phone = structuredClone(base);
    pc.spaces = pc.spaces!.slice(0, 1);
    phone.spaces = phone.spaces!.slice(1);
    const merged = mergeVault(base, pc, phone);
    expect(merged.spaces).toHaveLength(1);
    await expect(sealManifest(key, merged)).resolves.toBeInstanceOf(Uint8Array);
  });
  it('encrypts space illustrations and merges picture changes independently from renames', async () => {
    const base = seed();
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const pc = structuredClone(base), phone = structuredClone(base);
    pc.spaces![0].image = image;
    phone.spaces![0].name = 'Personnel';
    const merged = mergeVault(base, stampChanges(base, pc), stampChanges(base, phone));
    const encrypted = await sealManifest(key, merged);
    expect((await inspectManifest(key, encrypted)).spaces![0]).toMatchObject({name: 'Personnel', image});
    const removed = structuredClone(merged), renamed = structuredClone(merged);
    removed.spaces![0].image = null;
    removed.spaces![0].icon = 'heart';
    renamed.spaces![0].name = 'Mes notes';
    const cleared = mergeVault(merged, stampChanges(merged, removed), stampChanges(merged, renamed));
    expect(cleared.spaces![0]).toMatchObject({name: 'Mes notes', image: null, icon: 'heart'});
    await expect(sealManifest(key, cleared)).resolves.toBeInstanceOf(Uint8Array);
  });
  it('rejects remote, active or oversized space images while keeping saved notes intact', async () => {
    const original = seed(), session = await createVault(key, original);
    for (const image of ['https://example.com/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'A'.repeat(65536)]) {
      const invalid = structuredClone(original);
      invalid.spaces![0].image = image;
      await expect(session.save(invalid)).rejects.toThrow();
    }
    const invalid = structuredClone(original);
    invalid.spaces![0].icon = 'unknown' as 'heart';
    await expect(session.save(invalid)).rejects.toThrow();
    expect((await unlockVault(key)).data).toEqual(original);
  });
  it('persists channel order, appends new channels and merges a reorder with an independent rename', async () => {
    const base = seed();
    base.channels.push({...base.channels[0], id: crypto.randomUUID(), name: 'Documents'});
    const pc = structuredClone(base), phone = structuredClone(base);
    pc.spaces![0].channelOrder = base.channels.map((c) => c.id).reverse();
    phone.channels[0].name = 'Renommé sur mobile';
    phone.channels.push({...phone.channels[0], id: crypto.randomUUID(), name: 'Nouveau'});
    const merged = mergeVault(base, stampChanges(base, pc), stampChanges(base, phone));
    expect(channelsInSpace(merged, base.id).map((c) => c.name)).toEqual(['Documents', 'Renommé sur mobile', 'Nouveau']);
    const session = await createVault(key, merged);
    session.lock();
    expect(channelsInSpace((await unlockVault(key)).data, base.id).map((c) => c.name)).toEqual(['Documents', 'Renommé sur mobile', 'Nouveau']);
    const invalid = structuredClone(merged);
    invalid.spaces![0].channelOrder = [base.channels[0].id, base.channels[0].id];
    await expect(sealManifest(key, invalid)).rejects.toThrow();
  });
  it('stores link cards and their thumbnail inside the encrypted vault and rejects external image payloads', async () => {
    const data = seed();
    addNote(data, 'https://example.com/article');
    data.messages[0].linkPreviews = [{url:'https://example.com/article', title:'Un article à garder', description:'Une description', image:'data:image/png;base64,YQ=='}];
    const session = await createVault(key, data);
    session.lock();
    expect((await unlockVault(key)).data.messages[0].linkPreviews).toEqual(data.messages[0].linkPreviews);
    const invalid = structuredClone(data);
    invalid.messages[0].linkPreviews![0].image = 'https://tracker.example.com/image.png';
    await expect(sealManifest(key, invalid)).rejects.toThrow();
    invalid.messages[0].linkPreviews![0].image = 'data:image/svg+xml;base64,PHN2Zz4=';
    await expect(sealManifest(key, invalid)).rejects.toThrow();
    expect((await unlockVault(key)).data.messages[0].linkPreviews![0].title).toBe('Un article à garder');
  });
  it('rejects orphan channels, duplicate spaces and an unsupported theme without replacing saved notes', async () => {
    const data = seed(), session = await createVault(key, data);
    const orphan = structuredClone(data);
    orphan.channels[0].spaceId = crypto.randomUUID();
    await expect(session.save(orphan)).rejects.toThrow();
    const duplicate = structuredClone(data);
    duplicate.spaces!.push(duplicate.spaces![0]);
    await expect(session.save(duplicate)).rejects.toThrow();
    const invalid = structuredClone(data);
    invalid.preferences.theme = 'unknown' as 'onyx';
    await expect(session.save(invalid)).rejects.toThrow();
    expect((await unlockVault(key)).data).toEqual(data);
  });
});
