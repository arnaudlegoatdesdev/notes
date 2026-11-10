import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  HardDrive,
  Check,
  LoaderCircle,
} from "lucide-react";
import { connectCloud, type CloudConnection } from "../cloud";
import type { GoogleUser } from "../auth";
import type { AccessRecord } from "../core/types";
import { readCloudAccess } from "../access";
import { unpackBundle } from "../archive";
import GoogleDriveIcon from "./GoogleDriveIcon";
import {
  availableCloudBytes,
  availableDeviceBytes,
  formatBytes,
  GB,
  MIN_VAULT_BYTES,
  validateLimit,
} from "../quota";
export interface VaultOptions {
  access?: AccessRecord;
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
  const [stage, setStage] = useState<"choice" | "limit">("choice");
  const [storage, setStorage] = useState<"drive" | "local">("drive");
  const [connection, setConnection] = useState<CloudConnection | null>(null);
  const [maximum, setMaximum] = useState<number | undefined>();
  const [limit, setLimit] = useState("1");
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const waiting = busy || working;
  async function chooseStorage() {
    setError("");
    setWorking(true);
    try {
      let max: number | undefined;
      if (storage === "drive") {
        const conn = await connectCloud("google", user.id),
          files = await conn.list();
        const access = await readCloudAccess(conn, user.id, files);
        setConnection(conn);
        if (access) {
          await onSubmit({ access, connection: conn, open: true, limit: GB });
          return;
        }
        if (restoreOnly)
          throw new Error("Aucune note sur ce compte Google Drive.");
        max = availableCloudBytes(await conn.quota());
        if (max !== undefined && max < MIN_VAULT_BYTES)
          throw new Error(
            "Google Drive est plein. Libérez au moins 1 Mo avant de continuer.",
          );
      } else {
        setConnection(null);
        max = await availableDeviceBytes().catch(() => undefined);
        if (max !== undefined && max < MIN_VAULT_BYTES)
          throw new Error("Cet appareil n’a pas assez d’espace disponible.");
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
      setStage("limit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion indisponible.");
    } finally {
      setWorking(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      await onSubmit({
        connection,
        limit: validateLimit(Number(limit), maximum),
        open: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’ouvrir Notes.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="vault-setup">
      {stage === "choice" ? (
        <>
          <h1>
            {restoreOnly ? "Retrouver mes notes" : "Où garder vos notes ?"}
          </h1>
          <p className="setup-account">{user.email}</p>
          <div className="storage-choices">
            <button
              type="button"
              className={`storage-choice ${storage === "drive" ? "selected" : ""}`}
              onClick={() => setStorage("drive")}
              disabled={waiting}
            >
              <GoogleDriveIcon />
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
                <HardDrive size={24} />
                <div>
                  <strong>Stockage local</strong>
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
                  if (!file) return;
                  setWorking(true);
                  setError("");
                  void unpackBundle(file)
                    .then(async (bundle) => {
                      if (bundle.access)
                        await onSubmit({
                          access: bundle.access,
                          connection: null,
                          open: true,
                          backup: file,
                          limit: GB,
                        });
                      else
                        throw new Error(
                          "Cette sauvegarde n’est pas compatible avec Notes.",
                        );
                    })
                    .catch((e) =>
                      setError(
                        e instanceof Error ? e.message : "Sauvegarde invalide.",
                      ),
                    )
                    .finally(() => setWorking(false));
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
              setError("");
            }}
          >
            <ArrowLeft size={14} />
            Retour
          </button>
          <h1>Votre espace de stockage</h1>
          <form onSubmit={(event) => void submit(event)}>
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
                : `${formatBytes(maximum)} disponibles ${connection ? "sur Drive" : "en local"}.`}
            </p>
            <button className="button primary full" disabled={waiting}>
              {waiting ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArrowRight size={17} />
              )}
              Commencer
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
