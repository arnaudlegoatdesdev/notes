import { describe, expect, it } from "vitest";
import {
  desktopPlatform,
  macAsset,
  windowsAsset,
} from "../src/windows-install";
describe("platform-specific direct downloads", () => {
  const mac = {
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    maxTouchPoints: 0,
  };
  it("detects Intel and Apple Silicon Macs while excluding iPads and native apps", () => {
    expect(desktopPlatform(mac, false)).toBe("macos");
    expect(desktopPlatform({ ...mac, platform: "MacARM" }, false)).toBe(
      "macos",
    );
    expect(desktopPlatform({ ...mac, maxTouchPoints: 5 }, false)).toBeNull();
    expect(
      desktopPlatform(
        { ...mac, userAgent: "iPhone Mobile", platform: "iPhone" },
        false,
      ),
    ).toBeNull();
    expect(desktopPlatform(mac, true)).toBeNull();
    expect(
      desktopPlatform(
        { platform: "Win32", userAgent: "Windows NT 10.0", maxTouchPoints: 0 },
        false,
      ),
    ).toBe("windows");
  });
  it("selects the Mac universal DMG and preserves the existing Windows installer", () => {
    const root =
      "https://github.com/arnaudlegoatdesdev/notes/releases/download/v0.3.2/";
    const release = {
      tag_name: "v0.3.2",
      assets: [
        {
          name: "Notes_0.3.2_universal.dmg",
          browser_download_url: root + "Notes_0.3.2_universal.dmg",
        },
        {
          name: "Notes_0.3.2_x64-setup.exe",
          browser_download_url: root + "Notes_0.3.2_x64-setup.exe",
        },
      ],
    };
    expect(macAsset(release)).toMatchObject({
      platform: "macos",
      url: root + "Notes_0.3.2_universal.dmg",
    });
    expect(windowsAsset(release)?.url).toBe(root + "Notes_0.3.2_x64-setup.exe");
    expect(macAsset({ ...release, draft: true })).toBeNull();
    expect(
      macAsset({
        ...release,
        assets: [
          {
            name: "Notes_0.3.2_universal.dmg",
            browser_download_url: "https://example.com/fake.dmg",
          },
        ],
      }),
    ).toBeNull();
  });
});
