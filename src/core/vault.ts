import type { Attachment, EncryptedBundle, VaultData } from './types';

const DB_NAME = 'flion-vault-v1';
const DB_VERSION = 1;
const VAULT_MAGIC = new TextEncoder().encode('FLIONV01');
const FILE_MAGIC = new TextEncoder().encode('FLIONF01');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ITERATIONS = 600_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_FILE_COUNT = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

type StoredState = { revision: string; manifest: Uint8Array; fileSizes: Record<string, number> };
export interface VaultSession {
  readonly data: VaultData;
  save(data: VaultData): Promise<void>;
  addFile(file: File): Promise<Attachment>;
  readFile(attachment: Attachment): Promise<Blob>;
  removeFile(id: string): Promise<void>;
  exportBundle(): Promise<EncryptedBundle>;
  exportManifest(): Promise<Uint8Array>;
  readEncryptedFile(id: string): Promise<Uint8Array>;
  usedBytes(): Promise<number>;
  storageRevision(): Promise<string>;
  lock(): void;
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> { return new Uint8Array(bytes); }
function concat(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.byteLength, 0));
  let offset = 0;
  for (const value of values) { output.set(value, offset); offset += value.byteLength; }
  return output;
}
function startsWith(bytes: Uint8Array, prefix: Uint8Array) {
  return prefix.every((value, index) => value === bytes[index]);
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('Stockage local indisponible.')); });
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Échec du stockage local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Écriture locale annulée.'));
  });
}
async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('Le stockage local sécurisé est indisponible dans ce navigateur.');
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => { req.result.createObjectStore('state'); req.result.createObjectStore('files'); };
  return request(req);
}
async function readState(): Promise<StoredState | undefined> {
  const db = await database();
  try { return await request(db.transaction('state').objectStore('state').get('vault')); }
  finally { db.close(); }
}
async function readStorage(): Promise<{ state?: StoredState; files: Record<string, Uint8Array> }> {
  const db = await database();
  try {
    const tx = db.transaction(['state', 'files']);
    const stateReq = request<StoredState | undefined>(tx.objectStore('state').get('vault'));
    const keyReq = request(tx.objectStore('files').getAllKeys());
    const valuesReq = request<Uint8Array[]>(tx.objectStore('files').getAll());
    const [state, keys, values] = await Promise.all([stateReq, keyReq, valuesReq]);
    const files: Record<string, Uint8Array> = Object.create(null);
    keys.forEach((key, index) => { files[String(key)] = copy(values[index]); });
    return { state, files };
  } finally { db.close(); }
}
function conflict(): Error { return new Error('Le coffre a changé dans un autre onglet. Verrouillez puis rouvrez-le avant de continuer.'); }

/** An explicit replacement is used only after all decryption and validation succeeds. */
async function replaceStorage(expected: string | undefined, manifest: Uint8Array, files: Record<string, Uint8Array>): Promise<string> {
  const db = await database();
  try {
    const tx = db.transaction(['state', 'files'], 'readwrite');
    const done = completion(tx);
    const state = tx.objectStore('state');
    const revision = crypto.randomUUID();
    let mismatch = false;
    const req = state.get('vault');
    req.onsuccess = () => {
      if ((req.result as StoredState | undefined)?.revision !== expected) { mismatch = true; tx.abort(); return; }
      state.put({ revision, manifest: copy(manifest), fileSizes: Object.fromEntries(Object.entries(files).map(([id, bytes]) => [id, bytes.byteLength])) } satisfies StoredState, 'vault');
      const store = tx.objectStore('files');
      store.clear();
      for (const [id, bytes] of Object.entries(files)) store.put(copy(bytes), id);
    };
    try { await done; } catch (error) { if (mismatch) throw conflict(); throw error; }
    return revision;
  } finally { db.close(); }
}

