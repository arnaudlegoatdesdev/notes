import { describe, expect, it } from "vitest";
import { isWindowsBrowser, windowsAsset } from "../src/windows-install";
describe("direct Windows installation offer", () => {
  const windows = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    platform: "Win32",
    maxTouchPoints: 0,
  };
  it("appears only on Windows desktop web, including touch laptops", () => {
    expect(isWindowsBrowser(windows, false)).toBe(true);
    expect(isWindowsBrowser({ ...windows, maxTouchPoints: 10 }, false)).toBe(
      true,
    );
    expect(isWindowsBrowser(windows, true)).toBe(false);
    expect(
      isWindowsBrowser(
        { ...windows, userAgent: "Android Mobile", platform: "Linux" },
        false,
      ),
    ).toBe(false);
    expect(
      isWindowsBrowser(
        { ...windows, userAgent: "Mac OS X", platform: "MacIntel" },
        false,
      ),
    ).toBe(false);
  });
  it("accepts only the current or newer owned installer, never a release page or old version", () => {
    const release = {
      tag_name: "v0.4.0",
      assets: [
        {
          name: "Notes_0.4.0_x64-setup.exe",
          browser_download_url:
            "https://github.com/arnaudlegoatdesdev/notes/releases/download/v0.4.0/Notes_0.4.0_x64-setup.exe",
        },
      ],
    };
    expect(windowsAsset(release)?.url).toMatch(/\.exe$/);
    expect(windowsAsset({ ...release, prerelease: true })).toBeNull();
    expect(windowsAsset({ ...release, tag_name: "v0.2.1" })).toBeNull();
    expect(
      windowsAsset({
        ...release,
        assets: [
          {
            ...release.assets[0],
            browser_download_url: "https://example.com/installer.exe",
          },
        ],
      }),
    ).toBeNull();
  });
});
