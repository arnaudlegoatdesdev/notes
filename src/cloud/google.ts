import { bytesBody, cloudFetch, TokenConnection } from "./http";
import {googlePicture} from "../google-picture";
import {
  CloudError,
  validateName,
  type CloudConnection,
  type CloudFile,
  type CloudQuota,
} from "./types";

const DRIVE = "https://www.googleapis.com/drive/v3";
const LOGIN_SCOPE = "openid email profile";
const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  scope?: string;
}
interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        include_granted_scopes: boolean;
        callback(response: GoogleTokenResponse): void;
        error_callback(error: { type: string }): void;
      }): GoogleTokenClient;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

export interface GoogleCredentials {
  accessToken: string;
  expiresIn: number;
  scope?: string;
  user?: import("../auth").GoogleUser;
}
let grant: (GoogleCredentials & { subject: string; expiresAt: number }) | null =
  null;
export function rememberGoogleGrant(
  credentials: GoogleCredentials,
  subject: string,
): void {
  grant = {
    ...credentials,
    subject,
    expiresAt: Date.now() + credentials.expiresIn * 1000,
  };
}
export function driveGrant(subject: string): GoogleCredentials | null {
  if (
    !grant ||
    grant.subject !== subject ||
    grant.expiresAt < Date.now() + 60_000 ||
    !grant.scope?.split(/\s+/).includes(APPDATA_SCOPE)
  )
    return null;
  return {
    accessToken: grant.accessToken,
    expiresIn: Math.floor((grant.expiresAt - Date.now()) / 1000),
    scope: grant.scope,
  };
}
export function forgetGoogleGrant(): void {
  grant = null;
}
let identityPromise: Promise<void> | undefined;
export function prepareGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(
        new CloudError(
          "Google ne répond pas. Vérifiez votre connexion puis réessayez.",
          "offline",
        ),
      );
    }, 20_000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(
        new CloudError("Impossible de charger la connexion Google.", "offline"),
      );
    };
    document.head.appendChild(script);
  }).catch((error) => {
    identityPromise = undefined;
    throw error;
  });
  return identityPromise;
}

export async function authorizeGoogle(
  clientId: string,
  purpose: "login" | "drive" = "drive",
  subject?: string,
): Promise<GoogleCredentials> {
  if (!window.google?.accounts?.oauth2) {
    await prepareGoogleIdentity();
    throw new CloudError(
      "La connexion Google est prête. Cliquez à nouveau pour vous connecter.",
      "auth",
    );
  }
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope:
        purpose === "login" ? LOGIN_SCOPE : `${LOGIN_SCOPE} ${APPDATA_SCOPE}`,
      include_granted_scopes: true,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new CloudError(
              "La connexion Google a été refusée ou annulée.",
              "auth",
            ),
          );
          return;
        }
        resolve({
          accessToken: response.access_token,
          expiresIn: Number(response.expires_in ?? 3600),
          scope:
            response.scope ||
            (purpose === "drive"
              ? `${LOGIN_SCOPE} ${APPDATA_SCOPE}`
              : LOGIN_SCOPE),
        });
      },
      error_callback: () =>
        reject(
          new CloudError(
            "La fenêtre Google a été fermée ou bloquée. Autorisez les fenêtres de connexion puis réessayez.",
            "auth",
          ),
        ),
    });
    client.requestAccessToken({
      prompt: purpose === "login" ? "select_account" : "",
      ...(subject ? { login_hint: subject } : {}),
    });
  });
}

export async function readGoogleIdentity(
  accessToken: string,
): Promise<import("../auth").GoogleUser> {
  const response = await cloudFetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const profile = await response.json();
  if (
    typeof profile.sub !== "string" ||
    !profile.sub ||
    profile.sub.length > 255 ||
    typeof profile.email !== "string" ||
    !profile.email ||
    profile.email_verified !== true
  )
    throw new CloudError(
      "Google n’a pas confirmé l’identité de ce compte.",
      "auth",
    );
  return {
    id: profile.sub,
    email: profile.email,
    name:
      typeof profile.name === "string" && profile.name
        ? profile.name
        : profile.email,
    ...(googlePicture(profile.picture) ? {picture: googlePicture(profile.picture)} : {}),
  };
}

