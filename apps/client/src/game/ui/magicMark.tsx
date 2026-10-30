// Ours: the mark on a magic item's icon, from the bits our server packs into its object flags
// (@shards/world magic.ts). Hidden magic is a grey disc with "?"; once revealed, a disc of its
// attribute's colour with that magic's own glyph (blakston.khd MAGIC_GLYPH_*: which magic of its
// colour). It took the place of the coloured ring round the icon (the magic item revamp, phase 2);
// a weapon's tier isn't shown on the icon. Drawn by ObjIcon, so it shows in the inventory, the
// hotbar, shops, trades and the description window alike. The ring round a wielded weapon in the
// world is still a ring (@shards/render magicOutline.ts).

import type { ReactElement } from "react";
import { MAGIC_COLOURS } from "@shards/render";
import { MAGIC_SHOW, magicColour, magicGlyph, magicShow } from "@shards/world";

/** blakston.khd MAGIC_COLOUR_*: the colours a mark's disc can take */
const C = {
  NONE: 0, CRIMSON: 1, BLUE: 2, YELLOW: 3, TEAL: 4, GREEN: 5, SILVER: 6, VIOLET: 7,
  GOLD: 8, AMBER: 9, ORANGE: 10, WHITE: 11, DUKE: 12, PRINCESS: 13, REBEL: 14, NECROMANCER: 15,
} as const;

/** Glyphs on a 24-unit square, drawn in currentColor: filled shapes and strokes */
const fill = (d: string) => <path d={d} fill="currentColor" fillRule="evenodd" />;
const line = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />;

const SHIELD = "M12 2.5 19.5 5.3V11c0 4.6-3.1 8.4-7.5 10.5C7.6 19.4 4.5 15.6 4.5 11V5.3Z";

