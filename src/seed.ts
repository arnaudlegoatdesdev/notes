import type { VaultData } from "./core/types";
export function createData(limitBytes = 1024 ** 3): VaultData {
  const id = crypto.randomUUID();
  return {
    version: 2,
    id,
    spaces: [{ id, name: "Mon espace" }],
    createdAt: new Date().toISOString(),
    channels: [],
    messages: [],
    preferences: { theme: "slate", font: "system", fontSize: 15, limitBytes },
  };
}
