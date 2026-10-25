// Ours (spell revamp phase 9, visuals): a spell effect our server asks us to draw (UC_SPELL_FX,
// shards-server room.kod SendSpellFx, sent by spell.kod SendSpellFx). The client draws it with
// Enhanced Visuals on (render spellEffects.ts) and ignores it otherwise.

import { objId, type ByteReader } from "@shards/protocol";

/** What to draw (blakston.khd SPELLFX_*) */
export const SPELL_FX = {
  /** A hit on the target */
  IMPACT: 1,
  /** Life drawn from the target back to the source (Vampiric Drain) */
  DRAIN: 2,
  /** A glow about the caster */
  CAST: 3,
  /** A pulse about the target: a blessing */
  BUFF: 4,
  /** A darker pulse: a harmful enchantment */
  CURSE: 5,
  /** The whole room lights up (Lightning Bolt) */
  ROOM_FLASH: 6,
  /** Dust rises about the source (Earthquake) */
  QUAKE: 7,
  /** Healing light about the target */
  HEAL: 8,
} as const;

export interface SpellFx {
  kind: number;
  /** Object ids, 0 for none */
  source: number;
  target: number;
  /** 5:5:5, as lights are (objectLighting.ts lightColor) */
  color: number;
  /** 1 small (a song's pulse), 2 normal, 3 large */
  size: number;
  /** Ours (25 October): the particles' shape (SPELL_FX_LOOK); 0 plain dots (and from older servers) */
  look: number;
}

/** UC_SPELL_FX's look (blakston.khd SPELLFX_LOOK_*): a school, or the damage's element */
export const SPELL_FX_LOOK = {
  PLAIN: 0,
  SHALILLE: 1,
  QOR: 2,
  ACID: 3,
  KRAANAN: 4,
  FIRE: 5,
  ICE: 6,
  LIGHTNING: 7,
  RIIJA: 8,
  JALA: 9,
  EARTH: 10,
} as const;

/** UC_SPELL_FX: kind (u8), source (u32), target (u32), colour (u16), size (u8), look (u8, when sent) */
export function readSpellFx(r: ByteReader): SpellFx {
  const kind = r.u8();
  const source = objId(r.u32());
  const target = objId(r.u32());
  const color = r.u16();
  const size = r.u8();
  const look = r.remaining > 0 ? r.u8() : 0;
  return { kind, source, target, color, size, look };
}