const DROP = fill("M12 2.5S5 10.6 5 15a7 7 0 0 0 14 0c0-4.4-7-12.5-7-12.5Z");
const HEART = fill("M12 20.5 4.2 12.6A4.8 4.8 0 0 1 12 6.8a4.8 4.8 0 0 1 7.8 5.8Z");
const SWIRL = line("M12.5 12.5a1.8 1.8 0 1 1 -1.8-1.8a3.8 3.8 0 0 1 3.8 3.8a5.8 5.8 0 0 1 -5.8 5.8a7.6 7.6 0 0 1 -0.2-15.2");
const BOLT = fill("M13.5 2 5 13.8h6.2L10 22l9-12.4h-6.3Z");
const EYE = (
  <>
    {line("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z")}
    {fill("M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z")}
  </>
);
const SNOWFLAKE = line("M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 3.8 12 6.2l2.5-2.4M9.5 20.2 12 17.8l2.5 2.4");
const HAND = (
  <>
    <path d="M8.1 11.5V6M10.7 11V4.2M13.3 11V4.6M15.9 11.5V6.6M7.4 15.2 4.9 12.4" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" />
    {fill("M7 10.6h10v5a5.6 5.6 0 0 1-5.6 5.6h-.1A5.6 5.6 0 0 1 7 15.6Z")}
  </>
);
const FLASK = (
  <>
    {line("M8.5 3h7M10 3v6.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.2V3")}
    {fill("M7.4 15.5h9.2l1.4 2.8a.9.9 0 0 1-.8 1.3H6.8a.9.9 0 0 1-.8-1.3Z")}
  </>
);
const FANG = fill("M5 3.5h14c0 4.5-3.2 10-7 17.5C8.2 13.5 5 8 5 3.5Z");
const WARD = fill(SHIELD);
const SEVERED_CHAIN = (
  <>
    <g transform="rotate(-45 12 12)">
      {line("M10 9.2H6.3a2.8 2.8 0 0 0 0 5.6H10")}
      {line("M14 9.2h3.7a2.8 2.8 0 0 1 0 5.6H14")}
    </g>
    {line("M9.6 4.2l.7 2.4M14.4 19.8l-.7-2.4M4.2 9.6l2.4.7M19.8 14.4l-2.4-.7")}
  </>
);
const SKULL = fill(
  "M12 3a7.5 7.5 0 0 0-7.5 7.5v3.2L6.5 16v4.5h11V16l2-2.3v-3.2A7.5 7.5 0 0 0 12 3Z"
  + "M9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
);
const SPARKLE = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}l${r * 0.28} ${r * 0.72} ${r * 0.72} ${r * 0.28}-${r * 0.72} ${r * 0.28}-${r * 0.28} ${r * 0.72}-${r * 0.28}-${r * 0.72}-${r * 0.72}-${r * 0.28} ${r * 0.72}-${r * 0.28}Z`;
const SPARKLES = fill(SPARKLE(10, 10.5, 7.5) + SPARKLE(18, 17.5, 4));
const STAR4 = fill(SPARKLE(12, 12, 9.5));
const TARGET = (
  <>
    {line("M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z")}
    {line("M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z")}
    {fill("M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z")}
  </>
);
const SWORDS = line("M4 4l11 11M20 4 9 15M13 17.5l4.5-4.5M6.5 13 11 17.5M16 16l3.5 3.5M8 16l-3.5 3.5");
const BULB = (
  <>
    {fill("M12 2.5a6.5 6.5 0 0 0-3.8 11.8V16.5h7.6v-2.2A6.5 6.5 0 0 0 12 2.5Z")}
    {line("M9 19h6M10.2 21.5h3.6")}
  </>
);
const CROWN = fill("M3 7.5l4.5 4.2L12 4.5l4.5 7.2L21 7.5l-2 11.5H5Z");
const HAMMER = (
  <>
    {fill("M3.5 4.5h12.5l2.5 2.5v3H3.5Z")}
    {line("M9.5 10.5v10.5")}
  </>
);
const ANVIL = fill("M3 6.5h13.5c0 2.8 1.9 4.2 4.5 4.2v1.8h-6.2l-1.3 3h2.8v3.5H7.7V16h2.8l-1.3-3H6.6C4.4 13 3 10.6 3 6.5Z");
const STAR5 = fill("M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8Z");
const COMPASS = (
  <>
    {line("M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z")}
    {fill("M15.8 8.2 13.6 13.6 8.2 15.8l2.2-5.4Z")}
  </>
);
const FLAME = fill("M12 2c.9 3.8 6.5 6.2 6.5 12.2a6.5 6.5 0 0 1-13 0c0-3.2 2-5.4 3.2-6.4 0 2.2 1 3.5 2.3 3.6C11 7.4 10 5 12 2Z");
const ANKH = line("M12 12.5C9.6 10.5 8.4 8.5 8.4 6.7a3.6 3.6 0 0 1 7.2 0c0 1.8-1.2 3.8-3.6 5.8ZM5.8 12.5h12.4M12 12.5V22");
const TOWER = fill("M5 21V9h2V5.5h2.3V9h1.6V5.5h2.2V9h1.6V5.5H17V9h2v12h-5v-3.5a2 2 0 0 0-4 0V21Z");
const TORCH = (
  <>
    {fill("M9.5 11h5l-1.5 10.5h-2Z")}
    {fill("M12 2c.6 2.4 4 3.6 4 6.4A4 4 0 0 1 8 8.4c0-1.6 1-2.6 1.8-3.2 0 1.2.6 1.8 1.3 1.9C11 5 10.6 3.6 12 2Z")}
  </>
);
const HEADSTONE = (
  <>
    {fill("M6.8 19.5V9.8a5.2 5.2 0 0 1 10.4 0v9.7ZM11.2 8.4v2.3H9v1.6h2.2V16h1.6v-3.7H15v-1.6h-2.2V8.4Z")}
    {line("M3.8 20.6h16.4")}
  </>
);
const GAUNTLET = fill(
  "M6 9.6A1.6 1.6 0 0 1 7.6 8h8.8A1.6 1.6 0 0 1 18 9.6V14a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z"
  + "M9.4 8v3.6h1V8Zm2.1 0v3.6h1V8Zm2.1 0v3.6h1V8Z"
  + "M7.6 18.8h8.8l1.2 3.2H6.4Z"
  + "M4.4 10.4a1.8 1.8 0 0 1 3.1-1.2l.3.4v4.6L5 12.6a1.8 1.8 0 0 1-.6-2.2Z",
);
const QUESTION = (
  <>
    {line("M8.6 8.4a3.5 3.5 0 1 1 5.2 3.1c-1.1.6-1.8 1.4-1.8 2.7v.6")}
    {fill("M12 17.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z")}
  </>
);

/** A resistance: its element small inside a shield's outline */
const shielded = (inner: ReactElement) => (
  <>
    <path d={SHIELD} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    <g transform="translate(5.1 4.6) scale(0.575)">{inner}</g>
  </>
);

/**
 * Each colour's magics in MAGIC_GLYPH_* order (blakston.khd lists them; each item attribute's
 * viMagicGlyph or GetMagicGlyph says which it is). The weapon's own magic comes first and its
 * resistance after; elemental weapons and resistances take their element's colour.
 */
const GLYPHS: Record<number, readonly ReactElement[]> = {
  [C.CRIMSON]: [DROP, HEART], // vampiric, vitality
  [C.BLUE]: [SWIRL], // mana siphon
  [C.YELLOW]: [BOLT, EYE, shielded(BOLT)], // shocking, blinding, storm resistance
  [C.TEAL]: [SNOWFLAKE, HAND, shielded(SNOWFLAKE)], // icy, holding, frost resistance
  [C.GREEN]: [FLASK, FANG, shielded(FLASK)], // acidic, venom, acid resistance
  [C.SILVER]: [WARD, SEVERED_CHAIN], // warding, purging
  [C.VIOLET]: [SKULL, SPARKLES, TARGET], // unholy, sorcery, focus
  [C.GOLD]: [STAR4, SWORDS, BULB, TORCH], // enchanted, expert, glowing, ceremonial
  [C.AMBER]: [HAMMER, ANVIL, STAR5, COMPASS], // durable, indestructible, transcendent, adventuring
  [C.ORANGE]: [FLAME, shielded(FLAME)], // fiery, fire resistance
  [C.WHITE]: [ANKH], // holy
  [C.DUKE]: [TOWER],
  [C.PRINCESS]: [CROWN],
  [C.REBEL]: [GAUNTLET],
  [C.NECROMANCER]: [HEADSTONE],
};

/** Discs too pale for a white glyph take a dark one instead */
const PALE = new Set<number>([C.WHITE, C.SILVER]);

/** How an object's mark is drawn, or null for an object with no magic (or no flags, such as a spell) */
export interface MagicMark {
  /** The disc's colour */
  colour: string;
  /** The glyph's colour on it */
  ink: string;
  glyph: ReactElement;
  /** What it is, for the tests: "?" while hidden, else "<colour>:<glyph>" */
  key: string;
}

export function magicMark(object: unknown): MagicMark | null {
  const flags = (object as { flags?: unknown } | null)?.flags;
  if (typeof flags !== "number") return null;
  const show = magicShow(flags);
  if (show === MAGIC_SHOW.NONE) return null;
  if (show === MAGIC_SHOW.UNREVEALED) {
    return { colour: dim(MAGIC_COLOURS[C.NONE]), ink: "#fff", glyph: QUESTION, key: "?" };
  }
  const colour = magicColour(flags);
  const set = GLYPHS[colour];
  // magic with no colour of its own: a plain sparkle on grey
  if (!set) return { colour: dim(MAGIC_COLOURS[C.NONE]), ink: "#fff", glyph: STAR4, key: "0:0" };
  const index = Math.min(magicGlyph(flags), set.length - 1);
  const pale = PALE.has(colour);
  return {
    colour: pale ? MAGIC_COLOURS[colour] : dim(MAGIC_COLOURS[colour] ?? MAGIC_COLOURS[C.NONE]),
    ink: pale ? "#262626" : "#fff",
    glyph: set[index],
    key: `${colour}:${index}`,
  };
}

/** A colour darkened a little, so a white glyph reads on it (yellow, gold) */
const dim = (hex: string): string => `color-mix(in srgb, ${hex} 78%, black)`;

/** The mark itself, in the icon's bottom-right corner (styles.css .magic-mark) */
export function MagicMarkBadge({ mark }: { mark: MagicMark }) {
  return (
    <span className="magic-mark" style={{ background: mark.colour, color: mark.ink }} aria-hidden="true">
      <svg viewBox="0 0 24 24">{mark.glyph}</svg>
    </span>
  );
}
