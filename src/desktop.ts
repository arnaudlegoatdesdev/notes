export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface NativeToken {
  accessToken: string;
  expiresIn: number;
  scope?: string;
}

export async function nativeAuthorize(
  provider: "google" | "onedrive",
  purpose: "login" | "drive" = "drive",
  subject?: string,
): Promise<NativeToken> {
  if (!isDesktop)
    throw new Error("Cette connexion est réservée à l’application Windows.");
  const clientId =
    provider === "google"
      ? import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID
      : import.meta.env.VITE_MICROSOFT_CLIENT_ID;
  if (!clientId)
    throw new Error(
      "La connexion à ce cloud n’est pas encore configurée dans cette version de Notes.",
    );
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativeToken>("native_authorize", {
    provider,
    clientId,
    purpose,
    loginHint: subject || null,
    clientSecret:
      provider === "google"
        ? import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET || null
        : null,
  });
}

export async function checkForUpdate(): Promise<{
  version: string;
  install: () => Promise<void>;
} | null> {
  if (!isDesktop) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const enabled = await invoke<boolean>("updater_enabled");
  if (!enabled)
    throw new Error(
      "Les mises à jour intégrées ne sont pas activées pour cette version.",
    );
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20000 });
  if (!update) return null;
  return {
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
