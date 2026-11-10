import { isDesktop, nativeAuthorize } from "./desktop";
import { authorizeGoogle, readGoogleIdentity, rememberGoogleGrant } from "./cloud/google";
import type { VaultData } from "./core/types";
export interface GoogleUser {
  id: string;
  email: string;
  name: string;
}
export async function signInGoogle(): Promise<GoogleUser> {
  const clientId = isDesktop
    ? import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID
    : import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("La connexion Google n’est pas configurée.");
  const credentials = isDesktop
    ? await nativeAuthorize("google", "login")
    : await authorizeGoogle(clientId, "login");
  const user = await readGoogleIdentity(credentials.accessToken);
  rememberGoogleGrant(credentials, user.id);
  return user;
}
export function assertVaultOwner(data: VaultData, subject: string): void {
  if (
    data.owner &&
    (data.owner.provider !== "google" || data.owner.subject !== subject)
  ) {
    throw new Error(
      "Ce coffre appartient à un autre compte Google. Reconnectez le compte d’origine.",
    );
  }
}
