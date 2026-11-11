import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./desktop";

export function externalUrl(value: string): string | null {
  if (value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.protocol !== "mailto:" && !url.hostname) return null;
    return url.href;
  } catch { return null; }
}
export function handleNativeLinks(report: (message: string) => void): () => void {
  if (!isDesktop) return () => {};
  const handle = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download")) return;
    let href = anchor.href;
    const raw = anchor.getAttribute("href") || "";
    if (/^(?:\.\/)?(?:about|privacy|terms)\.html$/.test(raw)) href = `https://notes.flion.fr/${raw.replace(/^\.\//, "")}`;
    const url = externalUrl(href);
    if (!url) return;
    event.preventDefault();
    void invoke("open_external", {url})
      .catch(() => report("Impossible d’ouvrir le lien. Vérifiez votre navigateur par défaut et la version de Notes."));
  };
  document.addEventListener("click", handle);
  document.addEventListener("auxclick", handle);
  return () => { document.removeEventListener("click", handle); document.removeEventListener("auxclick", handle); };
}
