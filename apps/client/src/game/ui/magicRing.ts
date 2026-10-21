// Ours (the magic item revamp, phase 2): the ring round a magic item's icon, from the bits our
// server packs into its object flags (@shards/world magic.ts). Hidden magic is a grey ring; once
// revealed, the ring takes its attribute's colour, and a weapon's tier sets its thickness and
// glow: slight 1px, moderate 2px, potent 3px, enormous 3px with a strong glow. Drawn by ObjIcon,
// so it shows in the inventory, the hotbar, shops, trades and the description window alike.

import type { CSSProperties } from "react";
import { MAGIC_SHOW, magicColour, magicShow } from "@shards/world";

/** blakston.khd MAGIC_COLOUR_*, in order from 1 */
export const MAGIC_RING_COLOURS: readonly string[] = [
  "#9aa0a8", // none: hidden magic, or revealed with no colour of its own
  "#d0303a", // crimson: vampirism
  "#3f7fe0", // blue: siphoning
  "#e8cc3a", // yellow: blinding, shocking
  "#2fb5b0", // teal: holding, icy
  "#4cb848", // green: venom, acidic
  "#c4c9d4", // silver: purging
  "#a46be0", // violet: sorcery, unholy
  "#e0a830", // gold: enchanted, expert, glowing, ceremonial
  "#e08a2a", // amber: adventuring, durable, transcendent, indestructible
  "#f0661e", // orange: fiery
  "#f4f4f0", // white: holy
  "#2b52c9", // the duke
  "#d36fb0", // the princess
  "#6f8f2f", // the rebellion
  "#5e3a6e", // the necromancers
];

const SHOW_CLASS: Record<number, string> = {
  [MAGIC_SHOW.UNREVEALED]: "magic magic-hidden",
  [MAGIC_SHOW.REVEALED]: "magic magic-revealed",
  [MAGIC_SHOW.SLIGHT]: "magic magic-slight",
  [MAGIC_SHOW.MODERATE]: "magic magic-moderate",
  [MAGIC_SHOW.POTENT]: "magic magic-potent",
  [MAGIC_SHOW.ENORMOUS]: "magic magic-enormous",
};

/** The ring's class and colour for an object (anything without flags, such as a spell, has none) */
export function magicRing(object: unknown): { className: string; style: CSSProperties } | null {
  const flags = (object as { flags?: unknown } | null)?.flags;
  if (typeof flags !== "number") return null;
  const show = magicShow(flags);
  const className = SHOW_CLASS[show];
  if (!className) return null;
  const colour = show === MAGIC_SHOW.UNREVEALED ? MAGIC_RING_COLOURS[0] : (MAGIC_RING_COLOURS[magicColour(flags)] ?? MAGIC_RING_COLOURS[0]);
  return { className, style: { "--magic-ring": colour } as CSSProperties };
}
