import type { LinkPreview } from "./core/types";
import { isDesktop } from "./desktop";
import { externalUrl } from "./external-links";
import { isSpaceImage } from "./core/space-image";

export function messageLinkParts(text: string): {text: string; url?: string}[] {
  const parts: {text: string; url?: string}[] = [];
  const expression = /https?:\/\/[^\s<>"'`]+/gi;
  let from = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index! > from) parts.push({text: text.slice(from, match.index)});
    let candidate = match[0].replace(/[.,;!:]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (candidate.endsWith(close) && candidate.split(close).length > candidate.split(open).length) candidate = candidate.slice(0, -1);
    }
    const url = externalUrl(candidate);
    parts.push({text: candidate, ...(url ? {url} : {})});
    if (candidate.length < match[0].length) parts.push({text: match[0].slice(candidate.length)});
    from = match.index! + match[0].length;
  }
  if (from < text.length) parts.push({text: text.slice(from)});
  return parts;
}
export function publicPreviewUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (!externalUrl(url.href) || !["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (!host.includes(".") || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
        /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host) || (url.port && !["80", "443"].includes(url.port))) return null;
    return url.href;
  } catch { return null; }
}
export function previewUrls(text: string): string[] {
  return [...new Set(messageLinkParts(text).flatMap((part) => part.url && publicPreviewUrl(part.url) ? [part.url] : []))].slice(0, 3);
}
function cleanText(value: string | undefined, max: number): string {
  if (!value) return "";
  // Decode entities without parsing arbitrary document markup or fetching its resources.
  const element = document.createElement("textarea");
  element.innerHTML = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return element.value.replace(/\s+/g, " ").trim().slice(0, max);
}
export function parseLinkMetadata(html: string, pageUrl: string, originalUrl = pageUrl): LinkPreview & {imageUrl?: string} {
  const head = html.slice(0, 512 * 1024).split(/<\/head\s*>/i)[0];
  const values = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>/gi)) {
    const attributes = new Map<string, string>();
    for (const attr of match[0].matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
    }
    const key = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
    if (!values.has(key) && attributes.has("content")) values.set(key, attributes.get("content")!);
  }
  const get = (...keys: string[]) => keys.map((key) => values.get(key)).find((value) => !!value?.trim());
  const title = cleanText(get("og:title", "twitter:title") || /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1], 240);
  const rawImage = cleanText(get("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"), 8192);
  const imageUrl = rawImage ? publicPreviewUrl(rawImage, pageUrl) : null;
  return {url: originalUrl, title: title || new URL(originalUrl).hostname,
    description: cleanText(get("og:description", "twitter:description", "description"), 600),
    siteName: cleanText(get("og:site_name"), 100) || new URL(pageUrl).hostname,
    ...(imageUrl ? {imageUrl} : {})};
}
interface Resource { url: string; contentType: string; bytes: Uint8Array<ArrayBuffer>; }
async function readResource(url: string, kind: "page" | "image"): Promise<Resource> {
  if (!publicPreviewUrl(url)) throw new Error("Aperçu indisponible.");
  const limit = kind === "page" ? 512 * 1024 : 3 * 1024 * 1024;
  if (isDesktop) {
    const {invoke} = await import("@tauri-apps/api/core");
    const result = await invoke<{url: string; contentType: string; body: string}>("fetch_link_resource", {url, kind});
    if (result.body.length > Math.ceil((limit + 1) * 4 / 3) + 4 || !publicPreviewUrl(result.url)) throw new Error("Aperçu invalide.");
    return {url: result.url, contentType: result.contentType, bytes: Uint8Array.from(atob(result.body), (c) => c.charCodeAt(0))};
  }
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal});
    if (!response.ok || !publicPreviewUrl(response.url || url) || !response.body) throw new Error("Aperçu indisponible.");
    const contentType = (response.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const remaining = limit - size;
        if (value.byteLength > remaining) {
          if (kind === "image") throw new Error("Image trop volumineuse.");
          chunks.push(value.slice(0, remaining)); size += remaining;
          break;
        }
        chunks.push(value); size += value.byteLength;
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return {url: response.url || url, contentType, bytes};
  } finally { clearTimeout(timeout); }
}
async function imageThumbnail(resource: Resource): Promise<string | undefined> {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(resource.contentType)) return;
  const url = URL.createObjectURL(new Blob([resource.bytes], {type: resource.contentType})), image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) return;
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) return;
    for (const width of [640, 480, 320]) {
      const ratio = Math.min(1, width / image.naturalWidth, 360 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/webp", .78);
      if (isSpaceImage(result)) return result;
    }
  } finally { image.src = ""; URL.revokeObjectURL(url); }
}
// Share in-flight work between cards, bound requests and release content on sign-out.
let scheduled: Promise<unknown> = Promise.resolve();
const requests = new Map<string, Promise<LinkPreview | null>>();
let generation = 0;
export function clearLinkPreviewCache() { generation++; requests.clear(); scheduled = Promise.resolve(); }
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const existing = requests.get(url);
  if (existing) return existing;
  const expected = generation;
  const promise = scheduled.then(async () => {
    if (expected !== generation) return null;
    try {
      const page = await readResource(url, "page");
      if (!["text/html", "application/xhtml+xml"].includes(page.contentType)) return null;
      const {imageUrl, ...metadata} = parseLinkMetadata(new TextDecoder().decode(page.bytes), page.url, url);
      if (expected !== generation) return null;
      if (imageUrl) {
        try { const image = await imageThumbnail(await readResource(imageUrl, "image")); if (image) return {...metadata, image}; }
        catch { /* A blocked image must not discard the title and description. */ }
      }
      return metadata;
    } catch { return null; }
  });
  scheduled = promise;
  if (requests.size >= 200) requests.delete(requests.keys().next().value!);
  requests.set(url, promise);
  return promise;
}