export class GoogleConnection
  extends TokenConnection
  implements CloudConnection
{
  readonly provider = "google" as const;
  account = "";
  private createQueue: Promise<unknown> = Promise.resolve();

  async identify(): Promise<void> {
    const data = await (
      await this.request(`${DRIVE}/about?fields=user(emailAddress,displayName)`)
    ).json();
    this.account = data.user?.emailAddress || data.user?.displayName || "";
    if (!this.account)
      throw new CloudError(
        "Google n’a pas renvoyé l’identité de ce compte.",
        "provider",
      );
  }
  async list(): Promise<CloudFile[]> {
    return this.listFiles();
  }
  private async listFiles(name?: string): Promise<CloudFile[]> {
    const files: CloudFile[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const query =
        "trashed = false and mimeType != 'application/vnd.google-apps.folder'" +
        (name ? ` and name = '${name}'` : "");
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: query,
        fields: "nextPageToken,files(id,name,size)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await (
        await this.request(`${DRIVE}/files?${params}`)
      ).json();
      for (const file of page.files ?? [])
        files.push({
          id: String(file.id),
          name: String(file.name),
          size: Number(file.size ?? 0),
        });
      pageToken = page.nextPageToken;
      if (pageToken && seen.has(pageToken))
        throw new CloudError(
          "Google a renvoyé une pagination invalide. Réessayez.",
          "provider",
        );
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return files;
  }
  async read(id: string): Promise<Uint8Array> {
    const response = await this.request(
      `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }
  create(name: string, bytes: Uint8Array): Promise<CloudFile> {
    validateName(name);
    const operation = this.createQueue.then(() =>
      this.createUnique(name, bytes),
    );
    this.createQueue = operation.catch(() => undefined);
    return operation;
  }
  private async createUnique(
    name: string,
    bytes: Uint8Array,
  ): Promise<CloudFile> {
    if ((await this.listFiles(name)).length)
      throw new CloudError(
        "Ce fichier existe déjà dans votre cloud. Aucune donnée n’a été remplacée.",
        "collision",
      );
    // Resumable upload avoids building a second multipart copy of large encrypted files.
    const session = await this.request(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "application/octet-stream",
          "X-Upload-Content-Length": String(bytes.byteLength),
        },
        body: JSON.stringify({
          name,
          parents: ["appDataFolder"],
          mimeType: "application/octet-stream",
        }),
      },
    );
    const location = session.headers.get("Location");
    if (!location || new URL(location).origin !== "https://www.googleapis.com")
      throw new CloudError(
        "Google n’a pas ouvert le transfert du fichier.",
        "provider",
      );
    const response = await this.request(location, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytesBody(bytes),
    });
    const file = await response.json();
    // Drive permits duplicate names. UUID object names avoid races; detect one if it occurs.
    if ((await this.listFiles(name)).length > 1)
      throw new CloudError(
        "Deux appareils ont créé un fichier portant le même nom. Relancez la synchronisation.",
        "collision",
      );
    return {
      id: String(file.id),
      name: String(file.name),
      size: Number(file.size ?? bytes.byteLength),
    };
  }
  async quota(): Promise<CloudQuota> {
    const data = await (
      await this.request(`${DRIVE}/about?fields=storageQuota(limit,usage)`)
    ).json();
    if (!data.storageQuota || data.storageQuota.usage === undefined)
      throw new CloudError(
        "Google n’a pas renvoyé le quota de stockage.",
        "provider",
      );
    return {
      used: Number(data.storageQuota.usage),
      total:
        data.storageQuota.limit === undefined
          ? undefined
          : Number(data.storageQuota.limit),
    };
  }
}
