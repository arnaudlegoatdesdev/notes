import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Hash,
  Bookmark,
  Image,
  FileText,
  Plane,
  Code,
  Heart,
  Plus,
  Settings,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  X,
  Menu,
  LockKeyhole,
  Cloud,
  CloudOff,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
  Pin,
  Download,
  Paperclip,
  FolderOpen,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  HardDrive,
  Sun,
  Moon,
  LogOut,
  LoaderCircle,
  ShieldCheck,
  MessageSquare,
  ArrowRight,
  CheckCheck,
  Upload,
  Palette,
  Bell,
  Link as LinkIcon,
} from "lucide-react";
import type {
  Attachment,
  Channel,
  IconName,
  Message,
  Preferences,
  Provider,
  Theme,
  VaultData,
} from "./core/types";
import {
  createVault,
  unlockVault,
  hasVault,
  importVault,
  clearLocalVault,
  type VaultSession,
  inspectManifest,
} from "./core/vault";
import {
  CloudError,
  connectCloud,
  cloudConfigured,
  type CloudConnection,
  type CloudQuota,
} from "./cloud";
import {
  findHead,
  markDirty,
  openCloudVault,
  readSyncState,
  syncVault,
  writeSyncState,
} from "./sync";
import { packSession, unpackBundle } from "./archive";
import { createData } from "./seed";
import { isDesktop, checkForUpdate } from "./desktop";
import AttachmentImage from "./components/AttachmentImage";
import ImageViewer from "./components/ImageViewer";
import VaultSetup, { type VaultOptions } from "./components/VaultSetup";
import GoogleMark from "./components/GoogleMark";
import { signInGoogle, assertVaultOwner, type GoogleUser } from "./auth";
import { availableCloudBytes, formatBytes, validateLimit, GB } from "./quota";

