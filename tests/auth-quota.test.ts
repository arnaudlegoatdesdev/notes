import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeGoogle, readGoogleIdentity } from "../src/cloud/google";
import { signInGoogle, assertVaultOwner } from "../src/auth";
import {
  availableCloudBytes,
  validateLimit,
  formatBytes,
  GB,
} from "../src/quota";
import { createData } from "../src/seed";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fakeIdentity() {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "public-test-client");
  let options: { scope: string; callback: (response: unknown) => void };
  const start = vi.fn((o: typeof options) => {
    options = o;
    return {
      requestAccessToken: () =>
        options.callback({
          access_token: "identity-only-token",
          expires_in: 3600,
        }),
    };
  });
  vi.stubGlobal("window", {
    google: { accounts: { oauth2: { initTokenClient: start } } },
  });
  return start;
}
describe("Google identity independent from Drive", () => {
  it("authenticates through Google userinfo without requesting Drive or calling Drive APIs", async () => {
    const start = fakeIdentity();
    const fetcher = vi.fn().mockResolvedValue(
      json({
        sub: "google-person-123",
        email: "person@example.com",
        email_verified: true,
        name: "Person",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await signInGoogle()).toEqual({
      id: "google-person-123",
      email: "person@example.com",
      name: "Person",
    });
    expect(start.mock.calls[0][0].scope).toBe("openid email profile");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://openidconnect.googleapis.com/v1/userinfo",
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer identity-only-token",
    );
  });
  it("asks for appdata only when Drive is explicitly connected", async () => {
    const start = fakeIdentity();
    await authorizeGoogle("public-client", "drive");
    expect(start.mock.calls[0][0].scope).toContain(
      "https://www.googleapis.com/auth/drive.appdata",
    );
  });
  it("rejects unverified or malformed Google accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          sub: "person",
          email: "person@example.com",
          email_verified: false,
        }),
      ),
    );
    await expect(readGoogleIdentity("token")).rejects.toMatchObject({
      code: "auth",
    });
  });
  it("does not trust an access token rejected by Google", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: "invalid_token" }, 401)),
    );
    await expect(readGoogleIdentity("invalid-token")).rejects.toMatchObject({
      code: "auth",
    });
  });
  it("binds a vault to the Google subject while allowing legacy vault migration", () => {
    const data = createData();
    expect(() => assertVaultOwner(data, "person-a")).not.toThrow();
    data.owner = { provider: "google", subject: "person-a" };
    expect(() => assertVaultOwner(data, "person-a")).not.toThrow();
    expect(() => assertVaultOwner(data, "person-b")).toThrow(
      "autre compte Google",
    );
  });
});
describe("real available cloud space", () => {
  it("allows a112GB budget when200GB total minus88GB used is available", () => {
    const max = availableCloudBytes({ total: 200 * GB, used: 88 * GB });
    expect(max).toBe(112 * GB);
    expect(formatBytes(max!)).toBe("112 Go");
    expect(validateLimit(112, max)).toBe(112 * GB);
    expect(() => validateLimit(112.001, max)).toThrow("dépasse");
  });
  it("includes already occupied Notes bytes when changing the total application budget", () => {
    expect(
      availableCloudBytes({ total: 200 * GB, used: 88 * GB }, 4 * GB),
    ).toBe(116 * GB);
  });
  it("distinguishes unknown or unlimited quota from a full account", () => {
    expect(availableCloudBytes(null)).toBeUndefined();
    expect(availableCloudBytes({ used: 0 })).toBeUndefined();
    expect(availableCloudBytes({ total: 15 * GB, used: 15 * GB })).toBe(0);
    expect(() => validateLimit(0.001, 0)).toThrow("dépasse");
  });
  it("rejects invalid provider quotas and unsafe or empty budgets", () => {
    expect(() => availableCloudBytes({ total: NaN, used: 0 })).toThrow(
      "invalide",
    );
    for (const value of [NaN, Infinity, -1, 0, 0.00001])
      expect(() => validateLimit(value)).toThrow();
  });
});
