import {
  isDesktop,
  nativeAuthorize,
  nativeCachedSession,
  nativeClearSession,
} from "./desktop";
import {
  authorizeGoogle,
  readGoogleIdentity,
  rememberGoogleGrant,
  forgetGoogleGrant,
} from "./cloud/google";
import {
  saveWebLogin,
  readWebLogin,
  clearWebLogin,
  validateUser,
} from "./session-storage";
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
  const user =
    credentials.user || (await readGoogleIdentity(credentials.accessToken));
  rememberGoogleGrant(credentials, user.id);
  if (!isDesktop) await saveWebLogin(user, credentials);
  return user;
}
export async function restoreGoogleSession(): Promise<GoogleUser | null> {
  const saved = isDesktop ? await nativeCachedSession() : await readWebLogin();
  if (!saved) return null;
  const user = validateUser(saved.user);
  if (saved.credentials) rememberGoogleGrant(saved.credentials, user.id);
  else forgetGoogleGrant();
  return user;
}
export async function signOutGoogle(): Promise<void> {
  if (isDesktop) await nativeClearSession();
  else await clearWebLogin();
  forgetGoogleGrant();
}
export function assertVaultOwner(data: VaultData, subject: string): void {
  if (
    data.owner &&
    (data.owner.provider !== "google" || data.owner.subject !== subject)
  )
    throw new Error(
      "Ce coffre appartient à un autre compte Google. Reconnectez le compte d’origine.",
    );
}
