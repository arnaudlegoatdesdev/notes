export const APP_VERSION = "0.3.1";
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
