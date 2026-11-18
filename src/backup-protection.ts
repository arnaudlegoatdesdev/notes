import { validateAccess } from "./access";
import type { AccessRecord } from "./core/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const context = encoder.encode("Notes backup access 3");
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
export const MIN_BACKUP_PASSWORD = 12;
export const MAX_BACKUP_PASSWORD = 256;

export function parseRecipients(input: string): string[] {
  const emails = [...new Set(input.split(/[\s,;]+/).filter(Boolean).map(email => email.toLowerCase()))];
  if (emails.length > 12 || emails.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)))
    throw new Error("Vérifiez les adresses Google. Vous pouvez en indiquer jusqu’à 12.");
  return emails;
}

export function randomBackupPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return [...crypto.getRandomValues(new Uint8Array(24))].map(byte => chars[byte % chars.length]).join("");
}

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (password.length < MIN_BACKUP_PASSWORD || password.length > MAX_BACKUP_PASSWORD)
    throw new Error(`Utilisez un mot de passe de ${MIN_BACKUP_PASSWORD} à ${MAX_BACKUP_PASSWORD} caractères.`);
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, hash: "SHA-256", iterations: 600_000 },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function protectBackupAccess(access: AccessRecord, password: string, recipients: string[]) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const payload = encoder.encode(JSON.stringify({ access: validateAccess(access), recipients: parseRecipients(recipients.join(" ")) }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:"AES-GCM", iv, additionalData: context },
    await passwordKey(password, salt), payload));
  const envelope = new Uint8Array(salt.length + iv.length + ciphertext.length);
  envelope.set(salt);
  envelope.set(iv, salt.length);
  envelope.set(ciphertext, salt.length + iv.length);
  return envelope;
}

export async function openBackupAccess(bytes: Uint8Array<ArrayBuffer>, password: string, email: string): Promise<AccessRecord> {
  const ivOffset = SALT_LENGTH + NONCE_LENGTH;
  if (bytes.length <= ivOffset + 16) throw new Error("Sauvegarde protégée incomplète.");
  const key = await passwordKey(password, bytes.slice(0, SALT_LENGTH));
  let payload: { access: unknown; recipients: unknown };
  try {
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: bytes.slice(SALT_LENGTH, ivOffset), additionalData: context,
    }, key, bytes.slice(ivOffset));
    payload = JSON.parse(decoder.decode(plain));
    if (!payload || !Array.isArray(payload.recipients) ||
      payload.recipients.some(entry => typeof entry !== "string")) throw new Error();
  } catch {
    throw new Error("Mot de passe incorrect ou sauvegarde protégée endommagée.");
  }
  const recipients = parseRecipients((payload.recipients as string[]).join(" "));
  if (recipients.length && !recipients.includes(email.trim().toLowerCase()))
    throw new Error("Ce compte Google ne figure pas parmi les destinataires de cette copie.");
  return validateAccess(payload.access);
}
