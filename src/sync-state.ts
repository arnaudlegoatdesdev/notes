const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuidPattern = new RegExp(`^${uuid}$`);
let storageKey = "notes.sync.v2";
export function selectSyncAccount(subject: string): void {
  storageKey = subject
    ? `notes.sync.v2:${encodeURIComponent(subject)}`
    : "notes.sync.v2";
}
export interface SyncState {
  provider: string;
  head: string | null;
  dirty: boolean;
  accountKey?: string;
  vaultId?: string;
  manifestHash?: string;
}
export const readSyncState = (): SyncState | null => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      !value ||
      !["google", "onedrive"].includes(value.provider) ||
      typeof value.dirty !== "boolean" ||
      (value.head !== null && !uuidPattern.test(value.head))
    )
      return null;
    if (
      value.accountKey !== undefined &&
      !/^[a-f0-9]{64}$/.test(value.accountKey)
    )
      return null;
    if (
      value.manifestHash !== undefined &&
      !/^[a-f0-9]{64}$/.test(value.manifestHash)
    )
      return null;
    if (value.vaultId !== undefined && !uuidPattern.test(value.vaultId))
      return null;
    return value;
  } catch {
    return null;
  }
};
export function writeSyncState(state: SyncState | null): void {
  if (state) localStorage.setItem(storageKey, JSON.stringify(state));
  else localStorage.removeItem(storageKey);
}
export function markDirty(): void {
  const state = readSyncState();
  if (state) writeSyncState({ ...state, dirty: true });
}
