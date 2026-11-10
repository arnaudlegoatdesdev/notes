import { isDesktop, nativeAuthorize, nativeRefreshGoogle } from "../desktop";
import {
  authorizeGoogle,
  driveGrant,
  rememberGoogleGrant,
  GoogleConnection,
  prepareGoogleIdentity,
  readGoogleIdentity,
} from "./google";
import { updateWebCredentials } from "../session-storage";
import { CloudError, type CloudConnection, type CloudProvider } from "./types";
export { CloudError } from "./types";
export type {
  CloudConnection,
  CloudFile,
  CloudQuota,
  CloudProvider,
} from "./types";
function clientId(): string {
  return String(
    isDesktop
      ? (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ?? "")
      : (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ""),
  ).trim();
}
export function cloudConfigured(provider: CloudProvider): boolean {
  return provider === "google" && clientId().length > 0;
}
if (typeof window !== "undefined" && !isDesktop && cloudConfigured("google"))
  void prepareGoogleIdentity().catch(() => undefined);
export async function connectCloud(
  provider: CloudProvider,
  expectedSubject?: string,
  options: { interactive?: boolean } = {},
): Promise<CloudConnection> {
  if (provider !== "google")
    throw new CloudError(
      "Ce fournisseur n’est pas disponible dans cette version.",
      "configuration",
    );
  if (!clientId())
    throw new CloudError(
      "La connexion Google n’est pas configurée.",
      "configuration",
    );
  let credentials = expectedSubject ? driveGrant(expectedSubject) : null;
  if (!credentials && isDesktop && expectedSubject) {
    try {
      credentials = await nativeRefreshGoogle(expectedSubject);
    } catch (error) {
      if (options.interactive === false) throw error;
    }
  }
  if (
    !credentials?.scope
      ?.split(/\s+/)
      .includes("https://www.googleapis.com/auth/drive.appdata")
  ) {
    if (options.interactive === false)
      throw new CloudError(
        "Reconnectez Google Drive pour reprendre la synchronisation.",
        "auth",
      );
    credentials = isDesktop
      ? await nativeAuthorize("google", "drive", expectedSubject)
      : await authorizeGoogle(clientId(), "drive", expectedSubject);
  }
  if (expectedSubject) {
    const identity =
      credentials.user || (await readGoogleIdentity(credentials.accessToken));
    if (identity.id !== expectedSubject)
      throw new CloudError(
        "Choisissez le même compte Google que pour la connexion à Notes.",
        "auth",
      );
  }
  if (expectedSubject) {
    rememberGoogleGrant(credentials, expectedSubject);
    if (!isDesktop) await updateWebCredentials(expectedSubject, credentials);
  }
  const connection = new GoogleConnection(
    credentials.accessToken,
    credentials.expiresIn,
    isDesktop && expectedSubject
      ? async (force) => {
          const next = await nativeRefreshGoogle(expectedSubject, force);
          if (
            !next?.scope
              ?.split(/\s+/)
              .includes("https://www.googleapis.com/auth/drive.appdata")
          )
            throw new CloudError(
              "Reconnectez Google Drive pour reprendre la synchronisation.",
              "auth",
            );
          rememberGoogleGrant(next, expectedSubject);
          return next;
        }
      : undefined,
  );
  try {
    await connection.identify();
    return connection;
  } catch (error) {
    await connection.disconnect();
    throw error;
  }
}