const icons = {
  hash: Hash,
  bookmark: Bookmark,
  image: Image,
  file: FileText,
  plane: Plane,
  code: Code,
  heart: Heart,
};
const bytes = formatBytes;
const time = (at: string) =>
  new Date(at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (at: string) => {
  const date = new Date(at),
    now = new Date();
  return date.toDateString() === now.toDateString()
    ? "Aujourd’hui"
    : date.toDateString() === new Date(now.getTime() - 86400000).toDateString()
      ? "Hier"
      : date.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
};
const themes: { id: Theme; name: string; color: string; bg: string }[] = [
  { id: "slate", name: "Ardoise", color: "#b5c5a7", bg: "#202227" },
  { id: "light", name: "Clair", color: "#526849", bg: "#f7f7f4" },
  { id: "forest", name: "Forêt", color: "#b2caa3", bg: "#17241f" },
  { id: "sand", name: "Sable", color: "#896b43", bg: "#efe7dc" },
  { id: "plum", name: "Prune", color: "#d6b9de", bg: "#28212e" },
];
function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brandmark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M7 25V7h5l8 11V7h5v18h-5l-8-11v11z" fill="currentColor" />
      </svg>
    </span>
  );
}
function ProviderIcon({ provider: _provider }: { provider: Provider }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8.2 2 4 7-6.4 11H.5z" fill="#2f9e60" />
      <path d="m8.2 2 7.6 0L23.5 15h-8z" fill="#f4c34f" />
      <path d="M23.5 15 19.7 22H4.3l3.9-7z" fill="#5c8fdf" />
    </svg>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const t = setTimeout(
      () =>
        box.current
          ?.querySelector<HTMLElement>("input,button,select,textarea")
          ?.focus(),
      0,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = box.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select,textarea,a[href]",
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener">
            {part}
            <ExternalLink size={12} />
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export default function App() {
  const [data, setData] = useState<VaultData>(createData);
  const [mode, setMode] = useState<
    "login" | "setup" | "vault" | "locked" | "loading"
  >("loading");
  const session = useRef<VaultSession | null>(null);
  const password = useRef("");
  const [identity, setIdentity] = useState<GoogleUser | null>(null);
  const [active, setActive] = useState("");
  const [view, setView] = useState<"messages" | "files" | "pins">("messages");
  const [drawer, setDrawer] = useState(false),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState("");
  const [queued, setQueued] = useState<Attachment[]>([]);
  const [used, setUsed] = useState(0),
    [cloudBytes, setCloudBytes] = useState(0),
    [quota, setQuota] = useState<CloudQuota | null>(null);
  const [connection, setConnection] = useState<CloudConnection | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    "local" | "pending" | "syncing" | "synced" | "error"
  >("local");
  const [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [modal, setModal] = useState<
    "onboarding" | "settings" | "channel" | "connect" | "import" | null
  >(null);
  const [channelEdit, setChannelEdit] = useState<Channel | null>(null),
    [confirm, setConfirm] = useState<{
      text: string;
      action: () => void;
    } | null>(null);
  const [editing, setEditing] = useState<string | null>(null),
    [editText, setEditText] = useState(""),
    [menu, setMenu] = useState<string | null>(null);
  const [update, setUpdate] = useState<{
    version: string;
    install: () => Promise<void>;
  } | null>(null);
  const updateChecked = useRef(false);
  useEffect(() => {
    if (isDesktop && !updateChecked.current) {
      updateChecked.current = true;
      void checkForUpdate()
        .then(setUpdate)
        .catch(() => undefined);
    }
  }, []);
  const [gallery, setGallery] = useState<{ url: string; name: string } | null>(
    null,
  );
  const end = useRef<HTMLDivElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    input = useRef<HTMLInputElement>(null);
  const syncBlock = useRef(false);
  syncBlock.current = !!(modal || confirm || editing || draft || queued.length);
  const syncLock = useRef(false);
  const busyRef = useRef(false);
  const channel =
    data.channels.find((c) => c.id === active) || data.channels[0];
  const ChannelIcon = icons[channel?.icon || "hash"];
  const percent = Math.min(
    100,
    Math.round(
      (Math.max(used, cloudBytes) / data.preferences.limitBytes) * 100,
    ),
  );
  const replaceSession = async (s: VaultSession, pass?: string) => {
    if (!identity) {
      s.lock();
      throw new Error("Connectez-vous avec Google.");
    }
    assertVaultOwner(s.data, identity.id);
    if (session.current && session.current !== s) session.current.lock();
    session.current = s;
    if (pass !== undefined) password.current = pass;
    setData(s.data);
    setUsed(await s.usedBytes());
    setMode("vault");
    setActive(s.data.channels[0]?.id || "");
    setQueued([]);
    setDraft("");
  };
  useEffect(() => {
    let canceled = false;
    hasVault()
      .then(() => {
        if (!canceled) setMode("login");
      })
      .catch(() => {
        if (!canceled) {
          setMode("login");
          setNotice("Le stockage local est indisponible dans ce navigateur.");
        }
      });
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    setActive((a) =>
      data.channels.some((c) => c.id === a) ? a : data.channels[0]?.id || "",
    );
  }, [data.channels]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if (e.key === "Escape") {
        setMenu(null);
        setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    if (!query)
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [data.messages.length, active, query, view]);
  useEffect(() => {
    document.documentElement.dataset.theme = data.preferences.theme;
    document.documentElement.style.fontSize = `${data.preferences.fontSize}px`;
    document.documentElement.dataset.font = data.preferences.font;
  }, [data.preferences]);
  useEffect(() => {
    if (gallery) return () => URL.revokeObjectURL(gallery.url);
  }, [gallery]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current || syncLock.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const commit = async (next: VaultData) => {
    if (!session.current) throw new Error("Le coffre est verrouillé.");
    if (!identity) throw new Error("Connectez-vous avec Google.");
    assertVaultOwner(next, identity.id);
    await session.current.save({
      ...next,
      owner: next.owner || { provider: "google", subject: identity.id },
    });
    markDirty();
    setData(session.current.data);
    setUsed(await session.current.usedBytes());
    setSyncStatus(connection ? "pending" : "local");
  };
  const synchronize = useCallback(
    async (conn = connection) => {
      if (
        !conn ||
        !session.current ||
        syncLock.current ||
        busyRef.current ||
        syncBlock.current
      )
        return;
      syncLock.current = true;
      setSyncStatus("syncing");
      setSyncError("");
      setNeedsReconnect(false);
      try {
        const result = await syncVault(
          conn,
          session.current,
          password.current,
          identity?.id,
        );
        session.current = result.session;
        setData(result.session.data);
        setUsed(await result.session.usedBytes());
        setCloudBytes(result.cloudBytes);
        setQuota(result.quota);
        setSyncStatus("synced");
      } catch (e) {
        setSyncStatus("error");
        setNeedsReconnect(e instanceof CloudError && e.code === "auth");
        setSyncError(
          e instanceof Error ? e.message : "Synchronisation indisponible.",
        );
      } finally {
        syncLock.current = false;
      }
    },
    [connection, identity?.id],
  );
  useEffect(() => {
    if (connection && syncStatus === "pending" && !busy && !syncBlock.current) {
      const t = setTimeout(() => void synchronize(), 1800);
      return () => clearTimeout(t);
    }
  }, [
    connection,
    syncStatus,
    busy,
    data,
    synchronize,
    modal,
    confirm,
    editing,
    draft,
    queued,
  ]);
  useEffect(() => {
    if (!connection) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    const onOnline = () => void synchronize();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void synchronize(), 60000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [connection, synchronize]);
  const lock = () => {
    if (busyRef.current || syncLock.current) {
      setNotice("Attendez la fin de l’opération avant de verrouiller.");
      return;
    }
    session.current?.lock();
    session.current = null;
    password.current = "";
    void connection?.disconnect();
    setConnection(null);
    setData(createData());
    setQueued([]);
    setDraft("");
    setQuery("");
    setEditing(null);
    setModal(null);
    setGallery(null);
    setUsed(0);
    setCloudBytes(0);
    setQuota(null);
    setSyncError("");
    setSyncStatus("local");
    setMode("locked");
  };
  useEffect(() => {
    if (mode !== "vault") return;
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!busyRef.current && !syncLock.current) lock();
        else touch();
      }, 15 * 60000);
    };
    touch();
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [mode, connection]);
  const choose = (id: string) => {
    setActive(id);
    setView("messages");
    setQuery("");
    setDrawer(false);
    setEditing(null);
  };
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    void run(async () => {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 ** 2)
          throw new Error("25 Mio maximum par fichier.");
        if (!session.current) throw new Error("Le coffre est verrouillé.");
        added.push(await session.current.addFile(file));
        const justAdded = added.splice(0);
        setQueued((q) => [...q, ...justAdded]);
      }
      if (session.current) setUsed(await session.current.usedBytes());
      if (input.current) input.current.value = "";
    });
  };
  const removeQueued = (a: Attachment) =>
    void run(async () => {
      if (session.current) await session.current.removeFile(a.id);
      setQueued((q) => q.filter((f) => f.id !== a.id));
      if (session.current) setUsed(await session.current.usedBytes());
    });
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() && !queued.length) return;
    void run(async () => {
      const m: Message = {
        id: crypto.randomUUID(),
        channelId: channel.id,
        text: draft.trim(),
        createdAt: new Date().toISOString(),
        attachments: queued,
        pinned: false,
      };
      await commit({ ...data, messages: [...data.messages, m] });
      setDraft("");
      setQueued([]);
    });
  };
  const removeMessage = (m: Message) =>
    setConfirm({
      text: "Supprimer ce message et ses pièces jointes ?",
      action: () => {
        setConfirm(null);
        void run(async () => {
          const current = session.current?.data || data;
          await commit({
            ...current,
            messages: current.messages.filter((x) => x.id !== m.id),
          });
          for (const a of m.attachments) {
            if (session.current) await session.current.removeFile(a.id);
          }
          if (session.current) setUsed(await session.current.usedBytes());
        });
      },
    });
  const getFile = useCallback(
    async (a: Attachment) => session.current?.readFile(a),
    [],
  );
  const download = (a: Attachment) =>
    void run(async () => {
      const blob = await getFile(a);
      if (!blob) throw new Error("Ce fichier n’est plus disponible.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  const preview = (a: Attachment) =>
    void run(async () => {
      const blob = await getFile(a);
      if (!blob) throw new Error("Fichier indisponible.");
      setGallery({ url: URL.createObjectURL(blob), name: a.name });
    });
  const exportBackup = () =>
    void run(async () => {
      if (!session.current)
        throw new Error("Créez votre coffre pour exporter une sauvegarde.");
      const blob = await packSession(session.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Notes-${new Date().toISOString().slice(0, 10)}.notes`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice("Sauvegarde chiffrée exportée.");
    });
  const changePreferences = (preferences: Preferences) =>
    void run(() => commit({ ...data, preferences }));
  const visible = data.messages.filter(
    (m) =>
      (query ? true : m.channelId === channel?.id) &&
      (view !== "pins" || m.pinned) &&
      (!query ||
        `${m.text} ${m.attachments.map((a) => a.name).join(" ")}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const pinned = data.messages.filter(
    (m) => m.channelId === channel?.id && m.pinned,
  );
  const statusText =
    syncStatus === "syncing"
      ? "Synchronisation"
      : syncStatus === "synced"
        ? "À jour sur le cloud"
        : syncStatus === "pending"
          ? "Envoi en attente"
          : syncStatus === "error"
            ? "À synchroniser"
            : "Sur cet appareil";

  const signOut = () => {
    if (busyRef.current || syncLock.current) return;
    lock();
    setIdentity(null);
    setMode("login");
  };
  const finishSetup = (opts: VaultOptions) =>
    run(async () => {
      if (!identity) throw new Error("Connectez-vous avec Google.");
      let next: VaultSession;
      if (opts.backup) {
        const bundle = await unpackBundle(opts.backup);
        assertVaultOwner(
          await inspectManifest(opts.password, bundle.manifest),
          identity.id,
        );
        next = await importVault(opts.password, bundle);
        writeSyncState(null);
      } else if (opts.open && opts.connection) {
        next = await openCloudVault(
          opts.connection,
          opts.password,
          identity.id,
        );
      } else {
        const initial = createData(opts.limit);
        initial.owner = { provider: "google", subject: identity.id };
        next = await createVault(opts.password, initial);
        writeSyncState(
          opts.connection
            ? { provider: "google", head: null, dirty: true }
            : null,
        );
      }
      await replaceSession(next, opts.password);
      setConnection(opts.connection);
      setModal(null);
      setSyncStatus(opts.connection ? "pending" : "local");
    });
  const setup = (restoreOnly = false) =>
    identity && (
      <VaultSetup
        user={identity}
        busy={busy}
        restoreOnly={restoreOnly}
        onSubmit={finishSetup}
        onChangeAccount={signOut}
      />
    );
  if (mode === "loading")
    return (
      <div className="access-screen">
        <Brand />
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  if (!identity || mode === "login")
    return (
      <div className="access-screen">
        <section className="access-card">
          <div className="brand-title">
            <Brand />
            <span>Notes</span>
          </div>
          <h1>Votre espace personnel.</h1>
          <p>Connectez-vous pour commencer.</p>
          <button
            className="google-login"
            disabled={busy || !cloudConfigured("google")}
            onClick={() =>
              void run(async () => {
                const user = await signInGoogle();
                setIdentity(user);
                setMode((await hasVault()) ? "locked" : "setup");
              })
            }
          >
            {busy ? (
              <LoaderCircle size={19} className="spin" />
            ) : (
              <GoogleMark />
            )}
            Continuer avec Google
          </button>
          <small>Le choix du stockage vient ensuite.</small>
          {!cloudConfigured("google") && (
            <p className="access-error">Connexion Google non configurée.</p>
          )}
        </section>
        {notice && <Toast text={notice} onClose={() => setNotice("")} />}
      </div>
    );
  if (mode === "setup")
    return (
      <div className="access-screen">
        <section className="access-card">
          <div className="brand-title">
            <Brand />
            <span>Notes</span>
          </div>
          {setup()}
        </section>
        {notice && <Toast text={notice} onClose={() => setNotice("")} />}
      </div>
    );
  if (mode === "locked")
    return (
      <div className="access-screen">
        <section className="access-card">
          <div className="brand-title">
            <Brand />
            <span>Notes</span>
          </div>
          <h1>Ouvrir mon coffre</h1>
          <p>{identity.email}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const pass = String(
                new FormData(event.currentTarget).get("password"),
              );
              void run(async () => {
                const next = await unlockVault(pass);
                try {
                  assertVaultOwner(next.data, identity.id);
                  await replaceSession(next, pass);
                  setSyncStatus("local");
                } catch (error) {
                  next.lock();
                  throw error;
                }
              });
            }}
          >
            <label htmlFor="unlock">Mot de passe du coffre</label>
            <input
              id="unlock"
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={12}
              required
              autoFocus
            />
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <LockKeyhole size={16} />
              )}
              Ouvrir Notes
            </button>
          </form>
          <button
            className="text-button center"
            onClick={() => setModal("onboarding")}
          >
            Retrouver mon coffre sur Drive
          </button>
          <button
            className="text-button center"
            disabled={busy}
            onClick={signOut}
          >
            Changer de compte
          </button>
        </section>
        {modal === "onboarding" && (
          <Modal
            title="Retrouver mon coffre"
            onClose={() => {
              if (!busy) setModal(null);
            }}
          >
            {setup(true)}
          </Modal>
        )}
        {notice && <Toast text={notice} onClose={() => setNotice("")} />}
      </div>
    );

  return (
    <div
      className="app-shell"
      style={
        { "--base-size": `${data.preferences.fontSize}px` } as CSSProperties
      }
    >
      <nav className="rail" aria-label="Navigation principale">
        <button
          className="rail-brand"
          title="Notes"
          onClick={() => {
            setView("messages");
            setQuery("");
          }}
        >
          <Brand small />
        </button>
        <span className="rail-divider" />
        <button
          className={`rail-button ${view === "messages" ? "selected" : ""}`}
          title="Mes salons"
          aria-label="Mes salons"
          onClick={() => {
            setView("messages");
            setQuery("");
          }}
        >
          <MessageSquare size={21} />
        </button>
        <button
          className={`rail-button ${view === "files" ? "selected" : ""}`}
          title="Fichiers du salon"
          aria-label="Fichiers du salon"
          onClick={() => setView("files")}
        >
          <FolderOpen size={21} />
        </button>
        <button
          className={`rail-button ${view === "pins" ? "selected" : ""}`}
          title="Messages épinglés"
          aria-label="Messages épinglés"
          onClick={() => setView("pins")}
        >
          <Pin size={20} />
        </button>
        <div className="rail-bottom">
          <button
            className="rail-button"
            title="Paramètres"
            aria-label="Paramètres"
            onClick={() => setModal("settings")}
          >
            <Settings size={21} />
          </button>
          <div className="profile-mini">M</div>
        </div>
      </nav>
      {drawer && (
        <div className="drawer-shade" onClick={() => setDrawer(false)} />
      )}
      <aside className={`sidebar ${drawer ? "open" : ""}`}>
        <header className="workspace">
          <div>
            <strong>Mon espace</strong>
          </div>
          <button
            className="icon-button mobile-close"
            aria-label="Fermer les salons"
            onClick={() => setDrawer(false)}
          >
            <X size={20} />
          </button>
          <LockKeyhole className="desktop-lock" size={16} />
        </header>
        <button
          className="sidebar-search"
          onClick={() => {
            searchInput.current?.focus();
            setDrawer(false);
          }}
        >
          <Search size={15} />
          <span>Rechercher</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="channel-label">
          <span>MES SALONS</span>
          <button
            className="icon-button"
            aria-label="Créer un salon"
            title="Créer un salon"
            onClick={() => {
              setChannelEdit(null);
              setModal("channel");
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="channels">
          {data.channels.map((c) => {
            const Icon = icons[c.icon];
            return (
              <button
                key={c.id}
                className={`channel ${channel?.id === c.id ? "active" : ""}`}
                onClick={() => choose(c.id)}
              >
                <Icon size={18} />
                <span>{c.name}</span>
                {channel?.id === c.id && <span className="active-mark" />}
              </button>
            );
          })}
          <button
            className="add-channel"
            onClick={() => {
              setChannelEdit(null);
              setModal("channel");
            }}
          >
            <Plus size={16} />
            Ajouter un salon
          </button>
        </div>
        <div className="sidebar-bottom">
          {update && (
            <button
              className="update-available"
              onClick={() => setModal("settings")}
            >
              <Download size={15} />
              Version {update.version} disponible
            </button>
          )}
          <div className="storage-card">
            <div className="storage-title">
              <Cloud size={16} />
              <span>Mon stockage</span>
              <span>{percent} %</span>
            </div>
            <div className={`meter ${percent > 90 ? "warning" : ""}`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="storage-numbers">
              <span>
                {bytes(Math.max(used, cloudBytes))} sur{" "}
                {bytes(data.preferences.limitBytes)}
              </span>
              <button
                aria-label="Gérer le stockage"
                title="Gérer le stockage"
                onClick={() => setModal("settings")}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <button className="user-card" onClick={() => setModal("settings")}>
            <div className="avatar">
              M<span />
            </div>
            <div>
              <strong>{identity.name}</strong>
              <span>
                <LockKeyhole size={11} />
                Coffre privé
              </span>
            </div>
            <Settings size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="channel-heading">
            <button
              className="icon-button mobile-menu"
              onClick={() => setDrawer(true)}
              aria-label="Ouvrir les salons"
            >
              <Menu size={22} />
            </button>
            <ChannelIcon size={22} />
            <h1>{query ? "Recherche" : channel?.name}</h1>
            <span className="header-description">{channel?.description}</span>
          </div>
          <div className="header-actions">
            <div className="search-field">
              <Search size={16} />
              <input
                ref={searchInput}
                aria-label="Rechercher dans mon espace"
                placeholder="Rechercher"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Effacer la recherche"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              className={`icon-button ${view === "pins" ? "accent" : ""}`}
              title="Messages épinglés"
              aria-label="Messages épinglés"
              onClick={() => setView(view === "pins" ? "messages" : "pins")}
            >
              <Pin size={18} />
              {pinned.length > 0 && <i className="notification-dot" />}
            </button>
            <button
              className="icon-button"
              title="Modifier le salon"
              aria-label="Modifier le salon"
              onClick={() => {
                setChannelEdit(channel);
                setModal("channel");
              }}
            >
              <MoreHorizontal size={22} />
            </button>
          </div>
        </header>
        {syncError && (
          <div className="sync-error">
            <AlertCircle size={17} />
            <span>{syncError}</span>
            <button
              onClick={() =>
                needsReconnect ? setModal("connect") : void synchronize()
              }
              disabled={busy || syncStatus === "syncing"}
            >
              {needsReconnect ? "Reconnecter" : "Réessayer"}
            </button>
            <button
              className="icon-button"
              aria-label="Masquer l’erreur"
              onClick={() => setSyncError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="subbar">
          <div className="view-tabs">
            <button
              className={view === "messages" ? "active" : ""}
              onClick={() => setView("messages")}
            >
              <MessageSquare size={14} />
              Messages
            </button>
            <button
              className={view === "files" ? "active" : ""}
              onClick={() => setView("files")}
            >
              <Paperclip size={14} />
              Fichiers
              {data.messages
                .filter((m) => m.channelId === channel?.id)
                .reduce((n, m) => n + m.attachments.length, 0) > 0 && (
                <span>
                  {data.messages
                    .filter((m) => m.channelId === channel?.id)
                    .reduce((n, m) => n + m.attachments.length, 0)}
                </span>
              )}
            </button>
            {view === "pins" && (
              <button className="active" onClick={() => setView("pins")}>
                <Pin size={14} />
                Épinglés
              </button>
            )}
          </div>
          <button
            className={`sync-badge ${syncStatus === "error" ? "error" : ""}`}
            onClick={() =>
              connection ? void synchronize() : setModal("connect")
            }
            disabled={busy || syncStatus === "syncing"}
          >
            {syncStatus === "syncing" ? (
              <LoaderCircle size={13} className="spin" />
            ) : syncStatus === "synced" ? (
              <CheckCheck size={14} />
            ) : syncStatus === "error" ? (
              <AlertCircle size={14} />
            ) : (
              <span className="tiny-dot" />
            )}
            {statusText}
          </button>
        </div>
        <section
          className="conversation"
          aria-label={view === "files" ? "Fichiers" : "Messages"}
          onClick={() => menu && setMenu(null)}
        >
          {!query && view === "messages" && (
            <div className="channel-welcome">
              <div className="welcome-icon">
                <ChannelIcon size={32} strokeWidth={1.5} />
              </div>
              <span className="eyebrow">VOTRE ESPACE, À VOTRE FAÇON</span>
              <h2>{channel?.name}</h2>
              <p>{channel?.description}</p>
              <button
                className="text-button"
                onClick={() => {
                  setChannelEdit(channel);
                  setModal("channel");
                }}
              >
                <Pencil size={12} />
                Personnaliser le salon
              </button>
            </div>
          )}
          {query && (
            <div className="results-heading">
              <h2>Résultats pour « {query} »</h2>
              <span>
                {visible.length} message{visible.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {view === "pins" && (
            <div className="results-heading">
              <h2>Messages épinglés</h2>
              <span>{visible.length} dans ce salon</span>
            </div>
          )}
          {view === "files" ? (
            <div className="file-grid">
              {visible.flatMap((m) =>
                m.attachments.map((a) => (
                  <button
                    key={`${m.id}-${a.id}`}
                    className="file-tile"
                    onClick={() =>
                      a.mime.startsWith("image/") ? preview(a) : download(a)
                    }
                    aria-label={
                      a.mime.startsWith("image/")
                        ? `Agrandir ${a.name}`
                        : `Télécharger ${a.name}`
                    }
                  >
                    {a.mime.startsWith("image/") ? (
                      <AttachmentImage attachment={a} load={getFile} tile />
                    ) : (
                      <div className="file-tile-icon">
                        <FileText size={30} />
                      </div>
                    )}
                    <strong>{a.name}</strong>
                    <span>
                      {bytes(a.size)}
                      <Download size={14} />
                    </span>
                  </button>
                )),
              )}
              {!visible.some((m) => m.attachments.length) && (
                <div className="empty-state">
                  <FolderOpen size={34} />
                  <h3>Aucun fichier ici.</h3>
                  <p>Ajoutez une pièce jointe dans un message.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setView("messages");
                      input.current?.click();
                    }}
                  >
                    <Plus size={15} />
                    Ajouter un fichier
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="messages">
              {visible.map((m, index) => {
                const prior = visible[index - 1];
                const separator =
                  !prior || day(prior.createdAt) !== day(m.createdAt);
                return (
                  <div key={m.id}>
                    {separator && (
                      <div className="date-divider">
                        <span>{day(m.createdAt)}</span>
                      </div>
                    )}
                    <article className={`message ${m.pinned ? "pinned" : ""}`}>
                      <div className="message-avatar">M</div>
                      <div className="message-body">
                        <div className="message-meta">
                          <strong>Moi</strong>
                          <time dateTime={m.createdAt}>
                            {time(m.createdAt)}
                          </time>
                          {m.updatedAt && (
                            <span className="edited">modifié</span>
                          )}
                          {m.pinned && (
                            <span className="pin-label">
                              <Pin size={11} />
                              Épinglé
                            </span>
                          )}
                          {query && (
                            <button
                              className="result-channel"
                              onClick={() => choose(m.channelId)}
                            >
                              #
                              {
                                data.channels.find((c) => c.id === m.channelId)
                                  ?.name
                              }
                            </button>
                          )}
                        </div>
                        {editing === m.id ? (
                          <form
                            className="edit-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void run(async () => {
                                await commit({
                                  ...data,
                                  messages: data.messages.map((x) =>
                                    x.id === m.id
                                      ? {
                                          ...x,
                                          text: editText,
                                          updatedAt: new Date().toISOString(),
                                        }
                                      : x,
                                  ),
                                });
                                setEditing(null);
                              });
                            }}
                          >
                            <textarea
                              aria-label="Modifier le message"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              autoFocus
                            />
                            <div>
                              <button
                                className="button secondary small"
                                type="button"
                                onClick={() => setEditing(null)}
                              >
                                Annuler
                              </button>
                              <button
                                className="button primary small"
                                disabled={
                                  busy ||
                                  (!editText.trim() && !m.attachments.length)
                                }
                              >
                                Enregistrer
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="message-text">
                            <Text text={m.text} />
                          </div>
                        )}
                        {m.attachments.length > 0 && (
                          <div className="attachment-list">
                            {m.attachments.map((a) => (
                              <div
                                className={
                                  a.mime.startsWith("image/")
                                    ? "image-attachment"
                                    : "attachment"
                                }
                                key={a.id}
                              >
                                {a.mime.startsWith("image/") ? (
                                  <AttachmentImage
                                    attachment={a}
                                    load={getFile}
                                    onOpen={() => preview(a)}
                                  />
                                ) : (
                                  <FileText size={22} />
                                )}
                                <div className="attachment-details">
                                  <button
                                    className="attachment-name"
                                    onClick={() =>
                                      a.mime.startsWith("image/")
                                        ? preview(a)
                                        : download(a)
                                    }
                                  >
                                    <strong>{a.name}</strong>
                                    <span>{bytes(a.size)}</span>
                                  </button>
                                  <button
                                    className="icon-button"
                                    title="Télécharger"
                                    aria-label={`Télécharger ${a.name}`}
                                    onClick={() => download(a)}
                                  >
                                    <Download size={16} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="message-tools">
                        <button
                          className="icon-button"
                          title="Modifier"
                          aria-label="Modifier le message"
                          onClick={() => {
                            setEditing(m.id);
                            setEditText(m.text);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          title={m.pinned ? "Désépingler" : "Épingler"}
                          aria-label={
                            m.pinned
                              ? "Désépingler le message"
                              : "Épingler le message"
                          }
                          onClick={() =>
                            void run(() =>
                              commit({
                                ...data,
                                messages: data.messages.map((x) =>
                                  x.id === m.id
                                    ? { ...x, pinned: !x.pinned }
                                    : x,
                                ),
                              }),
                            )
                          }
                        >
                          <Pin size={15} />
                        </button>
                        <button
                          className="icon-button danger-hover"
                          title="Supprimer"
                          aria-label="Supprimer le message"
                          onClick={() => removeMessage(m)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  </div>
                );
              })}
              {!visible.length && (
                <div className="empty-state">
                  <MessageSquare size={32} />
                  <h3>
                    {query
                      ? "Rien trouvé."
                      : view === "pins"
                        ? "Rien d’épinglé pour le moment."
                        : "Le début de quelque chose."}
                  </h3>
                  <p>
                    {query
                      ? "Essayez un autre mot."
                      : view === "pins"
                        ? "Gardez les messages utiles à portée de main."
                        : "Écrivez votre première note dans ce salon."}
                  </p>
                </div>
              )}
            </div>
          )}
          <div ref={end} />
        </section>
        <div className="composer-wrap">
          {queued.length > 0 && (
            <div className="queued-files">
              {queued.map((a) => (
                <div key={a.id}>
                  <Paperclip size={13} />
                  <span>{a.name}</span>
                  <button
                    aria-label={`Retirer ${a.name}`}
                    onClick={() => removeQueued(a)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form className="composer" onSubmit={send}>
            <button
              className="attach-button"
              type="button"
              title="Ajouter un fichier"
              aria-label="Ajouter un fichier"
              disabled={busy || syncStatus === "syncing"}
              onClick={() => input.current?.click()}
            >
              <Plus size={21} />
            </button>
            <textarea
              aria-label={`Écrire dans ${channel?.name}`}
              placeholder={`Écrire dans #${channel?.name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={1}
              maxLength={100000}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              className="send-button"
              title="Envoyer"
              aria-label="Envoyer le message"
              disabled={
                busy ||
                syncStatus === "syncing" ||
                (!draft.trim() && !queued.length)
              }
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </form>
          <footer className="composer-footer">
            <span>
              Entrée pour envoyer
              <span className="footer-shift">
                , Maj + Entrée pour une ligne
              </span>
            </span>
          </footer>
        </div>
      </main>
      <input
        ref={input}
        className="hidden"
        type="file"
        multiple
        onChange={(e) => upload(e.target.files)}
      />
      {notice && <Toast text={notice} onClose={() => setNotice("")} />}
      {gallery && (
        <ImageViewer
          url={gallery.url}
          name={gallery.name}
          onClose={() => setGallery(null)}
        />
      )}
      {confirm && (
        <Modal title="Confirmer" onClose={() => setConfirm(null)}>
          <p className="modal-copy">{confirm.text}</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              Annuler
            </button>
            <button className="button danger" onClick={confirm.action}>
              Confirmer
            </button>
          </div>
        </Modal>
      )}
      {modal === "onboarding" && (
        <Modal
          title="Retrouver mon coffre"
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          {setup(true)}
        </Modal>
      )}
      {modal === "channel" && (
        <ChannelForm
          channel={channelEdit}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={(c) =>
            void run(async () => {
              const next = channelEdit
                ? data.channels.map((x) => (x.id === c.id ? c : x))
                : [...data.channels, c];
              await commit({ ...data, channels: next });
              setActive(c.id);
              setModal(null);
              setDrawer(false);
            })
          }
          onDelete={
            channelEdit && data.channels.length > 1
              ? () => {
                  const id = channelEdit.id;
                  setModal(null);
                  setConfirm({
                    text: "Supprimer ce salon et tous ses messages ?",
                    action: () => {
                      setConfirm(null);
                      void run(async () => {
                        const current = session.current?.data || data;
                        const attachments = current.messages
                          .filter((m) => m.channelId === id)
                          .flatMap((m) => m.attachments);
                        await commit({
                          ...current,
                          channels: current.channels.filter((c) => c.id !== id),
                          messages: current.messages.filter(
                            (m) => m.channelId !== id,
                          ),
                        });
                        for (const a of attachments)
                          await session.current?.removeFile(a.id);
                        if (session.current)
                          setUsed(await session.current.usedBytes());
                        setActive(data.channels.find((c) => c.id !== id)!.id);
                      });
                    },
                  });
                }
              : undefined
          }
        />
      )}
      {modal === "connect" && (
        <Modal title="Synchroniser mes notes" onClose={() => setModal(null)}>
          <p className="modal-copy">
            Retrouvez vos notes sur votre téléphone avec Google Drive.
          </p>
          <button
            className="provider-card"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const conn = await connectCloud("google", identity.id);
                const nextQuota = await conn.quota();
                setConnection(conn);
                setQuota(nextQuota);
                setModal(null);
                setSyncStatus("pending");
                if (!readSyncState())
                  writeSyncState({
                    provider: "google",
                    head: null,
                    dirty: true,
                  });
              })
            }
          >
            <ProviderIcon provider="google" />
            <div>
              <strong>Google Drive</strong>
              <span>Activer la synchronisation</span>
            </div>
            <ChevronRight size={18} />
          </button>
        </Modal>
      )}
      {modal === "settings" && (
        <SettingsPanel
          data={data}
          used={used}
          cloudBytes={cloudBytes}
          quota={quota}
          connection={connection}
          busy={busy || syncStatus === "syncing"}
          onClose={() => setModal(null)}
          onPreferences={changePreferences}
          onExport={exportBackup}
          onConnect={() => setModal("connect")}
          onLock={lock}
          onSignOut={signOut}
          onImport={() => {
            setModal(null);
            setConfirm({
              text: "Ouvrir un autre coffre remplacera la copie de cet appareil. Exportez une sauvegarde avant de continuer.",
              action: () => {
                setConfirm(null);
                setModal("onboarding");
              },
            });
          }}
          onDisconnect={() => {
            void connection?.disconnect();
            setConnection(null);
            setSyncStatus("local");
            setQuota(null);
          }}
          onUpdate={() =>
            void run(async () => {
              const result = await checkForUpdate();
              setUpdate(result);
              setNotice(
                result
                  ? `La version ${result.version} est disponible.`
                  : "Vous utilisez la dernière version.",
              );
            })
          }
          update={update}
          onInstall={() =>
            void run(async () => {
              await update?.install();
            })
          }
          onReset={() => {
            setModal(null);
            setConfirm({
              text: "Supprimer la copie de cet appareil ? Exportez une sauvegarde si elle n’est pas synchronisée. Le cloud est conservé.",
              action: () => {
                setConfirm(null);
                void run(async () => {
                  session.current?.lock();
                  session.current = null;
                  password.current = "";
                  await connection?.disconnect();
                  setConnection(null);
                  await clearLocalVault();
                  writeSyncState(null);
                  setData(createData());
                  setMode("setup");
                  setUsed(0);
                  setCloudBytes(0);
                  setQuota(null);
                  setDraft("");
                  setQueued([]);
                });
              },
            });
          }}
        />
      )}
    </div>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="toast" role="status">
      <AlertCircle size={18} />
      <span>{text}</span>
      <button className="icon-button" aria-label="Fermer" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
function ChannelForm({
  channel,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  channel: Channel | null;
  busy: boolean;
  onClose: () => void;
  onSave: (c: Channel) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(channel?.name || ""),
    [description, setDescription] = useState(channel?.description || ""),
    [icon, setIcon] = useState<IconName>(channel?.icon || "hash");
  return (
    <Modal
      title={channel ? "Modifier le salon" : "Nouveau salon"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: channel?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            icon,
          });
        }}
      >
        <label>Icône</label>
        <div className="icon-picker">
          {Object.entries(icons).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              className={icon === key ? "selected" : ""}
              aria-label={`Icône ${key}`}
              onClick={() => setIcon(key as IconName)}
            >
              <Icon size={21} />
            </button>
          ))}
        </div>
        <label htmlFor="channel-name">Nom du salon</label>
        <input
          id="channel-name"
          placeholder="ex. mes idées"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label htmlFor="channel-desc">
          Description <span>facultatif</span>
        </label>
        <input
          id="channel-desc"
          maxLength={120}
          placeholder="À quoi sert ce salon ?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="modal-actions">
          {onDelete && (
            <button
              type="button"
              className="text-button danger-text push-left"
              onClick={onDelete}
            >
              <Trash2 size={15} />
              Supprimer
            </button>
          )}
          <button className="button primary" disabled={busy || !name.trim()}>
            {channel ? "Enregistrer" : "Créer le salon"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsPanel({
  data,
  used,
  cloudBytes,
  quota,
  connection,
  busy,
  onClose,
  onPreferences,
  onExport,
  onConnect,
  onLock,
  onSignOut,
  onImport,
  onDisconnect,
  onUpdate,
  update,
  onInstall,
  onReset,
}: {
  data: VaultData;
  used: number;
  cloudBytes: number;
  quota: CloudQuota | null;
  connection: CloudConnection | null;
  busy: boolean;
  onClose: () => void;
  onPreferences: (p: Preferences) => void;
  onExport: () => void;
  onConnect: () => void;
  onLock: () => void;
  onSignOut: () => void;
  onImport: () => void;
  onDisconnect: () => void;
  onUpdate: () => void;
  update: { version: string } | null;
  onInstall: () => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<"appearance" | "storage" | "about">(
    update ? "about" : "appearance",
  );
  const p = data.preferences;
  const [limitError, setLimitError] = useState("");
  const [limit, setLimit] = useState(
    String(Number((p.limitBytes / GB).toFixed(3))),
  );
  return (
    <Modal title="Paramètres" wide onClose={onClose}>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={tab === "appearance" ? "active" : ""}
            onClick={() => setTab("appearance")}
          >
            <Palette size={16} />
            Apparence
          </button>
          <button
            className={tab === "storage" ? "active" : ""}
            onClick={() => setTab("storage")}
          >
            <Cloud size={16} />
            Stockage
          </button>
          <button
            className={tab === "about" ? "active" : ""}
            onClick={() => setTab("about")}
          >
            <ShieldCheck size={16} />À propos
          </button>
          <button className="lock-setting" onClick={onLock}>
            <LockKeyhole size={16} />
            Verrouiller
          </button>
          <button onClick={onSignOut}>
            <LogOut size={16} />
            Déconnexion
          </button>
        </nav>
        <div className="settings-content">
          {tab === "appearance" && (
            <>
              <h3>À votre goût.</h3>
              <p className="muted">Un espace dans lequel on se sent bien.</p>
              <label>Thème</label>
              <div className="theme-grid">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    className={p.theme === t.id ? "selected" : ""}
                    onClick={() => onPreferences({ ...p, theme: t.id })}
                    disabled={busy}
                  >
                    <span
                      className="theme-preview"
                      style={{ background: t.bg, color: t.color }}
                    >
                      <span />
                      <span />
                      <span />
                      {p.theme === t.id && <Check size={16} />}
                    </span>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
              <label htmlFor="font">Police</label>
              <select
                id="font"
                value={p.font}
                onChange={(e) =>
                  onPreferences({
                    ...p,
                    font: e.target.value as Preferences["font"],
                  })
                }
                disabled={busy}
              >
                <option value="system">Système</option>
                <option value="inter">Sans serif</option>
                <option value="serif">Serif</option>
                <option value="mono">Monospace</option>
              </select>
              <label htmlFor="font-size">
                Taille du texte<span>{p.fontSize} px</span>
              </label>
              <input
                id="font-size"
                className="range"
                type="range"
                min="13"
                max="20"
                step="1"
                value={p.fontSize}
                onChange={(e) =>
                  onPreferences({ ...p, fontSize: Number(e.target.value) })
                }
                disabled={busy}
              />
              <div className="type-preview">
                <strong>Une idée à garder.</strong>
                <span>Les petites notes font les grands souvenirs.</span>
              </div>
            </>
          )}
          {tab === "storage" && (
            <>
              <h3>Votre cloud, vos limites.</h3>
              <p className="muted">Vous gardez la main sur votre espace.</p>
              <div className="settings-storage">
                <Cloud size={22} />
                <div>
                  <strong>{bytes(Math.max(used, cloudBytes))} utilisés</strong>
                  <span>Limite Notes : {bytes(p.limitBytes)}</span>
                </div>
                <strong>
                  {Math.min(
                    100,
                    Math.round(
                      (Math.max(used, cloudBytes) / p.limitBytes) * 100,
                    ),
                  )}{" "}
                  %
                </strong>
              </div>
              <div className="meter">
                <span
                  style={{
                    width: `${Math.min(100, (Math.max(used, cloudBytes) / p.limitBytes) * 100)}%`,
                  }}
                />
              </div>
              <form
                className="limit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    onPreferences({
                      ...p,
                      limitBytes: validateLimit(
                        Number(limit),
                        availableCloudBytes(quota, cloudBytes),
                      ),
                    });
                    setLimitError("");
                  } catch (error) {
                    setLimitError(
                      error instanceof Error
                        ? error.message
                        : "Limite invalide.",
                    );
                  }
                }}
              >
                <label htmlFor="storage-limit">Limite Notes en Go</label>
                <div>
                  <input
                    id="storage-limit"
                    type="number"
                    min="0.001"
                    max={
                      availableCloudBytes(quota, cloudBytes) === undefined
                        ? undefined
                        : Math.floor(
                            availableCloudBytes(quota, cloudBytes)! / 1_000_000,
                          ) / 1000
                    }
                    step="0.001"
                    required
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                  <button className="button secondary" disabled={busy}>
                    Enregistrer
                  </button>
                </div>
              </form>
              {limitError && (
                <p className="access-error" role="alert">
                  {limitError}
                </p>
              )}
              <div className="cloud-account">
                {connection ? (
                  <>
                    <ProviderIcon provider={connection.provider} />
                    <div>
                      <strong>Google Drive</strong>
                      <span>{connection.account}</span>
                    </div>
                    <button className="text-button" onClick={onDisconnect}>
                      Déconnecter
                    </button>
                  </>
                ) : (
                  <>
                    <CloudOff size={22} />
                    <div>
                      <strong>Sur cet appareil</strong>
                      <span>Sans synchronisation sur votre téléphone.</span>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={onConnect}
                      disabled={busy}
                    >
                      Connecter
                    </button>
                  </>
                )}
              </div>
              {connection && (
                <p className="field-note">
                  {quota?.total !== undefined
                    ? `Compte cloud : ${bytes(quota.used)} sur ${bytes(quota.total)} utilisés.`
                    : "Quota global du cloud indisponible avec cette autorisation."}
                </p>
              )}
              <p className="field-note">
                Les versions chiffrées conservées dans le cloud comptent dans la
                limite. Supprimer un message le retire de la version courante.
              </p>
              <div className="settings-buttons">
                <button
                  className="button secondary"
                  onClick={onExport}
                  disabled={busy}
                >
                  <Download size={16} />
                  Exporter une sauvegarde
                </button>
                <button
                  className="text-button"
                  onClick={onImport}
                  disabled={busy}
                >
                  Ouvrir une sauvegarde ou un cloud
                </button>
              </div>
              {
                <button
                  className="text-button danger-text"
                  onClick={onReset}
                  disabled={busy}
                >
                  Supprimer la copie de cet appareil
                </button>
              }
            </>
          )}
          {tab === "about" && (
            <>
              <div className="about-brand">
                <Brand />
                <div>
                  <h3>Notes</h3>
                  <span className="muted">Version 0.2.0</span>
                </div>
              </div>
              <p>
                Un espace personnel pour les notes, les idées et les fichiers
                qu’on veut garder.
              </p>
              <div className="about-features">
                <span>
                  <ShieldCheck size={17} />
                  Chiffrement AES 256 GCM sur l’appareil
                </span>
                <span>
                  <Cloud size={17} />
                  Google Drive ou stockage local
                </span>
                <span>
                  <LockKeyhole size={17} />
                  Aucune base de données utilisateur chez Notes
                </span>
              </div>
              <div className="info-box">
                <span>
                  Projet personnel réalisé rapidement à la demande de plusieurs
                  personnes, avec une aide importante de l’IA. Indépendant de
                  tout travail scolaire et de l’apprentissage de son auteur.
                </span>
              </div>
              <a
                className="button secondary"
                href="https://github.com/arnaudlegoatdesdev/notes"
                target="_blank"
                rel="noreferrer"
              >
                Voir le code sur GitHub
                <ExternalLink size={14} />
              </a>
              {isDesktop && (
                <div className="update-box">
                  <button
                    className="button secondary"
                    onClick={onUpdate}
                    disabled={busy}
                  >
                    <RefreshCw size={15} />
                    Vérifier les mises à jour
                  </button>
                  {update && (
                    <button
                      className="button primary"
                      onClick={onInstall}
                      disabled={busy}
                    >
                      Installer {update.version}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
