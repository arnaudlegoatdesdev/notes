import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { bytesBody, cloudFetch, TokenConnection } from './http';
import { CloudError, validateName, type CloudConnection, type CloudFile, type CloudQuota } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Files.ReadWrite.AppFolder'];
let msal: PublicClientApplication | undefined;
let initializing: Promise<void> | undefined;

export function prepareMicrosoftIdentity(clientId: string): Promise<void> {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: { clientId, authority: 'https://login.microsoftonline.com/consumers', redirectUri: `${window.location.origin}${window.location.pathname}` },
      cache: { cacheLocation: 'memoryStorage', temporaryCacheLocation: 'memoryStorage' },
      system: { loggerOptions: { loggerCallback: () => undefined, piiLoggingEnabled: false } },
    });
    initializing = msal.initialize();
  }
  return initializing!;
}

export async function authorizeMicrosoft(clientId: string): Promise<{ accessToken: string; expiresIn: number; account: string; cleanup: () => Promise<void> }> {
  await prepareMicrosoftIdentity(clientId);
  try {
    const result = await msal!.acquireTokenPopup({ scopes: SCOPES, prompt: 'select_account' });
    const account: AccountInfo | null = result.account;
    if (!result.accessToken || !account?.username) throw new CloudError('Microsoft n’a pas renvoyé l’identité de ce compte.', 'provider');
    return {
      accessToken: result.accessToken,
      expiresIn: Math.max(0, ((result.expiresOn?.getTime() ?? Date.now() + 3_600_000) - Date.now()) / 1000),
      account: account.username,
      cleanup: () => msal!.clearCache({ account }),
    };
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError('La connexion Microsoft a été annulée ou bloquée. Autorisez les fenêtres de connexion puis réessayez.', 'auth');
  }
}

export class OneDriveConnection extends TokenConnection implements CloudConnection {
  readonly provider = 'onedrive' as const;
  account = '';
  private folderId = '';
  private cleanup?: () => Promise<void>;

  async initialize(account?: string, cleanup?: () => Promise<void>): Promise<void> {
    this.cleanup = cleanup;
    if (account) this.account = account;
    else {
      // Native OAuth explicitly requests User.Read to identify the selected account.
      const profile = await (await this.request(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`)).json();
      this.account = profile.mail || profile.userPrincipalName || profile.displayName || '';
    }
    if (!this.account) throw new CloudError('Microsoft n’a pas renvoyé l’identité de ce compte.', 'provider');
    const folder = await (await this.request(`${GRAPH}/me/drive/special/approot`)).json();
    if (!folder.id) throw new CloudError('Le dossier Flion n’est pas disponible dans ce OneDrive.', 'provider');
    this.folderId = String(folder.id);
  }
  async list(): Promise<CloudFile[]> {
    const files: CloudFile[] = [];
    const seen = new Set<string>();
    let url: string | undefined = `${GRAPH}/me/drive/items/${encodeURIComponent(this.folderId)}/children?$select=id,name,size,file&$top=200`;
    while (url) {
      if (!url.startsWith(`${GRAPH}/`) || seen.has(url)) throw new CloudError('Microsoft a renvoyé une pagination invalide. Réessayez.', 'provider');
      seen.add(url);
      const page = await (await this.request(url)).json();
      for (const file of page.value ?? []) if (file.file) files.push({ id: String(file.id), name: String(file.name), size: Number(file.size ?? 0) });
      url = page['@odata.nextLink'];
    }
    return files;
  }
  async read(id: string): Promise<Uint8Array> {
    // /content redirects after a CORS preflight, which browsers reject. Download the
    // short-lived signed URL directly, without sending our Microsoft bearer token.
    const metadata = await (await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}?$select=id,@microsoft.graph.downloadUrl`)).json();
    const url = metadata['@microsoft.graph.downloadUrl'];
    if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new CloudError('Microsoft n’a pas ouvert le téléchargement du fichier.', 'provider');
    return new Uint8Array(await (await cloudFetch(url)).arrayBuffer());
  }
  async create(name: string, bytes: Uint8Array): Promise<CloudFile> {
    validateName(name);
    if (bytes.byteLength === 0) throw new CloudError('Le fichier chiffré est vide.', 'invalid');
    if ((await this.list()).some(file => file.name === name)) throw new CloudError('Ce fichier existe déjà dans votre cloud. Aucune donnée n’a été remplacée.', 'collision');
    const session = await (await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(this.folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail', name, fileSize: bytes.byteLength } }),
    })).json();
    const uploadUrl = session.uploadUrl;
    if (typeof uploadUrl !== 'string' || new URL(uploadUrl).protocol !== 'https:') throw new CloudError('Microsoft n’a pas ouvert le transfert du fichier.', 'provider');
    const chunkSize = 10 * 327_680;
    let completed: CloudFile | undefined;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      // The upload URL is preauthenticated. Never send the account bearer token here.
      const response = await cloudFetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}` },
        body: bytesBody(bytes.subarray(offset, end)),
      });
      const result = await response.json();
      if (response.status === 200 || response.status === 201) completed = { id: String(result.id), name: String(result.name), size: Number(result.size ?? bytes.byteLength) };
    }
    if (!completed?.id || completed.id === 'undefined') throw new CloudError('Microsoft n’a pas confirmé la fin du transfert. Réessayez la synchronisation.', 'provider');
    return completed;
  }
  async quota(): Promise<CloudQuota | null> {
    try {
      const response = await this.request(`${GRAPH}/me/drive?$select=quota`);
      const data = await response.json();
      const quota = data.quota;
      if (!quota || quota.used === undefined) return null;
      return { used: Number(quota.used), total: quota.total === undefined ? undefined : Number(quota.total) };
    } catch (error) {
      // AppFolder does not guarantee permission to inspect the entire drive quota.
      if (error instanceof CloudError && (error.status === 403 || error.status === 404)) return null;
      throw error;
    }
  }
  async disconnect(): Promise<void> {
    await super.disconnect();
    this.folderId = '';
    await this.cleanup?.();
  }
}
