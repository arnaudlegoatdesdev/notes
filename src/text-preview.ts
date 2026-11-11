import type { Attachment } from "./core/types";
export const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
export function textPreviewKind(file: Pick<Attachment, "name" | "mime">): "markdown" | "text" | null {
  if (/\.(md|markdown)$/i.test(file.name)) return "markdown";
  if (/\.txt$/i.test(file.name)) return "text";
  return null;
}
export function decodeTextPreview(bytes: Uint8Array, truncated = false): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  if (bytes.includes(0)) throw new Error("Ce fichier ne contient pas du texte lisible.");
  try { return new TextDecoder("utf-8", {fatal: true}).decode(bytes, {stream: truncated}); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}
export function previewLink(url: string): string {
  // Relative links and remote images in private documents are never fetched implicitly.
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : "";
}
