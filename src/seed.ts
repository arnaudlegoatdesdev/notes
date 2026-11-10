import type { VaultData } from "./core/types";
export function createData(limitBytes = 1024 ** 3): VaultData {
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    channels: [
      {
        id: crypto.randomUUID(),
        name: "notes",
        description: "Les petites choses à ne pas oublier.",
        icon: "hash",
      },
      {
        id: crypto.randomUUID(),
        name: "documents",
        description: "Tout retrouver au même endroit.",
        icon: "file",
      },
      {
        id: crypto.randomUUID(),
        name: "idées",
        description: "Une idée, même en passant.",
        icon: "bookmark",
      },
      {
        id: crypto.randomUUID(),
        name: "voyages",
        description: "Pour les prochaines escapades.",
        icon: "plane",
      },
    ],
    messages: [],
    preferences: { theme: "slate", font: "system", fontSize: 15, limitBytes },
  };
}
