/** Only Google-hosted account pictures are loaded by the profile UI. */
export function googlePicture(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) return url.href;
  } catch { /* A missing or invalid photo uses the person's initials. */ }
}
