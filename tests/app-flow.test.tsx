// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { runInThisContext } from "node:vm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App from "../src/App";
import { clearLocalVault, createVault, unlockVault } from "../src/core/vault";
import { createData } from "../src/seed";
import { selectVaultAccount } from "../src/core/vault";
import { selectSyncAccount } from "../src/sync-state";
import { signInGoogle } from "../src/auth";
import { connectCloud } from "../src/cloud";
import { driveGrant } from "../src/cloud/google";
import {
  makeAccess,
  keyBytes,
  rememberStorage,
  saveAccess,
  publishAccess,
} from "../src/access";
import { syncVault, writeSyncState } from "../src/sync-v2";
const user = {
  id: "google-flow-person",
  name: "Test",
  email: "test@example.com",
};
vi.mock("../src/auth", async (original) => ({
  ...(await original<object>()),
  signInGoogle: vi.fn(async () => ({
    id: "google-flow-person",
    name: "Test",
    email: "test@example.com",
  })),
}));
vi.mock("../src/cloud", async (original) => ({
  ...(await original<object>()),
  cloudConfigured: () => true,
  connectCloud: vi.fn(),
}));
vi.mock("../src/cloud/google", async (original) => ({
  ...(await original<object>()),
  driveGrant: vi.fn(() => null),
  forgetGoogleGrant: vi.fn(),
}));
vi.mock("../src/desktop", () => ({
  isDesktop: false,
  checkForUpdate: vi.fn(async () => null),
}));
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Uint8Array", runInThisContext("Uint8Array"));
  selectVaultAccount(user.id);
  selectSyncAccount(user.id);
  await clearLocalVault();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(driveGrant).mockReturnValue(null);
  vi.mocked(connectCloud).mockReset();
  vi.mocked(signInGoogle).mockResolvedValue(user);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function login() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Continuer avec Google" }),
  );
}
describe("Notes account and empty workspace flow", () => {
  it("starts without channels or password, supports deleting the last channel, and reopens through Google", async () => {
    render(<App />);
    await login();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Stockage local Aucune synchronisation/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer en local" }));
    fireEvent.click(await screen.findByRole("button", { name: "Commencer" }));
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    expect(screen.queryByText("Sur cet appareil")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Créer un salon" })[1],
    );
    fireEvent.change(screen.getByLabelText("Nom du salon"), {
      target: { value: "Personnel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer le salon" }));
    await screen.findByRole("textbox", { name: "Écrire dans Personnel" });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Écrire dans Personnel" }),
      { target: { value: "Ma note" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le message" }));
    await screen.findByText("Ma note");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Ajouter un fichier",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Modifier le salon" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    cleanup();
    render(<App />);
    await login();
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    expect(connectCloud).not.toHaveBeenCalled();
  });
  it("opens Drive automatically on a fresh phone after a previous grant, without asking storage again", async () => {
    const data = createData();
    data.owner = { provider: "google", subject: user.id };
    const record = makeAccess(user.id, data.id);
    await saveAccess(record);
    const objects = new Map<string, { name: string; bytes: Uint8Array }>();
    const conn = {
      provider: "google" as const,
      account: user.email,
      list: async () =>
        [...objects].map(([id, f]) => ({
          id,
          name: f.name,
          size: f.bytes.byteLength,
        })),
      read: async (id: string) => objects.get(id)!.bytes.slice(),
      create: async (name: string, bytes: Uint8Array) => {
        const id = crypto.randomUUID();
        objects.set(id, { name, bytes });
        return { id, name, size: bytes.byteLength };
      },
      quota: async () => ({ total: 15e9, used: 0 }),
      disconnect: async () => {},
    };
    const session = await createVault(keyBytes(record), data);
    await publishAccess(conn, record);
    await syncVault(conn, session, keyBytes(record), user.id);
    session.lock();
    await clearLocalVault();
    writeSyncState(null);
    vi.mocked(driveGrant).mockReturnValue({
      accessToken: "already-granted",
      expiresIn: 3600,
    });
    vi.mocked(connectCloud).mockResolvedValue(conn);
    render(<App />);
    await login();
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    expect(
      screen.queryByRole("heading", { name: "Où garder vos notes ?" }),
    ).toBeNull();
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    await waitFor(() =>
      expect(localStorage.getItem(`notes.storage.${user.id}`)).toBe("drive"),
    );
  });
  it("opens a different Google account in a separate local workspace", async () => {
    const first = createData();
    first.owner = { provider: "google", subject: user.id };
    first.channels.push({
      id: crypto.randomUUID(),
      name: "Compte A",
      description: "",
      icon: "hash",
    });
    const a = makeAccess(user.id, first.id);
    await saveAccess(a);
    await createVault(keyBytes(a), first);
    rememberStorage(user.id, "local");
    const secondUser = {
      ...user,
      id: "different-google-person",
      email: "b@example.com",
    };
    selectVaultAccount(secondUser.id);
    await clearLocalVault();
    selectVaultAccount(user.id);
    vi.mocked(signInGoogle).mockResolvedValue(secondUser);
    render(<App />);
    await login();
    await screen.findByRole("heading", { name: "Où garder vos notes ?" });
    expect(screen.queryByText("Compte A")).toBeNull();
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Stockage local Aucune synchronisation/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer en local" }));
    fireEvent.click(await screen.findByRole("button", { name: "Commencer" }));
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    cleanup();
    vi.mocked(signInGoogle).mockResolvedValue(user);
    render(<App />);
    await login();
    await screen.findByRole("heading", { name: "Compte A", level: 1 });
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
  });
  it("ignores obsolete test storage and never asks for an old password", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("flion-vault-v1", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("state");
      };
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(
          {
            revision: crypto.randomUUID(),
            manifest: new Uint8Array([1, 2, 3]),
          },
          "vault",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    render(<App />);
    await login();
    await screen.findByRole("heading", { name: "Où garder vos notes ?" });
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Stockage local Aucune synchronisation/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer en local" }));
    fireEvent.click(await screen.findByRole("button", { name: "Commencer" }));
    await screen.findByRole("heading", { name: "Créez votre premier salon" });
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
  });
});
