export type Provider = 'google' | 'onedrive';
export type Theme = 'slate' | 'light' | 'forest' | 'sand' | 'plum' | 'onyx';
export type IconName = 'hash' | 'bookmark' | 'image' | 'file' | 'plane' | 'code' | 'heart';
export interface Space { id: string; name: string; channelOrder?: string[]; icon?: IconName | null; image?: string | null; changedAt?: string; }
export interface Channel { spaceId?: string; id: string; name: string; description: string; icon: IconName; changedAt?: string; }
export interface Attachment { id: string; name: string; mime: string; size: number; storedSize: number; }
export interface LinkPreview { url: string; title: string; description?: string; siteName?: string; image?: string; }
export interface Message { linkPreviews?: LinkPreview[]; id: string; channelId: string; text: string; createdAt: string; updatedAt?: string; attachments: Attachment[]; pinned: boolean; changedAt?: string; }
export interface Preferences { theme: Theme; font: 'system' | 'inter' | 'serif' | 'mono'; fontSize: number; limitBytes: number; changedAt?: string; }
export interface VaultData { owner?: {provider:'google'; subject:string}; version: 1 | 2; id: string; createdAt: string; spaces?: Space[]; channels: Channel[]; messages: Message[]; preferences: Preferences; }
export interface EncryptedBundle { manifest: Uint8Array; files: Record<string, Uint8Array>; access?: AccessRecord; }

export interface AccessRecord { version: 1; owner: string; vaultId: string; key: string; }
