import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalVault,
  createVault,
  inspectManifest,
  sealManifest,
  unlockVault,
} from "../src/core/vault";
import type { VaultData } from "../src/core/types";
import type { CloudConnection, CloudFile } from "../src/cloud";
import { createData } from "../src/seed";
import {
  makeAccess,
  keyBytes,
  localAccess,
  saveAccess,
  publishAccess,
  readCloudAccess,
} from "../src/access";
import {
  findHeads,
  history,
  commonAncestor,
  openCloudVault,
  syncVault,
  readSyncState,
  writeSyncState,
  SyncFailure,
} from "../src/sync-v2";
import { mergeVault, stampChanges } from "../src/merge";
import { packSession, unpackBundle } from "../src/archive";
const owner = "google-person-a";
class Drive implements CloudConnection {
  provider = "google" as const;
  account = "a@example.com";
  files = new Map<string, { name: string; bytes: Uint8Array }>();
  afterCreate?: (name: string) => Promise<void>;
  failList = false;
  add(name: string, bytes: Uint8Array) {
    const id = crypto.randomUUID();
    this.files.set(id, { name, bytes: bytes.slice() });
    return id;
  }
  async list() {
    if (this.failList) throw new Error("offline");
    return [...this.files].map(([id, f]) => ({
      id,
      name: f.name,
      size: f.bytes.byteLength,
    }));
  }
  async read(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error("missing");
    return f.bytes.slice();
  }
  async create(name: string, bytes: Uint8Array) {
    const id = this.add(name, bytes);
    await this.afterCreate?.(name);
    return { id, name, size: bytes.byteLength };
  }
  async quota() {
    return {
      total: 1e12,
      used: [...this.files.values()].reduce(
        (s, f) => s + f.bytes.byteLength,
        0,
      ),
    };
  }
  async disconnect() {}
}
function seed() {
  const data = createData();
  data.owner = { provider: "google", subject: owner };
  data.channels.push({
    id: crypto.randomUUID(),
    name: "Perso",
    description: "",
    icon: "hash",
  });
  return data;
}
function note(data: VaultData, text: string) {
  return {
    id: crypto.randomUUID(),
    channelId: data.channels[0].id,
    text,
    createdAt: new Date().toISOString(),
    attachments: [],
    pinned: false,
  };
}
async function setup() {
  const initial = seed(),
    record = makeAccess(owner, initial.id),
    key = keyBytes(record),
    session = await createVault(key, initial),
    cloud = new Drive();
  await publishAccess(cloud, record);
  await syncVault(cloud, session, key, owner);
  const root = findHeads(await cloud.list())[0].id;
  return { initial: session.data, record, key, session, cloud, root };
}
beforeEach(async () => {
  await clearLocalVault();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});
