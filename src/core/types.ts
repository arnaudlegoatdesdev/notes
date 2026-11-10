export type Provider = 'google' | 'onedrive';
export type Theme = 'slate' | 'light' | 'forest' | 'sand' | 'plum';
export type IconName = 'hash' | 'bookmark' | 'image' | 'file' | 'plane' | 'code' | 'heart';
export interface Channel { id: string; name: string; description: string; icon: IconName; changedAt?: string; }
export interface Attachment { id: string; name: string; mime: string; size: number; storedSize: number; }
export interface Message { id: string; channelId: string; text: string; createdAt: string; updatedAt?: string; attachments: Attachment[]; pinned: boolean; changedAt?: string; }
export interface Preferences { theme: Theme; font: 'system' | 'inter' | 'serif' | 'mono'; fontSize: number; limitBytes: number; changedAt?: string; }
export interface VaultData { owner?: {provider:'google'; subject:string}; version: 1; id: string; createdAt: string; channels: Channel[]; messages: Message[]; preferences: Preferences; }
export interface EncryptedBundle { manifest: Uint8Array; files: Record<string, Uint8Array>; access?: AccessRecord; }

export interface AccessRecord { version: 1; owner: string; vaultId: string; key: string; }