async function updateStorage(expected: string, manifest: Uint8Array, fileSizes: Record<string, number>, changes: Record<string, Uint8Array | undefined>, guard: () => void): Promise<string> {
  const db = await database();
  try {
    const tx = db.transaction(['state', 'files'], 'readwrite');
    const done = completion(tx);
    const state = tx.objectStore('state');
    const revision = crypto.randomUUID();
    let failure: unknown;
    const req = state.get('vault');
    req.onsuccess = () => {
      try {
        guard();
        if ((req.result as StoredState | undefined)?.revision !== expected) throw conflict();
        state.put({ revision, manifest: copy(manifest), fileSizes: { ...fileSizes } } satisfies StoredState, 'vault');
        const store = tx.objectStore('files');
        for (const [id, bytes] of Object.entries(changes)) {
          if (bytes) store.put(copy(bytes), id); else store.delete(id);
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure ?? error; }
    return revision;
  } finally { db.close(); }
}
async function readOneFile(id: string): Promise<{ state?: StoredState; bytes?: Uint8Array }> {
  const db = await database();
  try {
    const tx = db.transaction(['state', 'files']);
    const [state, bytes] = await Promise.all([
      request<StoredState | undefined>(tx.objectStore('state').get('vault')),
      request<Uint8Array | undefined>(tx.objectStore('files').get(id)),
    ]);
    return { state, bytes };
  } finally { db.close(); }
}
function ensureReferenceSizes(data: VaultData, fileSizes: Record<string, number>) {
  for (const [id, item] of references(data)) if (fileSizes[id] !== item.storedSize) throw new Error('Une pièce jointe est manquante ou endommagée.');
}
function quotaSizes(data: VaultData, manifest: Uint8Array, fileSizes: Record<string, number>) {
  if (manifest.byteLength + Object.values(fileSizes).reduce((sum, size) => sum + size, 0) > data.preferences.limitBytes) throw new Error('La limite de stockage du coffre est atteinte. Augmentez-la dans les paramètres ou supprimez des fichiers.');
}

function invalid(): never { throw new Error('Ce fichier ne contient pas un coffre Flion valide.'); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number, empty = true): value is string { return typeof value === 'string' && value.length <= max && (empty || value.length > 0); }
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function attachment(value: unknown): value is Attachment {
  if (!isRecord(value)) return false;
  return uuid(value.id) && text(value.name, 1024, false) && text(value.mime, 255) && number(value.size, MAX_FILE_BYTES) && number(value.storedSize, MAX_FILE_BYTES + 36) && value.storedSize === value.size + 36;
}
function validateData(value: unknown): asserts value is VaultData {
  if (!isRecord(value) || value.version !== 1 || !uuid(value.id) || !timestamp(value.createdAt)) invalid();
  if (!Array.isArray(value.channels) || value.channels.length > 10_000 || !Array.isArray(value.messages) || value.messages.length > 100_000 || !isRecord(value.preferences)) invalid();
  const preferences = value.preferences;
  if (!['slate', 'light', 'forest', 'sand', 'plum'].includes(String(preferences.theme)) || !['system', 'inter', 'serif', 'mono'].includes(String(preferences.font)) || !number(preferences.fontSize, 32) || Number(preferences.fontSize) < 12 || !number(preferences.limitBytes) || !preferences.limitBytes) invalid();
  const channelIds = new Set<string>();
  for (const channel of value.channels) {
    if (!isRecord(channel) || !uuid(channel.id) || channelIds.has(channel.id) || !text(channel.name, 100, false) || !text(channel.description, 1000) || !['hash', 'bookmark', 'image', 'file', 'plane', 'code', 'heart'].includes(String(channel.icon))) invalid();
    channelIds.add(channel.id);
  }
  const messageIds = new Set<string>();
  const attachments = new Map<string, string>();
  for (const message of value.messages) {
    if (!isRecord(message) || !uuid(message.id) || messageIds.has(message.id) || !channelIds.has(String(message.channelId)) || !text(message.text, 1_000_000) || !timestamp(message.createdAt) || (message.updatedAt !== undefined && !timestamp(message.updatedAt)) || !Array.isArray(message.attachments) || message.attachments.length > 100 || typeof message.pinned !== 'boolean') invalid();
    messageIds.add(message.id);
    for (const item of message.attachments) {
      if (!attachment(item)) invalid();
      const serialized = JSON.stringify(item);
      if (attachments.has(item.id) && attachments.get(item.id) !== serialized) invalid();
      attachments.set(item.id, serialized);
    }
  }
  if (attachments.size > MAX_FILE_COUNT) invalid();
}
function references(data: VaultData): Map<string, Attachment> {
  const output = new Map<string, Attachment>();
  for (const message of data.messages) for (const item of message.attachments) output.set(item.id, item);
  return output;
}
function ensureFileReferences(data: VaultData, files: Record<string, Uint8Array>) {
  for (const [id, item] of references(data)) if (!files[id] || files[id].byteLength !== item.storedSize) throw new Error('Une pièce jointe est manquante ou endommagée.');
}
function quota(data: VaultData, manifest: Uint8Array, files: Record<string, Uint8Array>) {
  const total = manifest.byteLength + Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
  if (total > data.preferences.limitBytes) throw new Error('La limite de stockage du coffre est atteinte. Augmentez-la dans les paramètres ou supprimez des fichiers.');
}
function validatePassphrase(passphrase: string) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Utilisez un mot de passe de 12 à 1 024 caractères.');
}
async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  // Parameters are fixed by the format, never accepted from an imported envelope.
  validatePassphrase(passphrase);
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: copy(salt), iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptManifest(data: VaultData, key: CryptoKey, salt: Uint8Array): Promise<Uint8Array> {
  const bytes = encoder.encode(JSON.stringify(data));
  if (bytes.byteLength > MAX_MANIFEST_BYTES - 52) throw new Error('Le coffre contient trop de messages pour cette version de Flion.');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aad = concat(VAULT_MAGIC, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes);
  return concat(aad, iv, new Uint8Array(ciphertext));
}
function parseManifest(manifest: Uint8Array): { salt: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array } {
  if (!(manifest instanceof Uint8Array) || manifest.byteLength < 52 || manifest.byteLength > MAX_MANIFEST_BYTES || !startsWith(manifest, VAULT_MAGIC)) invalid();
  return { salt: copy(manifest.subarray(8, 24)), iv: copy(manifest.subarray(24, 36)), ciphertext: copy(manifest.subarray(36)) };
}
async function decryptManifest(manifest: Uint8Array, passphrase: string): Promise<{ key: CryptoKey; salt: Uint8Array; data: VaultData }> {
  const { salt, iv, ciphertext } = parseManifest(manifest);
  const key = await derive(passphrase, salt);
  let bytes: ArrayBuffer;
  try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy(iv), additionalData: concat(VAULT_MAGIC, salt) }, key, copy(ciphertext)); }
  catch { throw new Error('Mot de passe incorrect ou coffre endommagé.'); }
  let data: unknown;
  try { data = JSON.parse(decoder.decode(bytes)); } catch { invalid(); }
  validateData(data);
  return { key, salt, data };
}
async function decryptFile(bytes: Uint8Array, id: string, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes.byteLength < 36 || bytes.byteLength > MAX_FILE_BYTES + 36 || !startsWith(bytes, FILE_MAGIC)) throw new Error('Pièce jointe endommagée.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy(bytes.subarray(8, 20)), additionalData: concat(FILE_MAGIC, encoder.encode(id)) }, key, copy(bytes.subarray(20))));
  } catch { throw new Error('Pièce jointe endommagée.'); }
}