describe("passwordless account access", () => {
  it("starts empty and reopens notes directly with the saved account key", async () => {
    expect(createData().channels).toEqual([]);
    const data = seed(),
      record = makeAccess(owner, data.id);
    await saveAccess(record);
    const session = await createVault(keyBytes(record), data);
    const next = session.data;
    next.messages.push(note(next, "Ma note"));
    await session.save(next);
    session.lock();
    const reopened = await unlockVault(keyBytes(record));
    expect(reopened.data.messages[0].text).toBe("Ma note");
    expect((await localAccess(owner)).some((r) => r.vaultId === data.id)).toBe(
      true,
    );
  });
  it("never overwrites a valid local access key with a different remote key", async () => {
    const record = makeAccess(owner, crypto.randomUUID());
    await saveAccess(record);
    await expect(saveAccess(makeAccess(owner, record.vaultId))).rejects.toThrow(
      "autre clé",
    );
    expect(
      (await localAccess(owner)).find((r) => r.vaultId === record.vaultId),
    ).toEqual(record);
  });
  it("recovers from only a Google account and its Drive profile on a fresh device", async () => {
    const { record, cloud, session, key } = await setup();
    const data = session.data;
    data.messages.push(note(data, "Retrouvée sur mobile"));
    await session.save(data);
    await syncVault(cloud, session, key, owner);
    session.lock();
    await clearLocalVault();
    writeSyncState(null);
    const remoteAccess = await readCloudAccess(cloud, owner);
    expect(remoteAccess).toEqual(record);
    const mobile = await openCloudVault(cloud, keyBytes(remoteAccess!), owner);
    expect(mobile.data.messages[0].text).toBe("Retrouvée sur mobile");
    await expect(readCloudAccess(cloud, "wrong-person")).rejects.toThrow(
      "autre compte",
    );
  });
  it("starts and reopens a fresh cloud space while obsolete encrypted snapshots remain untouched", async () => {
    const initial = seed(),
      record = makeAccess(owner, initial.id),
      key = keyBytes(record);
    const session = await createVault(key, initial),
      cloud = new Drive();
    const oldId = crypto.randomUUID();
    const oldSnapshot = cloud.add(
      `s-${oldId}--root.flion`,
      new Uint8Array(100),
    );
    cloud.add(`notes-access-${oldId}.json`, new TextEncoder().encode("{}"));
    await publishAccess(cloud, record);
    await syncVault(cloud, session, key, owner);
    expect(findHeads(await cloud.list())).toHaveLength(1);
    expect(findHeads(await cloud.list())[0].file.name).toMatch(/^n-.*\.notes$/);
    expect(cloud.files.has(oldSnapshot)).toBe(true);
    session.lock();
    await clearLocalVault();
    writeSyncState(null);
    const remoteAccess = await readCloudAccess(cloud, owner);
    const phone = await openCloudVault(cloud, keyBytes(remoteAccess!), owner);
    expect(phone.data.id).toBe(initial.id);
  });
  it("exports a portable private backup and can reopen it without a password", async () => {
    const { record, session } = await setup();
    const archive = await packSession(session, record),
      bundle = await unpackBundle(new File([archive], "backup.notes"));
    expect(bundle.access).toEqual(record);
    expect(
      (await inspectManifest(keyBytes(bundle.access!), bundle.manifest)).id,
    ).toBe(record.vaultId);
  });
});
describe("concurrent PC and phone updates", () => {
  it("does not download unchanged metadata again on each poll", async () => {
    const { cloud, session, key } = await setup();
    const reads = vi.spyOn(cloud, "read");
    const result = await syncVault(cloud, session, key, owner);
    expect(result.session).toBe(session);
    expect(reads).not.toHaveBeenCalled();
  });
  it("merges independent local and remote notes and reuses local attachment ciphertext", async () => {
    const { initial, key, session, cloud, root } = await setup();
    const remote = structuredClone(initial);
    remote.messages.push(note(remote, "Téléphone"));
    cloud.add(
      `n-${crypto.randomUUID()}--${root}.notes`,
      await sealManifest(key, remote),
    );
    const local = session.data;
    const file = await session.addFile(new File(["document"], "doc.txt"));
    local.messages.push({ ...note(local, "PC"), attachments: [file] });
    await session.save(local);
    const result = await syncVault(cloud, session, key, owner);
    expect(result.session.data.messages.map((m) => m.text).sort()).toEqual([
      "PC",
      "Téléphone",
    ]);
    expect(await (await result.session.readFile(file)).text()).toBe("document");
    expect(findHeads(await cloud.list())).toHaveLength(1);
    expect(readSyncState()?.dirty).toBe(false);
  });
  it("merges a real publication race into one head without dropping either note", async () => {
    const { initial, key, session, cloud, root } = await setup();
    const remote = structuredClone(initial);
    remote.messages.push(note(remote, "Mobile simultané"));
    const remoteManifest = await sealManifest(key, remote);
    const local = session.data;
    local.messages.push(note(local, "PC simultané"));
    await session.save(local);
    let raced = false;
    cloud.afterCreate = async (name) => {
      if (name.startsWith("n-") && !raced) {
        raced = true;
        cloud.add(`n-${crypto.randomUUID()}--${root}.notes`, remoteManifest);
      }
    };
    const result = await syncVault(cloud, session, key, owner);
    expect(result.session.data.messages.map((m) => m.text).sort()).toEqual([
      "Mobile simultané",
      "PC simultané",
    ]);
    const heads = findHeads(await cloud.list());
    expect(heads).toHaveLength(1);
    expect(heads[0].parents).toHaveLength(2);
    expect(
      (await inspectManifest(key, await cloud.read(heads[0].file.id))).messages,
    ).toHaveLength(2);
  });
  it("syncs spaces, channel moves and Onyx through encrypted Drive snapshots to a fresh device", async () => {
    const {initial, key, session, cloud, root} = await setup();
    const remote = structuredClone(initial);
    remote.spaces![0].name = "Personnel";
    remote.messages.push({...note(remote, "Depuis le téléphone https://example.com/article"), linkPreviews: [{url:'https://example.com/article', title:'Un article enregistré', image:'data:image/png;base64,YQ=='}]});
    cloud.add(`n-${crypto.randomUUID()}--${root}.notes`, await sealManifest(key, stampChanges(initial, remote)));
    const local = session.data;
    const work = {id: crypto.randomUUID(), name: "Travail", icon: "code" as const, channelOrder: [] as string[],
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="};
    local.spaces!.push(work);
    local.channels.push({...local.channels[0], id: crypto.randomUUID(), spaceId: work.id, name: "Documents"});
    work.channelOrder = [local.channels[1].id, local.channels[0].id];
    local.channels[0].spaceId = work.id;
    local.preferences.theme = "onyx";
    await session.save(stampChanges(initial, local));
    const result = await syncVault(cloud, session, key, owner);
    expect(result.session.data.spaces!.map((s) => s.name)).toEqual(["Personnel", "Travail"]);
    expect(result.session.data.channels[0].spaceId).toBe(work.id);
    expect(result.session.data.messages[0].text).toBe("Depuis le téléphone https://example.com/article");
    expect(result.session.data.messages[0].linkPreviews![0].title).toBe('Un article enregistré');
    expect(result.session.data.preferences.theme).toBe("onyx");
    const expected = result.session.data;
    result.session.lock();
    await clearLocalVault();
    writeSyncState(null);
    const fresh = await openCloudVault(cloud, key, owner);
    expect(fresh.data).toEqual(expected);
  });
  it("keeps a live local session if the network fails after the atomic merge", async () => {
    const { initial, key, session, cloud, root } = await setup();
    const remote = structuredClone(initial);
    remote.messages.push(note(remote, "Mobile"));
    cloud.add(
      `n-${crypto.randomUUID()}--${root}.notes`,
      await sealManifest(key, remote),
    );
    const local = session.data;
    local.messages.push(note(local, "PC"));
    await session.save(local);
    cloud.afterCreate = async (name) => {
      if (name.startsWith("n-")) cloud.failList = true;
    };
    let live;
    try {
      await syncVault(cloud, session, key, owner);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SyncFailure);
      live = (error as SyncFailure).session;
    }
    expect(live.data.messages).toHaveLength(2);
    cloud.failList = false;
    cloud.afterCreate = undefined;
    expect(
      (await syncVault(cloud, live, key, owner)).session.data.messages,
    ).toHaveLength(2);
  });
  it("merges fields separately, respects deletions, and deterministically settles a shared-field edit", () => {
    const base = seed();
    base.messages.push(note(base, "Initial"));
    const left = structuredClone(base),
      right = structuredClone(base);
    left.messages[0].text = "PC";
    right.messages[0].pinned = true;
    const merged = mergeVault(
      base,
      stampChanges(base, left, "2026-11-10T10:00:00Z"),
      stampChanges(base, right, "2026-11-10T11:00:00Z"),
    );
    expect(merged.messages[0]).toMatchObject({ text: "PC", pinned: true });
    right.messages[0].text = "Mobile";
    const a = stampChanges(base, left, "2026-11-10T10:00:00Z"),
      b = stampChanges(base, right, "2026-11-10T11:00:00Z");
    expect(mergeVault(base, a, b)).toEqual(mergeVault(base, b, a));
    expect(mergeVault(base, a, b).messages[0].text).toBe("Mobile");
    left.channels = [];
    left.messages = [];
    expect(mergeVault(base, left, right).messages).toEqual([]);
    right.messages.push(note(base, "Écrite hors ligne"));
    expect(mergeVault(base, left, right).messages.map((m) => m.text)).toEqual([
      "Écrite hors ligne",
    ]);
    expect(mergeVault(base, left, right).channels).toHaveLength(1);
  });
  it("validates merge history, including a shared ancestor and hidden cycles", () => {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      c = crypto.randomUUID(),
      d = crypto.randomUUID();
    const version = (id: string, parents = "root"): CloudFile => ({
      id: crypto.randomUUID(),
      name: `n-${id}--${parents}.notes`,
      size: 100,
    });
    const files = [
      version(a),
      version(b, a),
      version(c, a),
      version(d, `${b}--${c}`),
    ];
    expect(findHeads(files)[0].id).toBe(d);
    expect(commonAncestor(history(files), [b, c])).toBe(a);
    expect(() => history([version(a), version(b, c), version(c, b)])).toThrow(
      "invalide",
    );
  });
});
