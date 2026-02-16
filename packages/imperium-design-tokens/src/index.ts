export const imperiumPalette = {
  blackMatte: "#0b0b0b",
  charcoal: "#1b1b1b",
  forest: "#1f3a2f",
  burgundy: "#5a1f2b",
  antiqueGold: "#b89a62",
  parchment: "#f2ead8",
} as const;

export const imperiumMotion = {
  fast: 140,
  medium: 180,
} as const;

export type ImperiumPaletteKey = keyof typeof imperiumPalette;
