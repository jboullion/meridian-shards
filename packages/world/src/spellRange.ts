// Ours (spell revamp phase 9, V5): an area spell's reach, for our range rings (UC_SPELL_RANGE,
// shards-server spell.kod SendSpellRange). Sent to the caster alone: players see only their own
// rings. A song's ring is on from its start to its end, about whoever it's centred on; a
// preview answers our asking how far a spell we point at would reach (UC_SHARDS_OBJECT
// "range"). Drawn with Enhanced Visuals only (render rangeRings.ts).

import { objId, type ByteReader } from "@shards/protocol";

/** blakston.khd SPELLRANGE_* */
export const SPELL_RANGE = {
  /** How far a spell would reach if cast now, as asked */
  PREVIEW: 1,
  /** A song (a radius enchantment) starts: its ring follows its centre */
  ON: 2,
  /** And ends */
  OFF: 3,
} as const;

/** The server's fine units per square (blakston.khd FINENESS; ours are 1024) */
export const SERVER_FINENESS = 64;

export interface SpellRange {
  kind: number;
  /** The object the ring is about */
  source: number;
  /** The spell's object id */
  spell: number;
  /** Radii in our fine units (1024 a square); inner 0 for none (Earthquake's full damage) */
  radius: number;
  inner: number;
  /** 5:5:5, the spell's school's */
  color: number;
}

/** UC_SPELL_RANGE: kind (u8), source (u32), spell (u32), radius and inner (u16, the server's 64 a square), colour (u16) */
export function readSpellRange(r: ByteReader): SpellRange {
  const kind = r.u8();
  const source = objId(r.u32());
  const spell = objId(r.u32());
  const toOurs = 1024 / SERVER_FINENESS;
  const radius = r.u16() * toOurs;
  const inner = r.u16() * toOurs;
  const color = r.u16();
  return { kind, source, spell, radius, inner, color };
}

/** How long a preview may wait for its answer, ms (after which pointing again asks again) */
const ASK_AGAIN_MS = 3000;

/**
 * Our rings: the songs we sing, by spell, and what the spell we point at would reach. The
 * scene reads these each frame.
 */
export class SpellRanges {
  /** Songs on, by spell object id */
  readonly songs = new Map<number, SpellRange>();
  /** The spell we point at (a quick slot, the spell list), or null */
  pointed: number | null = null;
  /** Previews as answered, by spell (they change only with our spellpower: asked again each time) */
  private readonly previews = new Map<number, SpellRange>();
  private readonly asked = new Map<number, number>();

  /** UC_SPELL_RANGE */
  handle(r: SpellRange): void {
    if (r.kind === SPELL_RANGE.ON) this.songs.set(r.spell, r);
    else if (r.kind === SPELL_RANGE.OFF) this.songs.delete(r.spell);
    else if (r.kind === SPELL_RANGE.PREVIEW) this.previews.set(r.spell, r);
  }

  /**
   * We point at a spell (or at nothing): true when the server should be asked how far it
   * reaches now (not asked within the last few seconds)
   */
  point(spell: number | null, nowMs: number): boolean {
    this.pointed = spell;
    if (spell === null) return false;
    const last = this.asked.get(spell);
    if (last !== undefined && nowMs - last < ASK_AGAIN_MS) return false;
    this.asked.set(spell, nowMs);
    return true;
  }

  /** The ring for the spell we point at, if it's an area spell and the server has said */
  get preview(): SpellRange | null {
    return this.pointed === null ? null : (this.previews.get(this.pointed) ?? null);
  }

  clear(): void {
    this.songs.clear();
    this.previews.clear();
    this.asked.clear();
    this.pointed = null;
  }
}
