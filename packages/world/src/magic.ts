// Ours (the magic item revamp, phase 2): how an item's magic shows, as our server packs it into
// otherwise unused object flag bits (shards-server blakston.khd OF_MAGIC_*, item.kod
// GetMagicShowFlags), and a revealed magic item's full name (UC_MAGIC_NAME, util/itemservicebook.kod
// SendMagicName).

import { objId, type ByteReader } from "@shards/protocol";
import { formatServerMessage } from "./text.ts";

const SHOW_MUL = 0x00100000;
const SHOW_MASK = 0x00700000;
const COLOUR_MUL = 0x00800000;
const COLOUR_MASK = 0x07800000;
const GLYPH_MUL = 0x00004000;
const GLYPH_MASK = 0x0000c000;

/** Every flag bit an item's magic mark reads (show, colour and glyph) */
export const MAGIC_FLAGS_MASK = SHOW_MASK | COLOUR_MASK | GLYPH_MASK;

/** blakston.khd MAGIC_SHOW_*: nothing, hidden magic, revealed magic with no tier, or a weapon's tier */
export const MAGIC_SHOW = { NONE: 0, UNREVEALED: 1, REVEALED: 2, SLIGHT: 3, MODERATE: 4, POTENT: 5, ENORMOUS: 6 } as const;

/** What an item's icon shows (MAGIC_SHOW) */
export const magicShow = (flags: number): number => (flags & SHOW_MASK) / SHOW_MUL;

/** The mark's colour, blakston.khd MAGIC_COLOUR_* (0 for none) */
export const magicColour = (flags: number): number => (flags & COLOUR_MASK) / COLOUR_MUL;

/** Which magic of its colour an item has, blakston.khd MAGIC_GLYPH_* (0 to 3): its glyph */
export const magicGlyph = (flags: number): number => (flags & GLYPH_MASK) / GLYPH_MUL;

/** A weapon's tier, 0 (slight) to 3 (enormous), or null when it shows none */
export function magicTier(flags: number): number | null {
  const show = magicShow(flags);
  return show >= MAGIC_SHOW.SLIGHT ? show - MAGIC_SHOW.SLIGHT : null;
}

/** UC_MAGIC_NAME's body (after the UC byte): the item, its flags then, and its full name */
export function readMagicName(r: ByteReader, lookup: (id: number) => string | undefined): { id: number; flags: number; name: string } | null {
  const id = objId(r.u32());
  const flags = r.u32();
  const name = formatServerMessage(r.u32(), r, lookup);
  return name === null ? null : { id, flags, name };
}
