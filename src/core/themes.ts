import type { Preferences } from "./types";

export const classicThemes = {
  onyx: "Onyx",
  slate: "Ardoise",
  light: "Clair",
  forest: "Forêt",
  sand: "Sable",
  plum: "Prune",
} as const;

export type ClassicTheme = keyof typeof classicThemes;

export const extraThemes = {
  braise: { name: "Braise", fallback: "slate" },
  grenat: { name: "Grenat", fallback: "plum" },
  cobalt: { name: "Cobalt", fallback: "slate" },
  lagon: { name: "Lagon", fallback: "forest" },
  iris: { name: "Iris", fallback: "plum" },
  cuivre: { name: "Cuivre", fallback: "slate" },
  neon: { name: "Néon", fallback: "onyx" },
  porcelaine: { name: "Porcelaine", fallback: "light" },
  "rose-poudre": { name: "Rose poudré", fallback: "light" },
  matcha: { name: "Matcha", fallback: "light" },
} as const satisfies Record<string, { name: string; fallback: ClassicTheme }>;

type ExtraTheme = keyof typeof extraThemes;
export type Theme = ClassicTheme | ExtraTheme;

export function isClassicTheme(value: unknown): value is ClassicTheme {
  return typeof value === "string" && Object.hasOwn(classicThemes, value);
}

function isExtraTheme(value: string | undefined): value is ExtraTheme {
  return value !== undefined && Object.hasOwn(extraThemes, value);
}

export function visibleTheme({ theme, themeVariant }: Preferences): Theme {
  if (isExtraTheme(themeVariant) && extraThemes[themeVariant].fallback === theme)
    return themeVariant;
  return theme;
}

export function selectTheme(preferences: Preferences, theme: Theme): Preferences {
  const { themeVariant: _, ...base } = preferences;
  // Earlier versions still read and sync the established theme field.
  if (isClassicTheme(theme)) return { ...base, theme };
  return { ...base, theme: extraThemes[theme].fallback, themeVariant: theme };
}
