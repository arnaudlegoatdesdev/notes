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
import { clearLocalVault, createVault, unlockVault, localManifest, inspectManifest } from "../src/core/vault";
import { createData } from "../src/seed";
import { selectVaultAccount } from "../src/core/vault";
import { selectSyncAccount } from "../src/sync-state";
import { signInGoogle, restoreGoogleSession, signOutGoogle } from "../src/auth";
import { connectCloud } from "../src/cloud";
import { driveGrant } from "../src/cloud/google";
import {
  makeAccess,
  keyBytes,
  rememberStorage,
  saveAccess,
  publishAccess,
} from "../src/access";
import { syncVault, writeSyncState, readSyncState } from "../src/sync-v2";
const user = {
  id: "google-flow-person",
  name: "Test",
  email: "test@example.com",
};
vi.mock("../src/auth", async (original) => ({
  ...(await original<object>()),
  restoreGoogleSession: vi.fn(async () => null),
  signOutGoogle: vi.fn(async () => {}),
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
  vi.mocked(restoreGoogleSession).mockResolvedValue(null);
  vi.mocked(signOutGoogle).mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function login() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Continuer avec Google" }),
  );
}
describe("Notes account and empty workspace flow", () => {
  it("sends dropped files immediately without consuming the draft and shows the Google picture", async () => {
    const initial = createData(); initial.owner = {provider:"google",subject:user.id};
    initial.channels.push({id:crypto.randomUUID(),spaceId:initial.id,name:"Personnel",description:"",icon:"hash"});
    const record = makeAccess(user.id, initial.id); await saveAccess(record); await createVault(keyBytes(record), initial);
    rememberStorage(user.id, "local");
    const picture = "https://lh3.googleusercontent.com/a/test-photo";
    vi.mocked(restoreGoogleSession).mockResolvedValue({...user, name:"Sophie Martin", picture});
    const {container} = render(<App/>);
    const composer = await screen.findByRole("textbox",{name:"Écrire dans Personnel"});
    await waitFor(() => expect((screen.getByRole("button",{name:"Ajouter un fichier"}) as HTMLButtonElement).disabled).toBe(false));
    expect(container.querySelector('.user-card .profile-picture')?.getAttribute('src')).toBe(picture);
    expect(container.querySelector('.profile-mini .profile-picture')?.getAttribute('src')).toBe(picture);
    fireEvent.change(composer,{target:{value:"Mon brouillon reste ici"}});
    const makeFile = (text: string, name: string) => {
      const file = new File([text],name,{type:"text/plain"});
      Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(text).buffer}); return file;
    };
    const files = [makeFile("premier","premier.txt"),makeFile("second","second.txt")];
    const transfer = {types:["Files"],files,items:[],dropEffect:"none"};
    const conversation = screen.getByRole("region",{name:"Messages"});
    fireEvent.dragEnter(conversation,{dataTransfer:transfer});
    expect(screen.getByText("Relâchez vos fichiers")).toBeTruthy();
    fireEvent.drop(conversation,{dataTransfer:transfer});
    await waitFor(async () => {
      const saved = await inspectManifest(keyBytes(record),(await localManifest())!);
      expect(saved.messages).toHaveLength(1);
      expect(saved.messages[0].attachments.map(a=>a.name)).toEqual(["premier.txt","second.txt"]);
    });
    expect((composer as HTMLTextAreaElement).value).toBe("Mon brouillon reste ici");
    expect(screen.queryByText("Relâchez vos fichiers")).toBeNull();
    expect(container.querySelector('.message-avatar .profile-picture')?.getAttribute('src')).toBe(picture);
    const oversized = makeFile("small","gros.bin"); Object.defineProperty(oversized,"size",{value:26*1024**2});
    await waitFor(() => expect((screen.getByRole("button",{name:"Ajouter un fichier"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.drop(conversation,{dataTransfer:{...transfer,files:[oversized]}});
    await screen.findByText("25 Mio maximum par fichier.");
    expect((await inspectManifest(keyBytes(record),(await localManifest())!)).messages).toHaveLength(1);
    fireEvent.drop(document.body,{dataTransfer:transfer});
    expect((await inspectManifest(keyBytes(record),(await localManifest())!)).messages).toHaveLength(1);
  });
  it("still warns about unsent Drive changes when its Google authorization must be renewed", async () => {
    const data = createData();
    data.owner = {provider: "google", subject: user.id};
    const record = makeAccess(user.id, data.id);
    await saveAccess(record);
    await createVault(keyBytes(record), data);
    rememberStorage(user.id, "drive");
    writeSyncState({provider: "google", head: null, dirty: true});
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    render(<App />);
    await screen.findByText("Reconnectez Google Drive pour reprendre la synchronisation.");
    const event = new Event("beforeunload", {cancelable: true});
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(connectCloud).not.toHaveBeenCalled();
  });
  it("keeps sending, editing, pinning and deleting responsive while Drive is stalled", async () => {
    const data = createData();
    data.owner = {provider: "google", subject: user.id};
    const channelId = crypto.randomUUID();
    data.channels.push({id: channelId, spaceId: data.id, name: "Personnel", description: "", icon: "hash"});
    const record = makeAccess(user.id, data.id);
    await saveAccess(record);
    const session = await createVault(keyBytes(record), data);
    const objects = new Map<string, {name: string; bytes: Uint8Array}>();
    let pause = false, entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(r => {entered = r;}), gate = new Promise<void>(r => {release = r;});
    const conn = {
      provider: "google" as const, account: user.email,
      list: async () => [...objects].map(([id, f]) => ({id, name: f.name, size: f.bytes.byteLength})),
      read: async (id: string) => objects.get(id)!.bytes.slice(),
      create: async (name: string, bytes: Uint8Array) => {
        if (pause && name.startsWith("n-")) {entered(); await gate;}
        const id = crypto.randomUUID(); objects.set(id, {name, bytes: bytes.slice()}); return {id, name, size: bytes.byteLength};
      },
      quota: async () => ({total: 15e9, used: 0}), disconnect: async () => {},
    };
    await publishAccess(conn, record);
    await syncVault(conn, session, keyBytes(record), user.id);
    session.lock();
    rememberStorage(user.id, "drive");
    vi.mocked(driveGrant).mockReturnValue({accessToken: "already-granted", expiresIn: 3600});
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    vi.mocked(connectCloud).mockResolvedValue(conn);
    const {container} = render(<App />);
    fireEvent.click(await screen.findByRole("button", {name: "Envoi en attente"}));
    await screen.findByRole("button", {name: "À jour sur le cloud"}, {timeout: 3000});
    const send = (text: string) => {
      fireEvent.change(screen.getByRole("textbox", {name: "Écrire dans Personnel"}), {target: {value: text}});
      fireEvent.click(screen.getByRole("button", {name: "Envoyer le message"}));
    };
    pause = true;
    send("Premier message");
    fireEvent.click(await screen.findByRole("button", {name: "Envoi en attente"}));
    await waiting;
    try {
      send("Deuxième message");
      send("Troisième message");
      expect(screen.getByText("Deuxième message")).toBeTruthy();
      expect(screen.getByText("Troisième message")).toBeTruthy();
      expect((screen.getByRole("button", {name: "Ajouter un fichier"}) as HTMLButtonElement).disabled).toBe(false);
      const second = screen.getByText("Deuxième message").closest("article")!;
      fireEvent.click(second.querySelector('button[aria-label="Modifier le message"]')!);
      fireEvent.change(screen.getByRole("textbox", {name: "Modifier le message"}), {target: {value: "Message corrigé"}});
      fireEvent.click(screen.getByRole("button", {name: "Enregistrer"}));
      expect(screen.getByText("Message corrigé")).toBeTruthy();
      const corrected = screen.getByText("Message corrigé").closest("article")!;
      fireEvent.click(corrected.querySelector('button[aria-label="Épingler le message"]')!);
      fireEvent.click(screen.getByText("Premier message").closest("article")!.querySelector('button[aria-label="Supprimer le message"]')!);
      fireEvent.click(screen.getByRole("button", {name: "Confirmer"}));
      expect(screen.queryByText("Premier message")).toBeNull();
      // Wait for the independent local queue, without releasing the network.
      await waitFor(async () => {
        const local = await inspectManifest(keyBytes(record), (await localManifest())!);
        expect(local.messages.map(m => m.text)).toEqual(["Message corrigé", "Troisième message"]);
        expect(local.messages[0].pinned).toBe(true);
      });
      const leaving = new Event("beforeunload", {cancelable: true});
      window.dispatchEvent(leaving);
      expect(leaving.defaultPrevented).toBe(true);
      expect(container.querySelector(".composer textarea")?.textContent).toBe("");
    } finally { pause = false; release(); }
    await screen.findByRole("button", {name: "Envoi en attente"});
    fireEvent.click(screen.getByRole("button", {name: "Envoi en attente"}));
    await screen.findByRole("button", {name: "À jour sur le cloud"});
    expect(readSyncState()?.dirty).toBe(false);
    const leaving = new Event("beforeunload", {cancelable: true});
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });
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
  it("separates spaces, search and drafts, moves channels, and saves Onyx across restarts", async () => {
    const initial = createData();
    initial.owner = {provider: "google", subject: user.id};
    initial.channels.push({id: crypto.randomUUID(), spaceId: initial.id, name: "Personnel", description: "", icon: "hash"});
    initial.messages.push({id: crypto.randomUUID(), channelId: initial.channels[0].id, text: "Une note privée", createdAt: new Date().toISOString(), attachments: [], pinned: false});
    const record = makeAccess(user.id, initial.id);
    await saveAccess(record);
    await createVault(keyBytes(record), initial);
    rememberStorage(user.id, "local");
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    render(<App />);
    await screen.findByRole("heading", {name: "Personnel", level: 1});
    fireEvent.change(screen.getByRole("textbox", {name: "Écrire dans Personnel"}), {target: {value: "Brouillon personnel"}});
    fireEvent.click(screen.getByRole("button", {name: "Créer un espace"}));
    fireEvent.change(screen.getByLabelText("Nom de l’espace"), {target: {value: "Travail"}});
    fireEvent.click(screen.getByRole("button", {name: "Créer l’espace"}));
    await screen.findByRole("heading", {name: "Créez votre premier salon"});
    expect(screen.queryByText("Une note privée")).toBeNull();
    fireEvent.change(screen.getByLabelText("Rechercher dans mon espace"), {target: {value: "privée"}});
    expect(screen.queryByText("Une note privée")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Effacer la recherche"}));
    fireEvent.click(screen.getByRole("button", {name: "Ouvrir l’espace Mon espace"}));
    await screen.findByText("Une note privée");
    expect((screen.getByRole("textbox", {name: "Écrire dans Personnel"}) as HTMLTextAreaElement).value).toBe("Brouillon personnel");
    fireEvent.click(screen.getByRole("button", {name: "Modifier le salon"}));
    const selected = screen.getByLabelText("Espace") as HTMLSelectElement;
    fireEvent.change(selected, {target: {value: [...selected.options].find((o) => o.text === "Travail")!.value}});
    fireEvent.click(screen.getByRole("button", {name: "Enregistrer"}));
    await waitFor(() => expect(screen.getByRole("button", {name: "Ouvrir l’espace Travail"}).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByText("Une note privée")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Paramètres"}));
    fireEvent.click(screen.getByRole("button", {name: "Onyx"}));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("onyx"));
    cleanup();
    render(<App />);
    await screen.findByRole("heading", {name: "Créez votre premier salon"});
    fireEvent.click(screen.getByRole("button", {name: "Changer d’espace"}));
    fireEvent.click(screen.getByRole("button", {name: "Modifier l’espace Travail"}));
    fireEvent.change(screen.getByLabelText("Nom de l’espace"), {target: {value: "Projets"}});
    fireEvent.click(screen.getByRole("button", {name: "Illustration heart"}));
    fireEvent.click(screen.getByRole("button", {name: "Enregistrer"}));
    await screen.findByRole("heading", {name: "Personnel", level: 1});
    expect(document.documentElement.dataset.theme).toBe("onyx");
    expect((await unlockVault(keyBytes(record))).data.spaces!.find((s) => s.name === "Projets")?.icon).toBe("heart");
    fireEvent.click(screen.getByRole("button", {name: "Changer d’espace"}));
    fireEvent.click(screen.getByRole("button", {name: "Modifier l’espace Projets"}));
    fireEvent.click(screen.getByRole("button", {name: "Supprimer"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirmer"}));
    await screen.findByRole("heading", {name: "Créez votre premier salon"});
    expect(screen.queryByRole("button", {name: "Ouvrir l’espace Projets"})).toBeNull();
    expect(screen.queryByText("Une note privée")).toBeNull();
  });
  it("compacts consecutive notes while keeping edits, pins, search results and individual deletion intact", async () => {
    const initial = createData();
    initial.owner = {provider: "google", subject: user.id};
    const channelId = crypto.randomUUID();
    initial.channels.push({id: channelId, spaceId: initial.id, name: "Personnel", description: "", icon: "hash"});
    initial.messages = [
      {id: crypto.randomUUID(), channelId, text: "Note première", createdAt: "2026-11-11T12:00:00Z", attachments: [], pinned: false},
      {id: crypto.randomUUID(), channelId, text: "Note suivante", createdAt: "2026-11-11T12:01:00Z", updatedAt: "2026-11-11T12:02:00Z", attachments: [], pinned: true},
      {id: crypto.randomUUID(), channelId, text: "Note après la pause", createdAt: "2026-11-11T12:07:00Z", attachments: [], pinned: false},
    ];
    const record = makeAccess(user.id, initial.id);
    await saveAccess(record);
    await createVault(keyBytes(record), initial);
    rememberStorage(user.id, "local");
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    const {container} = render(<App />);
    await screen.findByText("Note suivante");
    expect(container.querySelectorAll('.message-avatar')).toHaveLength(2);
    const second = screen.getByText("Note suivante").closest('article')!;
    expect(second.classList.contains('message-continuation')).toBe(true);
    expect(second.textContent).toContain('modifié');
    expect(second.textContent).toContain('Épinglé');
    expect(second.querySelector('time')?.dateTime).toBe(initial.messages[1].createdAt);
    fireEvent.change(screen.getByLabelText("Rechercher dans mon espace"), {target: {value: "Note"}});
    expect(container.querySelectorAll('.message-avatar')).toHaveLength(3);
    expect(container.querySelectorAll('.message-continuation')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', {name:'Effacer la recherche'}));
    fireEvent.click(second.querySelector('button[aria-label="Modifier le message"]')!);
    fireEvent.change(screen.getByRole('textbox', {name:'Modifier le message'}), {target: {value:'Note corrigée'}});
    fireEvent.click(screen.getByRole('button', {name:'Enregistrer'}));
    await screen.findByText('Note corrigée');
    await waitFor(() => expect((container.querySelector('.composer .attach-button') as HTMLButtonElement).disabled).toBe(false));
    const corrected = screen.getByText('Note corrigée').closest('article')!;
    const actions = corrected.querySelector('button[aria-label="Actions du message"]')!;
    fireEvent.click(actions);
    expect(actions.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(corrected.querySelector('button[aria-label="Supprimer le message"]')!);
    fireEvent.click(screen.getByRole('button', {name:'Confirmer'}));
    await waitFor(() => expect(screen.queryByText('Note corrigée')).toBeNull());
    expect(screen.getByText('Note première')).toBeTruthy();
    expect(screen.getByText('Note après la pause')).toBeTruthy();
    await waitFor(async () => expect((await inspectManifest(keyBytes(record), (await localManifest())!)).messages).toHaveLength(2));
  });
  it("saves automatically fetched link cards encrypted and reuses them after restarting", async () => {
    const initial = createData();
    initial.owner = {provider: "google", subject: user.id};
    const channelId = crypto.randomUUID();
    initial.channels.push({id:channelId, spaceId:initial.id, name:"Liens",description:"",icon:"bookmark"});
    initial.messages.push({id:crypto.randomUUID(),channelId,text:"https://example.com/article",createdAt:new Date().toISOString(),attachments:[],pinned:false});
    const record = makeAccess(user.id, initial.id);
    await saveAccess(record); await createVault(keyBytes(record), initial); rememberStorage(user.id,"local");
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    const fetcher = vi.fn(async () => new Response('<title>Un document enregistré</title>', {headers:{'Content-Type':'text/html'}}));
    vi.stubGlobal('fetch',fetcher);
    render(<App />);
    await screen.findByRole('link',{name:'Un document enregistré'});
    await waitFor(async () => expect((await unlockVault(keyBytes(record))).data.messages[0].linkPreviews?.[0]?.title).toBe('Un document enregistré'), {timeout:3000});
    const count = fetcher.mock.calls.length;
    cleanup(); render(<App />);
    await screen.findByRole('link',{name:'Un document enregistré'});
    expect(fetcher).toHaveBeenCalledTimes(count);
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
  it("restores the account and notes after restart without opening Google, then honors sign-out", async () => {
    const initial = createData();
    initial.owner = { provider: "google", subject: user.id };
    initial.version = 1;
    delete initial.spaces;
    initial.channels.push({
      id: crypto.randomUUID(),
      name: "Retrouvé",
      description: "",
      icon: "hash",
    });
    const record = makeAccess(user.id, initial.id);
    await saveAccess(record);
    await createVault(keyBytes(record), initial);
    rememberStorage(user.id, "local");
    vi.mocked(signInGoogle).mockClear();
    vi.mocked(restoreGoogleSession).mockResolvedValue(user);
    render(<App />);
    await screen.findByRole("heading", { name: "Retrouvé", level: 1 });
    expect(signInGoogle).not.toHaveBeenCalled();
    expect((await unlockVault(keyBytes(record))).data.version).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Paramètres" }));
    fireEvent.click(screen.getByRole("button", { name: "Déconnexion" }));
    await screen.findByRole("button", { name: "Continuer avec Google" });
    expect(signOutGoogle).toHaveBeenCalledTimes(1);
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
