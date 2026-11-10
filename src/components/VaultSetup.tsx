import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  HardDrive,
  Check,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { connectCloud, type CloudConnection } from "../cloud";
import type { GoogleUser } from "../auth";
import { findHead } from "../sync";
import {
  availableCloudBytes,
  availableDeviceBytes,
  formatBytes,
  GB,
  MIN_VAULT_BYTES,
  validateLimit,
} from "../quota";
export interface VaultOptions {
  password: string;
  limit: number;
  connection: CloudConnection | null;
  open: boolean;
  backup?: File;
}
export default function VaultSetup({
  user,
  busy,
  restoreOnly = false,
  onSubmit,
  onChangeAccount,
}: {
  user: GoogleUser;
  busy: boolean;
  restoreOnly?: boolean;
  onSubmit: (options: VaultOptions) => Promise<void>;
  onChangeAccount?: () => void;
}) {
  const [stage, setStage] = useState<"choice" | "vault">("choice");
  const [storage, setStorage] = useState<"drive" | "local">("drive");
  const [connection, setConnection] = useState<CloudConnection | null>(null);
  const [open, setOpen] = useState(restoreOnly);
  const [maximum, setMaximum] = useState<number | undefined>();
  const [limit, setLimit] = useState("1");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [backup, setBackup] = useState<File>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const waiting = working || busy;
  async function chooseStorage() {
    setError("");
    setWorking(true);
    try {
      let max: number | undefined;
      if (storage === "drive") {
        const conn = await connectCloud("google", user.id);
        const remote = findHead(await conn.list());
        const quota = await conn.quota();
        max = availableCloudBytes(quota);
        if (!remote && max !== undefined && max < MIN_VAULT_BYTES)
          throw new Error(
            "Google Drive est plein. Libérez au moins 1 Mo avant de continuer.",
          );
        if (restoreOnly && !remote)
          throw new Error("Aucun coffre Notes sur ce compte Google Drive.");
        setConnection(conn);
        setOpen(!!remote);
      } else {
        max = await availableDeviceBytes().catch(() => undefined);
        if (max !== undefined && max < MIN_VAULT_BYTES)
          throw new Error("Cet appareil n’a pas assez d’espace disponible.");
        setConnection(null);
        setOpen(false);
      }
      setMaximum(max);
      setLimit(
        String(
          Math.min(
            1,
            max === undefined ? 1 : Math.floor(max / 1_000_000) / 1000,
          ),
        ),
      );
      setStage("vault");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion indisponible.");
    } finally {
      setWorking(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (!open && password !== repeat)
        throw new Error("Les mots de passe sont différents.");
      const limitBytes = open ? GB : validateLimit(Number(limit), maximum);
      await onSubmit({ password, limit: limitBytes, connection, open, backup });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible d’ouvrir le coffre.",
      );
    }
  }
  return (
    <div className="vault-setup">
      {stage === "choice" ? (
        <>
          <h1>
            {restoreOnly ? "Retrouver mon coffre" : "Où garder vos notes ?"}
          </h1>
          <p className="setup-account">{user.email}</p>
          <div className="storage-choices">
            <button
              type="button"
              className={`storage-choice ${storage === "drive" ? "selected" : ""}`}
              onClick={() => setStorage("drive")}
              disabled={waiting}
            >
              <Cloud size={22} />
              <div>
                <strong>
                  Google Drive <span className="recommended">Recommandé</span>
                </strong>
                <span>Vos notes sur ordinateur et téléphone.</span>
              </div>
              {storage === "drive" && <Check size={18} />}
            </button>
            {!restoreOnly && (
              <button
                type="button"
                className={`storage-choice ${storage === "local" ? "selected" : ""}`}
                onClick={() => setStorage("local")}
                disabled={waiting}
              >
                <HardDrive size={22} />
                <div>
                  <strong>Cet appareil uniquement</strong>
                  <span>Aucune synchronisation sur le téléphone.</span>
                </div>
                {storage === "local" && <Check size={18} />}
              </button>
            )}
          </div>
          <button
            className="button primary full"
            disabled={waiting}
            onClick={() => void chooseStorage()}
          >
            {waiting ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowRight size={17} />
            )}
            {storage === "drive"
              ? "Connecter Google Drive"
              : "Continuer en local"}
          </button>
          {restoreOnly && (
            <label className="backup-input">
              Ou importer une sauvegarde
              <input
                type="file"
                accept=".notes,.flion"
                disabled={waiting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setBackup(file);
                    setConnection(null);
                    setOpen(true);
                    setStage("vault");
                  }
                }}
              />
            </label>
          )}
          {onChangeAccount && (
            <button
              className="text-button center"
              disabled={waiting}
              onClick={onChangeAccount}
            >
              Changer de compte
            </button>
          )}
        </>
      ) : (
        <>
          <button
            className="text-button"
            disabled={waiting}
            onClick={() => {
              setStage("choice");
              setBackup(undefined);
              setPassword("");
              setRepeat("");
              setError("");
            }}
          >
            <ArrowLeft size={14} />
            Retour
          </button>
          <h1>{open ? "Ouvrir mon coffre" : "Créer mon coffre"}</h1>
          <p className="setup-account">
            {connection
              ? "Google Drive"
              : backup
                ? "Sauvegarde"
                : "Cet appareil uniquement"}
          </p>
          <form onSubmit={(event) => void submit(event)}>
            {!open && (
              <>
                <label htmlFor="setup-limit">Espace maximum pour Notes</label>
                <div className="limit-input">
                  <input
                    id="setup-limit"
                    type="number"
                    min="0.001"
                    max={
                      maximum === undefined
                        ? undefined
                        : Math.floor(maximum / 1_000_000) / 1000
                    }
                    step="0.001"
                    required
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    disabled={waiting}
                  />
                  <span>Go</span>
                </div>
                <p className="field-note">
                  {maximum === undefined
                    ? "Limite modifiable dans les paramètres."
                    : `${formatBytes(maximum)} disponibles ${connection ? "sur Drive" : "sur cet appareil"}.`}
                </p>
              </>
            )}
            <label htmlFor="setup-password">Mot de passe du coffre</label>
            <input
              id="setup-password"
              type="password"
              autoComplete={open ? "current-password" : "new-password"}
              required
              minLength={12}
              maxLength={512}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={waiting}
            />
            {!open && (
              <>
                <label htmlFor="setup-repeat">Confirmer le mot de passe</label>
                <input
                  id="setup-repeat"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  disabled={waiting}
                />
                <p className="field-note">
                  <LockKeyhole size={12} />
                  12 caractères minimum. Ce mot de passe chiffre vos notes et ne
                  peut pas être réinitialisé.
                </p>
              </>
            )}
            <button className="button primary full" disabled={waiting}>
              {waiting ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArrowRight size={17} />
              )}
              {open ? "Ouvrir Notes" : "Commencer"}
            </button>
          </form>
        </>
      )}
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
