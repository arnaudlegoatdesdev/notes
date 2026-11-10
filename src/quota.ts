import type { CloudQuota } from "./cloud";
export const GB = 1_000_000_000;
export const MIN_VAULT_BYTES = 1_000_000;
export function availableCloudBytes(
  quota: CloudQuota | null,
  alreadyStored = 0,
): number | undefined {
  if (!quota || quota.total === undefined) return undefined;
  if (
    ![quota.used, quota.total, alreadyStored].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Le quota renvoyé par Google est invalide.");
  return Math.max(0, quota.total - quota.used) + alreadyStored;
}
export function validateLimit(valueInGB: number, maximum?: number): number {
  const bytes = Math.round(valueInGB * GB);
  if (!Number.isSafeInteger(bytes) || bytes < MIN_VAULT_BYTES)
    throw new Error("Choisissez une limite d’au moins 1 Mo.");
  if (maximum !== undefined && bytes > maximum)
    throw new Error("Cette limite dépasse l’espace disponible.");
  return bytes;
}
export function formatBytes(n: number): string {
  return n >= GB
    ? `${(n / GB).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Go`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`
      : n >= 1000
        ? `${Math.ceil(n / 1000)} Ko`
        : `${n} o`;
}
export async function availableDeviceBytes(): Promise<number | undefined> {
  const estimate = await navigator.storage?.estimate?.();
  return estimate?.quota === undefined
    ? undefined
    : Math.max(0, estimate.quota - (estimate.usage || 0));
}
