import type { EncryptedBundle } from './core/types';
import type { VaultSession } from './core/vault';

const magic = new TextEncoder().encode('FLIONA01');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX = 512 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024 + 36;
const MAX_ENTRIES = 10_001; // Up to 10,000 attachments plus the manifest.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function invalid(): never { throw new Error('Sauvegarde Notes invalide ou incomplète.'); }
function entrySize(name: string, size: number): number {
  if (name !== 'manifest' && !uuid.test(name)) invalid();
  if (!Number.isSafeInteger(size) || size < (name === 'manifest' ? 52 : 36) || size > (name === 'manifest' ? MAX_MANIFEST : MAX_FILE)) invalid();
  return 8 + encoder.encode(name).byteLength + size;
}
function header(name: string, size: number): Blob {
  const encoded = encoder.encode(name);
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setUint32(0, encoded.byteLength, true);
  view.setUint32(4, size, true);
  return new Blob([bytes, encoded]);
}
function start(count: number): BlobPart[] {
  if (!count || count > MAX_ENTRIES) invalid();
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setUint32(0, count, true);
  return [magic, bytes];
}
function asPart(bytes: Uint8Array): BlobPart {
  return bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : new Uint8Array(bytes);
}
function checkArchiveSize(size: number): void {
  if (size > MAX) throw new Error('Cette sauvegarde dépasse 512 Mo. Utilisez la synchronisation cloud.');
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
}

export function packBundle(bundle: EncryptedBundle): Blob {
  const entries = [['manifest', bundle.manifest], ...Object.entries(bundle.files)] as [string, Uint8Array][];
  const parts = start(entries.length);
  const total = entries.reduce((sum, [name, bytes]) => sum + entrySize(name, bytes.byteLength), 12);
  checkArchiveSize(total);
  for (const [name, bytes] of entries) parts.push(header(name, bytes.byteLength), asPart(bytes));
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Reads one encrypted attachment at a time instead of materializing exportBundle(). */
export async function packSession(session: VaultSession): Promise<Blob> {
  const manifest = await session.exportManifest();
  const data = session.data;
  const refs = new Map(data.messages.flatMap(message => message.attachments.map(item => [item.id, item] as const)));
  const parts = start(refs.size + 1);
  let total = 12 + entrySize('manifest', manifest.byteLength);
  for (const [id, item] of refs) total += entrySize(id, item.storedSize);
  checkArchiveSize(total); // Reject the whole archive before reading attachment bytes.
  parts.push(header('manifest', manifest.byteLength), new Blob([asPart(manifest)]));
  for (const [id, item] of refs) {
    const bytes = await session.readEncryptedFile(id);
    if (bytes.byteLength !== item.storedSize) invalid();
    parts.push(header(id, bytes.byteLength), new Blob([asPart(bytes)]));
  }
  // Any local edit during export must be retried, never produce a mixed snapshot.
  if (!sameBytes(manifest, await session.exportManifest())) throw new Error('Le coffre a changé pendant l’export. Réessayez la sauvegarde.');
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function unpackBundle(file: File): Promise<EncryptedBundle> {
  if (file.size > MAX) throw new Error('Sauvegarde trop volumineuse (512 Mo maximum).');
  if (file.size < 12) invalid();
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!magic.every((value, index) => value === prefix[index])) throw new Error('Ce fichier n’est pas une sauvegarde Notes.');
  const count = new DataView(prefix.buffer).getUint32(8, true);
  if (!count || count > MAX_ENTRIES) invalid();
  let offset = 12;
  const entries: { name: string; size: number; offset: number }[] = [];
  const names = new Set<string>();
  // Validate the complete index and all bounds before allocating any file payload.
  for (let i = 0; i < count; i++) {
    if (offset + 8 > file.size) invalid();
    const view = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const nameSize = view.getUint32(0, true), size = view.getUint32(4, true);
    offset += 8;
    if (!nameSize || nameSize > 128 || offset + nameSize + size > file.size) invalid();
    let name: string;
    try { name = decoder.decode(await file.slice(offset, offset + nameSize).arrayBuffer()); } catch { invalid(); }
    entrySize(name, size);
    if (names.has(name)) invalid();
    names.add(name);
    offset += nameSize;
    entries.push({ name, size, offset });
    offset += size;
  }
  if (offset !== file.size || !names.has('manifest')) invalid();
  const files: Record<string, Uint8Array> = Object.create(null);
  let manifest: Uint8Array | undefined;
  for (const entry of entries) {
    const bytes = new Uint8Array(await file.slice(entry.offset, entry.offset + entry.size).arrayBuffer());
    if (bytes.byteLength !== entry.size) invalid();
    if (entry.name === 'manifest') manifest = bytes;
    else files[entry.name] = bytes;
  }
  return { manifest: manifest!, files };
}
