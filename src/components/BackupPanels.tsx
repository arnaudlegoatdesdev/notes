import { useState } from "react";
import { requiresBackupPassword, unpackBundle } from "../archive";
import { keyBytes } from "../access";
import { MAX_BACKUP_PASSWORD, MIN_BACKUP_PASSWORD, parseRecipients, randomBackupPassword } from "../backup-protection";
import { inspectManifest } from "../core/vault";
import type { EncryptedBundle } from "../core/types";
import type { GoogleUser } from "../auth";

export interface BackupProtection {
  password: string;
  recipients: string[];
}

export function BackupExport({ busy, onExport }: { busy: boolean; onExport: (protection: BackupProtection) => void }) {
  const [password, setPassword] = useState(randomBackupPassword);
  const [emails, setEmails] = useState("");
  const [error, setError] = useState("");
  return (
    <form className="backup-form" onSubmit={event => {
      event.preventDefault();
      try {
        setError("");
        onExport({ password, recipients: parseRecipients(emails) });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Vérifiez les adresses Google.");
      }
    }}>
      <p className="modal-copy">Conservez le mot de passe à part. La personne qui reçoit la copie en aura besoin pour l’importer dans Notes.</p>
      <label htmlFor="backup-export-password">Mot de passe de la copie</label>
      <input id="backup-export-password" type="text" value={password} disabled={busy}
        autoComplete="off" spellCheck={false} autoCapitalize="none"
        minLength={MIN_BACKUP_PASSWORD} maxLength={MAX_BACKUP_PASSWORD} required
        onChange={event => setPassword(event.currentTarget.value)} />
      <button type="button" className="text-button" disabled={busy}
        onClick={() => setPassword(randomBackupPassword())}>Générer un autre mot de passe</button>
      <label htmlFor="backup-recipients">Adresses Google autorisées dans Notes (facultatif)</label>
      <textarea id="backup-recipients" value={emails} disabled={busy} rows={2} maxLength={3072}
        autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder="adresse@gmail.com, autre@example.com"
        onChange={event => setEmails(event.currentTarget.value)} />
      <p className="field-note">Notes vérifie les adresses à l’import. Toute personne qui possède le fichier et son mot de passe peut le déchiffrer avec un autre outil.</p>
      {error && <p className="access-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="button primary" disabled={busy}>{busy ? "Préparation…" : "Télécharger la copie protégée"}</button>
      </div>
    </form>
  );
}

export function BackupImport({ user, hasVault, busy, onImport }: {
  user: GoogleUser; hasVault: boolean; busy: boolean; onImport: (bundle: EncryptedBundle, copy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [protectedCopy, setProtectedCopy] = useState(false);
  const [ready, setReady] = useState<{ bundle: EncryptedBundle; copy: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const waiting = checking || busy;
  const select = async (next: File | null) => {
    setReady(null);
    setFile(null);
    setPassword("");
    setError("");
    if (!next) return;
    setChecking(true);
    try {
      setProtectedCopy(await requiresBackupPassword(next));
      setFile(next);
    } catch {
      setError("Impossible de lire ce fichier.");
    } finally {
      setChecking(false);
    }
  };
  const inspect = async () => {
    if (!file) return;
    setError("");
    setChecking(true);
    try {
      const bundle = await unpackBundle(file, protectedCopy ? { password, email: user.email } : undefined);
      if (!bundle.access) throw new Error("Cette sauvegarde ne contient pas de clé d’accès compatible.");
      const info = await inspectManifest(keyBytes(bundle.access), bundle.manifest);
      if (info.id !== bundle.access.vaultId || (info.owner && info.owner.subject !== bundle.access.owner))
        throw new Error("La clé de cette sauvegarde ne correspond pas à son contenu.");
      setReady({ bundle, copy: protectedCopy || bundle.access.owner !== user.id });
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cette sauvegarde est invalide.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <form className="backup-form" onSubmit={event => {
      event.preventDefault();
      if (waiting) return;
      if (ready) onImport(ready.bundle, ready.copy);
      else void inspect();
    }}>
      <label htmlFor="backup-file">Fichier de sauvegarde Notes</label>
      <input id="backup-file" type="file" accept=".notes,.flion" disabled={waiting}
        onChange={event => void select(event.currentTarget.files?.[0] || null)} />
      {file && protectedCopy && !ready && <>
        <label htmlFor="backup-import-password">Mot de passe de la copie</label>
        <input id="backup-import-password" type="password" value={password} required disabled={waiting}
          maxLength={MAX_BACKUP_PASSWORD} autoComplete="off"
          onChange={event => setPassword(event.currentTarget.value)} />
      </>}
      {ready && <p className="modal-copy">
        {ready.copy ? <>Les espaces du fichier seront copiés dans <strong>{user.email}</strong>. {hasVault
          ? "Les notes déjà dans ce coffre sont conservées."
          : "La copie est locale. Vous pourrez ensuite activer Drive. Si ce compte a déjà un coffre Drive, ouvrez-le avant de copier les notes."}</> :
          <>La sauvegarde sera restaurée pour <strong>{user.email}</strong>. Elle remplacera toute copie locale de ce compte. La synchronisation sera désactivée sur cet appareil.</>}
      </p>}
      {error && <p className="access-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="button primary" disabled={!file || waiting}>
          {waiting ? "Traitement…" : ready ? ready.copy ? "Copier les notes" : "Restaurer la sauvegarde" : "Vérifier le fichier"}
        </button>
      </div>
    </form>
  );
}
