import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWebLogin,
  readWebLogin,
  saveWebLogin,
  updateWebCredentials,
} from "../src/session-storage";
import { restoreGoogleSession, signOutGoogle } from "../src/auth";
import { driveGrant, forgetGoogleGrant } from "../src/cloud/google";
import { TokenConnection } from "../src/cloud/http";
const user = {
  id: "session-person",
  email: "private@example.com",
  name: "Person",
};
const credentials = {
  accessToken: "private-google-access-token",
  expiresIn: 3600,
  scope: "openid https://www.googleapis.com/auth/drive.appdata",
};
beforeEach(async () => {
  await clearWebLogin();
  forgetGoogleGrant();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function storedValues(): Promise<unknown[]> {
  const req = indexedDB.open("notes-login-v1");
  const db = await new Promise<IDBDatabase>((resolve) => {
    req.onsuccess = () => resolve(req.result);
  });
  try {
    return await new Promise<unknown[]>((resolve) => {
      const r = db.transaction("session").objectStore("session").getAll();
      r.onsuccess = () => resolve(r.result);
    });
  } finally {
    db.close();
  }
}
describe("persistent browser session", () => {
  it("restores the saved identity and usable Drive grant from encrypted browser storage", async () => {
    await saveWebLogin(user, credentials);
    forgetGoogleGrant();
    expect(await restoreGoogleSession()).toEqual(user);
    expect(driveGrant(user.id)?.accessToken).toBe(credentials.accessToken);
    const values = await storedValues(),
      raw = JSON.stringify(values);
    expect(raw).not.toContain(credentials.accessToken);
    expect(raw).not.toContain(user.email);
    const key = values.find(
      (v) => v && typeof v === "object" && "type" in v,
    ) as CryptoKey;
    expect(key.extractable).toBe(false);
  });
  it("keeps Notes signed in after the Google access token expires, including offline", async () => {
    await saveWebLogin(user, { ...credentials, expiresIn: 1 });
    expect((await readWebLogin())?.credentials).toBeNull();
    expect(await restoreGoogleSession()).toEqual(user);
    expect(driveGrant(user.id)).toBeNull();
  });
  it("clears the remembered account on explicit sign-out and rejects late credential writes", async () => {
    await saveWebLogin(user, credentials);
    await signOutGoogle();
    await updateWebCredentials(user.id, credentials);
    expect(await restoreGoogleSession()).toBeNull();
    expect(driveGrant(user.id)).toBeNull();
  });
  it("does not let a different Google account replace saved credentials", async () => {
    await saveWebLogin(user, credentials);
    await updateWebCredentials("another-person", {
      ...credentials,
      accessToken: "wrong-account",
    });
    expect((await readWebLogin())?.credentials?.accessToken).toBe(
      credentials.accessToken,
    );
  });
});
class Connection extends TokenConnection {
  pull() {
    return this.request("https://www.googleapis.com/drive/v3/about");
  }
}
describe("automatic native access-token renewal", () => {
  it("renews an expired token once for concurrent requests without opening a login window", async () => {
    const renew = vi.fn(async () => ({
      accessToken: "fresh-token",
      expiresIn: 3600,
    }));
    const fetcher = vi.fn(async (_url, init: RequestInit) => {
      expect(init.headers).toMatchObject({
        Authorization: "Bearer fresh-token",
      });
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetcher);
    const conn = new Connection("expired", 0, renew);
    await Promise.all([conn.pull(), conn.pull()]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
  });
  it("refreshes once after a provider 401 and never loops indefinitely", async () => {
    const renew = vi.fn(async () => ({
      accessToken: "fresh-token",
      expiresIn: 3600,
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(new Response("{}")),
    );
    await new Connection("old-token", 3600, renew).pull();
    expect(renew).toHaveBeenCalledWith(true);
    vi.unstubAllGlobals();
  });
  it("does not revive a disconnected cloud connection when a renewal finishes late", async () => {
    let resolve!: (v: { accessToken: string; expiresIn: number }) => void;
    const conn = new Connection(
      "expired",
      0,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = conn.pull();
    await conn.disconnect();
    resolve({ accessToken: "too-late", expiresIn: 3600 });
    await expect(pending).rejects.toMatchObject({ code: "auth" });
  });
});