export async function inspectManifest(passphrase: string, manifest: Uint8Array): Promise<VaultData> {
  return structuredClone((await decryptManifest(manifest, passphrase)).data);
}
export async function hasVault(): Promise<boolean> { return !!(await readState()); }
export async function createVault(passphrase: string, initialData: VaultData): Promise<VaultSession> {
  const data = structuredClone(initialData);
  validateData(data);
  const current = await readState();
  if (current) throw new Error('Un coffre existe déjà sur cet appareil.');
  ensureFileReferences(data, {});
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derive(passphrase, salt);
  const manifest = await encryptManifest(data, key, salt);
  quota(data, manifest, {});
  const revision = await replaceStorage(undefined, manifest, {});
  return session(data, key, salt, revision);
}
export async function unlockVault(passphrase: string): Promise<VaultSession> {
  const state = await readState();
  if (!state) throw new Error('Aucun coffre sur cet appareil.');
  const result = await decryptManifest(state.manifest, passphrase);
  ensureReferenceSizes(result.data, state.fileSizes);
  // Draft attachment bytes are persisted before their message. A refreshed or
  // locked composer cannot recover them, so reclaim only unreferenced objects.
  const referenced = references(result.data);
  const orphanIds = Object.keys(state.fileSizes).filter(id => !referenced.has(id));
  let revision = state.revision;
  if (orphanIds.length) {
    const fileSizes = { ...state.fileSizes };
    const changes: Record<string, undefined> = {};
    for (const id of orphanIds) { delete fileSizes[id]; changes[id] = undefined; }
    revision = await updateStorage(state.revision, state.manifest, fileSizes, changes, () => undefined);
  }
  return session(result.data, result.key, result.salt, revision);
}
export async function importVault(passphrase: string, bundle: EncryptedBundle, expectedRevision?: string): Promise<VaultSession> {
  // Clone caller-owned bytes before the first await.
  if (!bundle || !(bundle.manifest instanceof Uint8Array) || !isRecord(bundle.files) || Object.keys(bundle.files).length > MAX_FILE_COUNT) invalid();
  parseManifest(bundle.manifest);
  const manifest = copy(bundle.manifest);
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [id, bytes] of Object.entries(bundle.files)) {
    if (!uuid(id) || !(bytes instanceof Uint8Array) || bytes.byteLength < 36 || bytes.byteLength > MAX_FILE_BYTES + 36) invalid();
    files[id] = copy(bytes);
  }
  // Snapshot existing revision before the expensive KDF so concurrent changes are never overwritten.
  const current = await readState();
  if (expectedRevision !== undefined && current?.revision !== expectedRevision) throw conflict();
  const { key, salt, data } = await decryptManifest(manifest, passphrase);
  ensureFileReferences(data, files);
  if (references(data).size !== Object.keys(files).length) invalid();
  quota(data, manifest, files);
  for (const [id, item] of references(data)) {
    const plaintext = await decryptFile(files[id], id, key);
    if (plaintext.byteLength !== item.size) invalid();
  }
  const revision = await replaceStorage(current?.revision, manifest, files);
  return session(data, key, salt, revision);
}
export async function clearLocalVault(): Promise<void> {
  const db = await database();
  try { const tx = db.transaction(['state', 'files'], 'readwrite'); const done = completion(tx); tx.objectStore('state').clear(); tx.objectStore('files').clear(); await done; }
  finally { db.close(); }
}

