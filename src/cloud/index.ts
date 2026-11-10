import { isDesktop, nativeAuthorize } from '../desktop';
import { authorizeGoogle, GoogleConnection, prepareGoogleIdentity } from './google';
import { authorizeMicrosoft, OneDriveConnection, prepareMicrosoftIdentity } from './onedrive';
import { CloudError, type CloudConnection, type CloudProvider } from './types';
export { CloudError } from './types';
export type { CloudConnection, CloudFile, CloudQuota, CloudProvider } from './types';

function clientId(provider: CloudProvider): string {
  if (provider === 'google') return String(isDesktop ? import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ?? '' : import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  return String(import.meta.env.VITE_MICROSOFT_CLIENT_ID ?? '').trim();
}

export function cloudConfigured(provider: CloudProvider): boolean { return clientId(provider).length > 0; }

// Load sign-in clients ahead of the user's click so popup calls retain the gesture.
if (typeof window !== 'undefined' && !isDesktop) {
  if (cloudConfigured('google')) void prepareGoogleIdentity().catch(() => undefined);
  if (cloudConfigured('onedrive')) void prepareMicrosoftIdentity(clientId('onedrive')).catch(() => undefined);
}

export async function connectCloud(provider: CloudProvider): Promise<CloudConnection> {
  if (!cloudConfigured(provider)) throw new CloudError(`La connexion ${provider === 'google' ? 'Google Drive' : 'OneDrive'} n’est pas configurée pour cette installation.`, 'configuration');
  if (provider === 'google') {
    const credentials = isDesktop ? await nativeAuthorize(provider) : await authorizeGoogle(clientId(provider));
    const connection = new GoogleConnection(credentials.accessToken, credentials.expiresIn);
    try { await connection.identify(); return connection; }
    catch (error) { await connection.disconnect(); throw error; }
  }
  if (isDesktop) {
    const credentials = await nativeAuthorize(provider);
    const connection = new OneDriveConnection(credentials.accessToken, credentials.expiresIn);
    try { await connection.initialize(); return connection; }
    catch (error) { await connection.disconnect(); throw error; }
  }
  const credentials = await authorizeMicrosoft(clientId(provider));
  const connection = new OneDriveConnection(credentials.accessToken, credentials.expiresIn);
  try { await connection.initialize(credentials.account, credentials.cleanup); return connection; }
  catch (error) { await connection.disconnect(); throw error; }
}
