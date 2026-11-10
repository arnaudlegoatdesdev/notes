import { isDesktop, nativeAuthorize } from "../desktop";
import {
  authorizeGoogle,
  GoogleConnection,
  prepareGoogleIdentity,
  readGoogleIdentity,
} from "./google";
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
  const credentials = isDesktop
    ? await nativeAuthorize("google", "drive")
    : await authorizeGoogle(clientId());
  if (expectedSubject) {
    const identity = await readGoogleIdentity(credentials.accessToken);
    if (identity.id !== expectedSubject)
      throw new CloudError(
        "Choisissez le même compte Google que pour la connexion à Notes.",
        "auth",
      );
  }
  const connection = new GoogleConnection(
    credentials.accessToken,
    credentials.expiresIn,
  );
  try {
    await connection.identify();
    return connection;
  } catch (error) {
    await connection.disconnect();
    throw error;
  }
}