function session(initialData: VaultData, initialKey: CryptoKey, salt: Uint8Array, initialRevision: string): VaultSession {
  let data: VaultData | null = structuredClone(initialData);
  let key: CryptoKey | null = initialKey;
  let revision = initialRevision;
  let serial: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  function active(): { data: VaultData; key: CryptoKey; epoch: number } {
    if (!data || !key) throw new Error('Le coffre est verrouillé.');
    return { data, key, epoch };
  }
  function check(expectedEpoch: number) { if (epoch !== expectedEpoch || !key || !data) throw new Error('Le coffre est verrouillé.'); }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = serial.then(operation);
    serial = result.catch(() => undefined);
    return result;
  }
  async function storage(expectedEpoch: number): Promise<StoredState> {
    const state = await readState(); check(expectedEpoch);
    if (state?.revision !== revision) throw conflict();
    return state;
  }
  async function commit(manifest: Uint8Array, fileSizes: Record<string, number>, changes: Record<string, Uint8Array | undefined>, expectedEpoch: number) {
    check(expectedEpoch);
    const nextRevision = await updateStorage(revision, manifest, fileSizes, changes, () => check(expectedEpoch));
    check(expectedEpoch);
    revision = nextRevision;
  }
  return {
    get data() { return structuredClone(active().data); },
    save(nextData) {
      // Copy synchronously before callers can mutate the argument while crypto is running.
      const snapshot = structuredClone(nextData);
      return enqueue(async () => {
        const current = active(); validateData(snapshot);
        if (snapshot.id !== current.data.id || snapshot.createdAt !== current.data.createdAt) throw new Error('L’identité du coffre ne peut pas être modifiée.');
        const state = await storage(current.epoch);
        ensureReferenceSizes(snapshot, state.fileSizes);
        const manifest = await encryptManifest(snapshot, current.key, salt); check(current.epoch);
        quotaSizes(snapshot, manifest, state.fileSizes);
        await commit(manifest, state.fileSizes, {}, current.epoch);
        data = snapshot;
      });
    },
    addFile(file) {
      return enqueue(async () => {
        const current = active();
        if (!file || !number(file.size, MAX_FILE_BYTES) || !text(file.name, 1024, false) || !text(file.type, 255)) throw new Error('Chaque fichier doit faire au maximum 25 Mo.');
        const state = await storage(current.epoch);
        if (Object.keys(state.fileSizes).length >= MAX_FILE_COUNT) throw new Error('Le nombre maximal de pièces jointes est atteint.');
        // Check the bound before allocating or reading the file.
        if (state.manifest.byteLength + Object.values(state.fileSizes).reduce((sum, size) => sum + size, 0) + file.size + 36 > current.data.preferences.limitBytes) throw new Error('La limite de stockage du coffre est atteinte.');
        const id = crypto.randomUUID();
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const plaintext = await file.arrayBuffer(); check(current.epoch);
        if (plaintext.byteLength !== file.size) throw new Error('La taille du fichier a changé pendant sa lecture.');
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: concat(FILE_MAGIC, encoder.encode(id)) }, current.key, plaintext); check(current.epoch);
        const bytes = concat(FILE_MAGIC, iv, new Uint8Array(ciphertext));
        const fileSizes = { ...state.fileSizes, [id]: bytes.byteLength };
        quotaSizes(current.data, state.manifest, fileSizes);
        await commit(state.manifest, fileSizes, { [id]: bytes }, current.epoch);
        return { id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, storedSize: bytes.byteLength };
      });
    },
    readFile(input) {
      const item = structuredClone(input);
      return enqueue(async () => {
        const current = active();
        if (!attachment(item)) throw new Error('Pièce jointe invalide.');
        const { state, bytes } = await readOneFile(item.id); check(current.epoch);
        if (state?.revision !== revision) throw conflict();
        if (!bytes || bytes.byteLength !== item.storedSize) throw new Error('Pièce jointe manquante.');
        const plaintext = await decryptFile(bytes, item.id, current.key); check(current.epoch);
        if (plaintext.byteLength !== item.size) throw new Error('Pièce jointe endommagée.');
        return new Blob([plaintext], { type: item.mime });
      });
    },
    removeFile(id) {
      return enqueue(async () => {
        const current = active();
        if (!uuid(id)) throw new Error('Pièce jointe invalide.');
        if (references(current.data).has(id)) throw new Error('Retirez d’abord la pièce jointe du message avant de la supprimer.');
        const state = await storage(current.epoch);
        if (!state.fileSizes[id]) return;
        const fileSizes = { ...state.fileSizes };
        delete fileSizes[id];
        await commit(state.manifest, fileSizes, { [id]: undefined }, current.epoch);
      });
    },
    exportManifest() {
      return enqueue(async () => {
        const current = active();
        const state = await storage(current.epoch);
        return copy(state.manifest);
      });
    },
    readEncryptedFile(id) {
      return enqueue(async () => {
        const current = active();
        if (!uuid(id) || !references(current.data).has(id)) throw new Error('Pièce jointe inconnue.');
        const { state, bytes } = await readOneFile(id); check(current.epoch);
        if (state?.revision !== revision) throw conflict();
        if (!bytes) throw new Error('Pièce jointe manquante.');
        return copy(bytes);
      });
    },
    exportBundle() {
      return enqueue(async () => {
        const current = active();
        const { state, files } = await readStorage(); check(current.epoch);
        if (state?.revision !== revision) throw conflict();
        const referenced: Record<string, Uint8Array> = Object.create(null);
        for (const id of references(current.data).keys()) referenced[id] = copy(files[id]);
        return { manifest: copy(state.manifest), files: referenced };
      });
    },
    storageRevision() {
      return enqueue(async () => {
        const current = active();
        await storage(current.epoch);
        return revision;
      });
    },
    usedBytes() {
      return enqueue(async () => {
        const current = active(); const state = await storage(current.epoch);
        return state.manifest.byteLength + Object.values(state.fileSizes).reduce((sum, size) => sum + size, 0);
      });
    },
    lock() { epoch += 1; key = null; data = null; },
  };
}
