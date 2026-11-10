import type { AccessRecord } from "./core/types";
import type { CloudConnection, CloudFile } from "./cloud";
import { inspectManifest, accessKeyFromPassword } from "./core/vault";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const profilePattern = /^notes-access-([a-f0-9-]{36})\.json$/;
export function validateAccess(value: unknown): AccessRecord {
  if (!value || typeof value !== "object")
    throw new Error("Accès Notes invalide.");
  const v = value as AccessRecord;
  if (
    v.version !== 1 ||
    typeof v.owner !== "string" ||
    !v.owner ||
    v.owner.length > 255 ||
    !uuid.test(v.vaultId) ||
    typeof v.key !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(v.key)
  )
    throw new Error("Accès Notes invalide.");
  return { version: 1, owner: v.owner, vaultId: v.vaultId, key: v.key };
}
export function keyBytes(record: AccessRecord): Uint8Array {
  return Uint8Array.from(atob(validateAccess(record).key), (c) =>
    c.charCodeAt(0),
  );
}
export function makeAccess(
  owner: string,
  vaultId: string,
  key: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): AccessRecord {
  return validateAccess({
    version: 1,
    owner,
    vaultId,
    key: btoa(String.fromCharCode(...key)),
  });
}
async function db(): Promise<IDBDatabase> {
  const req = indexedDB.open("notes-access-v1", 1);
  req.onupgradeneeded = () =>
    req.result.createObjectStore("keys", { keyPath: "vaultId" });
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveAccess(record: AccessRecord): Promise<void> {
  const value = validateAccess(record),
    database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("keys", "readwrite");
      let failure: Error | undefined;
      const store = tx.objectStore("keys"),
        existing = store.get(value.vaultId);
      existing.onsuccess = () => {
        const prior = existing.result as AccessRecord | undefined;
        if (prior && (prior.owner !== value.owner || prior.key !== value.key)) {
          failure = new Error(
            "Une autre clé existe pour cet espace. L’accès local est conservé.",
          );
          tx.abort();
          return;
        }
        store.put(value);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          failure || new Error("Impossible de conserver l’accès à vos notes."),
        );
    });
  } finally {
    database.close();
  }
}
export async function localAccess(owner: string): Promise<AccessRecord[]> {
  const database = await db();
  try {
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const r = database.transaction("keys").objectStore("keys").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return all.map(validateAccess).filter((v) => v.owner === owner);
  } finally {
    database.close();
  }
}
export async function migrateAccess(
  owner: string,
  pass: string,
  manifest: Uint8Array,
): Promise<AccessRecord> {
  const data = await inspectManifest(pass, manifest);
  if (data.owner && data.owner.subject !== owner)
    throw new Error("Ce coffre appartient à un autre compte Google.");
  const record = makeAccess(
    owner,
    data.id,
    await accessKeyFromPassword(pass, manifest),
  );
  await saveAccess(record);
  return record;
}
export function storageChoice(owner: string): "local" | "drive" | null {
  try {
    const v = localStorage.getItem(`notes.storage.${owner}`);
    return v === "local" || v === "drive" ? v : null;
  } catch {
    return null;
  }
}
export function rememberStorage(
  owner: string,
  choice: "local" | "drive",
): void {
  localStorage.setItem(`notes.storage.${owner}`, choice);
}
export async function readCloudAccess(
  conn: CloudConnection,
  owner: string,
  files?: CloudFile[],
): Promise<AccessRecord | null> {
  const profiles = (files || (await conn.list())).filter((f) =>
    profilePattern.test(f.name),
  );
  const records = new Map<string, AccessRecord>();
  for (const file of profiles) {
    if (file.size > 2048 || file.size < 1)
      throw new Error("Configuration Notes invalide sur Drive.");
    const bytes = await conn.read(file.id);
    if (bytes.byteLength !== file.size)
      throw new Error("Configuration Notes incomplète.");
    const r = validateAccess(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (r.owner !== owner || file.name !== `notes-access-${r.vaultId}.json`)
      throw new Error("Cette configuration appartient à un autre compte.");
    if (records.has(r.vaultId) && records.get(r.vaultId)!.key !== r.key)
      throw new Error("Deux clés différentes existent pour ces notes.");
    records.set(r.vaultId, r);
  }
  if (records.size > 1)
    throw new Error(
      "Plusieurs espaces Notes existent sur Drive. Importez la sauvegarde de l’espace à conserver.",
    );
  return [...records.values()][0] || null;
}
const published = new WeakMap<CloudConnection, string>();
export async function publishAccess(
  conn: CloudConnection,
  record: AccessRecord,
): Promise<void> {
  const fingerprint = `${record.owner}:${record.vaultId}:${record.key}`;
  if (published.get(conn) === fingerprint) return;
  const remote = await readCloudAccess(conn, record.owner);
  if (remote) {
    if (remote.vaultId !== record.vaultId || remote.key !== record.key)
      throw new Error(
        "Drive contient un autre espace Notes. Votre copie locale est conservée.",
      );
    published.set(conn, fingerprint);
    return;
  }
  await conn.create(
    `notes-access-${record.vaultId}.json`,
    new TextEncoder().encode(JSON.stringify(validateAccess(record))),
  );
  const verified = await readCloudAccess(conn, record.owner);
  if (
    !verified ||
    verified.vaultId !== record.vaultId ||
    verified.key !== record.key
  )
    throw new Error("Impossible de vérifier l’accès aux notes sur Drive.");
  published.set(conn, fingerprint);
}
