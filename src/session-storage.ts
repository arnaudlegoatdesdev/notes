import type { GoogleUser } from "./auth";
import type { GoogleCredentials } from "./cloud/google";
import {googlePicture} from "./google-picture";
export interface SavedLogin {
  version: 1;
  user: GoogleUser;
  credentials: (GoogleCredentials & { expiresAt: number }) | null;
}
type LoginEnvelope = { iv: Uint8Array; sealed: Uint8Array };
const DB = "notes-login-v1";
let generation = 0;
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Impossible de mémoriser la connexion."));
  });
}
async function database(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore("session");
  return request(req);
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error("Impossible de mémoriser la connexion."));
  });
}
export function validateUser(value: unknown): GoogleUser {
  if (!value || typeof value !== "object")
    throw new Error("Session Notes invalide.");
  const u = value as GoogleUser;
  if (
    typeof u.id !== "string" ||
    !u.id ||
    u.id.length > 255 ||
    typeof u.email !== "string" ||
    !u.email ||
    u.email.length > 1024 ||
    typeof u.name !== "string" ||
    !u.name ||
    u.name.length > 1024
  )
    throw new Error("Session Notes invalide.");
  const picture = googlePicture(u.picture);
  return { id: u.id, email: u.email, name: u.name, ...(picture ? {picture} : {}) };
}
export async function updateWebProfile(user: GoogleUser): Promise<void> {
  return updateWebLogin(user.id, (current) => ({ ...current, user: validateUser(user) }));
}
async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  const found = await request<CryptoKey | undefined>(
    db.transaction("session").objectStore("session").get("key"),
  );
  if (found) return found;
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const tx = db.transaction("session", "readwrite"),
    complete = done(tx),
    store = tx.objectStore("session");
  let selected = candidate;
  const current = store.get("key");
  current.onsuccess = () => {
    if (current.result) selected = current.result;
    else store.put(candidate, "key");
  };
  await complete;
  return selected;
}
export async function saveWebLogin(
  user: GoogleUser,
  credentials: GoogleCredentials | null,
): Promise<void> {
  const expected = generation;
  const record: SavedLogin = { version: 1, user: validateUser(user), credentials: dated(credentials) };
  const db = await database();
  try {
    const key = await encryptionKey(db);
    await storeLogin(db, key, record, expected);
  } finally {
    db.close();
  }
}

function dated(credentials: GoogleCredentials | null): SavedLogin["credentials"] {
  if (
    credentials &&
    (!credentials.accessToken ||
      credentials.accessToken.length > 32768 ||
      !Number.isFinite(credentials.expiresIn) ||
      credentials.expiresIn <= 0 ||
      credentials.expiresIn > 86400)
  )
    throw new Error("Session Google invalide.");
  return credentials && {
    accessToken: credentials.accessToken,
    scope: credentials.scope,
    expiresIn: credentials.expiresIn,
    expiresAt: Date.now() + credentials.expiresIn * 1000,
  };
}

async function storeLogin(db: IDBDatabase, key: CryptoKey, record: SavedLogin, expected: number, previous?: LoginEnvelope) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(record));
  if (bytes.byteLength > 65536) throw new Error("Session Google invalide.");
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(DB) }, key, bytes);
  if (generation !== expected) return false;
  const tx = db.transaction("session", "readwrite");
  const complete = done(tx);
  const store = tx.objectStore("session");
  let saved = false;
  const write = () => {
    if (generation !== expected) return;
    store.put({ iv, sealed: new Uint8Array(sealed) }, "login");
    saved = true;
  };
  if (previous) {
    const latest = store.get("login");
    latest.onsuccess = () => {
      const current = latest.result as LoginEnvelope | undefined;
      if (current?.iv?.length === previous.iv.length && previous.iv.every((byte, i) => byte === current.iv[i])) write();
    };
  } else write();
  await complete;
  return saved;
}

function readEnvelope(db: IDBDatabase) {
  const store = db.transaction("session").objectStore("session");
  return Promise.all([
    request<CryptoKey | undefined>(store.get("key")),
    request<LoginEnvelope | undefined>(store.get("login")),
  ]);
}

async function decryptLogin(key: CryptoKey, envelope: LoginEnvelope): Promise<SavedLogin | null> {
  if (
    envelope.iv.byteLength !== 12 ||
    envelope.sealed.byteLength < 16 ||
    envelope.sealed.byteLength > 65552
  )
    return null;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(envelope.iv),
        additionalData: encoder.encode(DB),
      },
      key,
      new Uint8Array(envelope.sealed),
    );
    const value = JSON.parse(decoder.decode(plain)) as SavedLogin;
    if (value.version !== 1) return null;
    const user = validateUser(value.user),
      c = value.credentials;
    const valid =
      c &&
      typeof c.accessToken === "string" &&
      c.accessToken.length > 0 &&
      c.accessToken.length <= 32768 &&
      Number.isFinite(c.expiresAt) &&
      c.expiresAt > Date.now() + 60_000 &&
      c.expiresAt <= Date.now() + 86400_000 &&
      (c.scope === undefined || typeof c.scope === "string");
    return {
      version: 1,
      user,
      credentials: valid
        ? {
            accessToken: c.accessToken,
            scope: c.scope,
            expiresAt: c.expiresAt,
            expiresIn: Math.floor((c.expiresAt - Date.now()) / 1000),
          }
        : null,
    };
  } catch {
    return null;
  }
}

export async function readWebLogin(): Promise<SavedLogin | null> {
  const db = await database();
  try {
    const [key, envelope] = await readEnvelope(db);
    return key && envelope ? await decryptLogin(key, envelope) : null;
  } finally {
    db.close();
  }
}

async function updateWebLogin(subject: string, update: (login: SavedLogin) => SavedLogin) {
  const expected = generation;
  const db = await database();
  try {
    // Keep profile refreshes and Drive grants from overwriting one another across tabs.
    for (let attempt = 0; attempt < 5 && generation === expected; attempt++) {
      const [key, envelope] = await readEnvelope(db);
      if (!key || !envelope) return;
      const current = await decryptLogin(key, envelope);
      if (current?.user.id !== subject) return;
      if (await storeLogin(db, key, update(current), expected, envelope)) return;
    }
    if (generation === expected) throw new Error("Impossible de mémoriser la connexion Google. Réessayez.");
  } finally {
    db.close();
  }
}
export async function updateWebCredentials(
  subject: string,
  credentials: GoogleCredentials,
  profile?: GoogleUser,
): Promise<void> {
  const next = dated(credentials);
  return updateWebLogin(subject, current => ({
    ...current,
    user: profile?.id === subject ? validateUser(profile) : current.user,
    credentials: next,
  }));
}
export async function clearWebLogin(): Promise<void> {
  generation += 1;
  const db = await database();
  try {
    const tx = db.transaction("session", "readwrite"),
      complete = done(tx);
    tx.objectStore("session").delete("login");
    await complete;
  } finally {
    db.close();
  }
}
