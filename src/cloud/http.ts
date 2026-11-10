import { CloudError } from "./types";

export async function cloudFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new CloudError(
      "Vous êtes hors ligne. Vos données restent sur cet appareil.",
      "offline",
    );
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(60_000),
    });
  } catch {
    throw new CloudError(
      "Connexion au cloud interrompue. Réessayez quand le réseau est disponible.",
      "offline",
    );
  }
  if (response.ok) return response;
  let providerCode = "";
  try {
    const body = await response.json();
    providerCode =
      String(body.error?.code ?? "") +
      " " +
      String(body.error?.innerError?.code ?? "") +
      " " +
      (body.error?.errors ?? [])
        .map((entry: { reason?: string }) => entry.reason ?? "")
        .join(" ");
  } catch {
    /* Some providers return a body without JSON. */
  }
  if (
    response.status === 507 ||
    /storageQuotaExceeded|quotaLimitReached|insufficientStorage|activityLimitReached.*quota/i.test(
      providerCode,
    )
  ) {
    throw new CloudError(
      "Votre cloud est plein. Libérez de l’espace puis relancez la synchronisation.",
      "quota",
      response.status,
    );
  }
  if (response.status === 401)
    throw new CloudError(
      "La connexion au cloud a expiré. Reconnectez votre compte.",
      "auth",
      401,
    );
  if (
    response.status === 409 ||
    response.status === 412 ||
    /nameAlreadyExists/i.test(providerCode)
  ) {
    throw new CloudError(
      "Un fichier portant ce nom existe déjà. Aucune donnée existante n’a été remplacée.",
      "collision",
      response.status,
    );
  }
  if (response.status === 403)
    throw new CloudError(
      "Le cloud refuse cet accès. Vérifiez les autorisations du compte.",
      "permission",
      403,
    );
  if (response.status === 429)
    throw new CloudError(
      "Le cloud reçoit trop de demandes. Réessayez dans quelques instants.",
      "provider",
      429,
    );
  if (response.status === 404)
    throw new CloudError(
      "Ce fichier cloud est introuvable. Relancez la synchronisation.",
      "provider",
      404,
    );
  throw new CloudError(
    "Le cloud est temporairement indisponible. Vos données restent sur cet appareil.",
    "provider",
    response.status,
  );
}

export abstract class TokenConnection {
  private token: string;
  private expiresAt: number;
  private connected = true;
  private renewal: Promise<void> | null = null;
  constructor(
    token: string,
    expiresIn: number,
    private readonly renew?: (
      force: boolean,
    ) => Promise<{ accessToken: string; expiresIn: number }>,
  ) {
    this.token = token;
    this.expiresAt = Date.now() + Math.max(0, expiresIn - 20) * 1000;
  }
  protected authorization(): HeadersInit {
    if (!this.token || Date.now() >= this.expiresAt)
      throw new CloudError(
        "La connexion au cloud a expiré. Reconnectez votre compte.",
        "auth",
      );
    return { Authorization: `Bearer ${this.token}` };
  }
  private async refresh(force: boolean): Promise<void> {
    if (!this.connected || !this.renew)
      throw new CloudError(
        "Reconnectez Google Drive pour reprendre la synchronisation.",
        "auth",
      );
    if (!this.renewal) {
      this.renewal = this.renew(force)
        .then((credentials) => {
          if (!this.connected)
            throw new CloudError("La connexion Drive a été fermée.", "auth");
          this.token = credentials.accessToken;
          this.expiresAt =
            Date.now() + Math.max(0, credentials.expiresIn - 20) * 1000;
        })
        .finally(() => {
          this.renewal = null;
        });
    }
    await this.renewal;
  }
  protected async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    if (!this.connected)
      throw new CloudError("La connexion Drive a été fermée.", "auth");
    if (!this.token || Date.now() >= this.expiresAt) await this.refresh(false);
    const send = () =>
      cloudFetch(url, {
        ...init,
        headers: { ...this.authorization(), ...init.headers },
      });
    try {
      return await send();
    } catch (error) {
      if (
        !(error instanceof CloudError) ||
        error.code !== "auth" ||
        !this.renew
      )
        throw error;
      await this.refresh(true);
      return send();
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    this.token = "";
  }
}

export function bytesBody(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
