// Ours (the magic item revamp): a magic item's colour, the same everywhere it's drawn: the disc
// of its mark on its icon (apps/client ui/magicMark.tsx) and, phase 4, the ring round a wielded magic
// weapon (sprites.ts on figures in the world, apps/client screenOverlays.ts in your own hand).
// The server packs the item's magic into object-flag bits (shards-server blakston.khd
// OF_MAGIC_*): what shows in bits 20-22, the colour in 23-26 (@shards/world magic.ts reads them
// for icons). A weapon in hand carries the same bits (ANIMATE_MAGIC, BP_PLAYER_OVERLAY's flags).

/** blakston.khd MAGIC_COLOUR_*, from 0 (none: hidden magic, or no colour of its own) */
export const MAGIC_COLOURS: readonly string[] = [
  "#9aa0a8", // none
  "#d0303a", // crimson: vampirism, vitality
  "#3f7fe0", // blue: siphoning
  "#e8cc3a", // yellow: blinding, shocking, storm resistance
  "#2fb5b0", // teal: holding, icy, frost resistance
  "#4cb848", // green: venom, acidic, acid resistance
  "#c4c9d4", // silver: purging, warding
  "#a46be0", // violet: sorcery, unholy, focus
  "#e0a830", // gold: enchanted, expert, glowing, ceremonial
  "#e08a2a", // amber: adventuring, durable, transcendent, indestructible
  "#f0661e", // orange: fiery, fire resistance
  "#f4f4f0", // white: holy
  "#2b52c9", // the duke
  "#d36fb0", // the princess
  "#6f8f2f", // the rebellion
  "#5e3a6e", // the necromancers
];

/** The colours as 0..1 RGB, for a shader's table */
export function magicColourRgb(index: number): [number, number, number] {
  const hex = MAGIC_COLOURS[index] ?? MAGIC_COLOURS[0];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** blakston.khd MAGIC_SHOW_SLIGHT: what shows from here up is a tier, slight (0) to enormous (3) */
const SHOW_SLIGHT = 3;

/**
 * A wielded weapon's ring as one byte for the outline mask: its colour (MAGIC_COLOURS) in the
 * low four bits, its tier in the next two; 0 for no ring (a ring's tier is at least 1, so its
 * code never is). Only a revealed tier gets one, and not the slightest: the ring is moderate
 * 1px, potent and enormous 2px.
 */
export function outlineCode(magicFlags: number | undefined): number {
  if (!magicFlags) return 0;
  const show = (magicFlags >>> 20) & 7;
  if (show < SHOW_SLIGHT + 1) return 0;
  const colour = (magicFlags >>> 23) & 15;
  return colour | ((show - SHOW_SLIGHT) << 4);
}

/** The ring's width in base pixels for an outline code (0 for none) */
export function outlineWidth(code: number): number {
  if (!code) return 0;
  return (code >> 4) >= 2 ? 2 : 1;
}

/** The tier (0 slight .. 3 enormous) in an outline code */
export const outlineTier = (code: number): number => (code >> 4) & 3;

/** The colour index (MAGIC_COLOURS) in an outline code */
export const outlineColour = (code: number): number => code & 15;
