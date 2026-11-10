export type CloudProvider = 'google' | 'onedrive';

export interface CloudFile { id: string; name: string; size: number; }
export interface CloudQuota { used: number; total?: number; }
export interface CloudConnection {
  provider: CloudProvider;
  account: string;
  list(): Promise<CloudFile[]>;
  read(id: string): Promise<Uint8Array>;
  create(name: string, bytes: Uint8Array): Promise<CloudFile>;
  quota(): Promise<CloudQuota | null>;
  disconnect(): Promise<void>;
}

export class CloudError extends Error {
  constructor(message: string, public readonly code: 'quota' | 'offline' | 'auth' | 'permission' | 'collision' | 'provider' | 'configuration' | 'native' | 'invalid', public readonly status?: number) {
    super(message);
    this.name = 'CloudError';
  }
}

export function validateName(name: string): void {
  if (!name || name.length > 180 || !/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') {
    throw new CloudError('Nom de fichier cloud invalide.', 'invalid');
  }
}
