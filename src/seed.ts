import type { VaultData } from "./core/types";
export function createData(limitBytes = 1024 ** 3): VaultData {
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    channels: [],
    messages: [],
    preferences: { theme: "slate", font: "system", fontSize: 15, limitBytes },
  };
}
