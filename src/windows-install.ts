export const APP_VERSION = "0.4.0";
export interface WindowsDownload {
  version: string;
  url: string;
}
export function isWindowsBrowser(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
  native: boolean,
): boolean {
  return (
    !native &&
    /Windows NT/i.test(nav.userAgent) &&
    !/Android|Mobile|iPhone|iPad|Windows Phone/i.test(nav.userAgent) &&
    /Win/i.test(nav.platform)
  );
}
export function windowsAsset(release: unknown): WindowsDownload | null {
  if (!release || typeof release !== "object") return null;
  const value = release as {
    draft?: boolean;
    prerelease?: boolean;
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  if (
    value.draft ||
    value.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(value.tag_name || "") ||
    !Array.isArray(value.assets)
  )
    return null;
  const version = value.tag_name!.slice(1),
    parts = version.split(".").map(Number),
    current = APP_VERSION.split(".").map(Number);
  const older = parts.findIndex((n, i) => n !== current[i]);
  if (older >= 0 && parts[older] < current[older]) return null;
  const name = `Notes_${version}_x64-setup.exe`,
    url = `https://github.com/arnaudlegoatdesdev/notes/releases/download/${value.tag_name}/${name}`;
  return value.assets.some(
    (a) => a.name === name && a.browser_download_url === url,
  )
    ? { version, url }
    : null;
}
export async function latestWindowsDownload(): Promise<WindowsDownload | null> {
  const response = await fetch(
    "https://api.github.com/repos/arnaudlegoatdesdev/notes/releases/latest",
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
      credentials: "omit",
    },
  );
  if (!response.ok) return null;
  return windowsAsset(await response.json());
}

export type DesktopPlatform = "windows" | "macos";
export interface DesktopDownload extends WindowsDownload {
  platform: DesktopPlatform;
}
export function desktopPlatform(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
  native: boolean,
): DesktopPlatform | null {
  if (isWindowsBrowser(nav, native)) return "windows";
  if (
    !native &&
    /Mac/i.test(nav.platform) &&
    /Macintosh|Mac OS X/i.test(nav.userAgent) &&
    !/iPhone|iPad|iPod|Android|Mobile/i.test(nav.userAgent) &&
    nav.maxTouchPoints <= 1
  )
    return "macos";
  return null;
}
export function macAsset(release: unknown): DesktopDownload | null {
  if (!release || typeof release !== "object") return null;
  const value = release as {
    draft?: boolean;
    prerelease?: boolean;
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  if (
    value.draft ||
    value.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(value.tag_name || "") ||
    !Array.isArray(value.assets)
  )
    return null;
  const version = value.tag_name!.slice(1),
    parts = version.split(".").map(Number),
    current = APP_VERSION.split(".").map(Number),
    different = parts.findIndex((n, i) => n !== current[i]);
  if (different >= 0 && parts[different] < current[different]) return null;
  const name = `Notes_${version}_universal.dmg`,
    url = `https://github.com/arnaudlegoatdesdev/notes/releases/download/${value.tag_name}/${name}`;
  return value.assets.some(
    (a) => a.name === name && a.browser_download_url === url,
  )
    ? { platform: "macos", version, url }
    : null;
}
export async function latestDesktopDownload(
  platform: DesktopPlatform,
): Promise<DesktopDownload | null> {
  const response = await fetch(
    "https://api.github.com/repos/arnaudlegoatdesdev/notes/releases/latest",
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
      credentials: "omit",
    },
  );
  if (!response.ok) return null;
  const release: unknown = await response.json();
  if (platform === "macos") return macAsset(release);
  const windows = windowsAsset(release);
  return windows ? { ...windows, platform: "windows" } : null;
}
