// Ours (2026-11-01; docs/adr/0007-arena.md): the arena's spells drawn as a player's are (the spell
// revamp's effects, phase 9: spellFx.ts). Our server sends a player's cast as UC_SPELL_FX; the
// arena's fighters aren't the server's, so what to draw comes from the arena's own events instead:
// a glow about the caster (spell.kod CastSpell, SPELLFX_CAST), the room's flash for Lightning Bolt
// (lightnin.kod), and a curse's pulse about the one it lands on (debuff.kod DoSpell,
// SPELLFX_CURSE). A bolt's trail and landing burst come from its light, as a player's bolt's do.

import { SPELL_FX } from "../spellFx.ts";
import type { ArenaSpellDef } from "./arenaData.ts";
import type { ArenaEvent } from "./arenaWire.ts";

/** One effect to draw where an arena event happened */
export interface ArenaFx {
  /** SPELL_FX.CAST (about the caster) or SPELL_FX.CURSE (about the victim) */
  kind: typeof SPELL_FX.CAST | typeof SPELL_FX.CURSE;
  x: number;
  y: number;
  /** 5:5:5, and SPELL_FX_LOOK */
  color: number;
  look: number;
  /** The whole room lights up too (Lightning Bolt) */
  flash: boolean;
}

/** What to draw for an arena event: nothing, or one effect */
export function arenaSpellFx(e: ArenaEvent, spells: Readonly<Record<string, ArenaSpellDef>>): ArenaFx | null {
  if (e.type !== "cast" && e.type !== "impact") return null;
  const def = spells[e.spell];
  const fx = def?.fx;
  if (!fx) return null;
  if (e.type === "cast") return { kind: SPELL_FX.CAST, x: e.x, y: e.y, color: fx.color, look: fx.look, flash: fx.flash };
  // A curse that found its mark (an older gateway doesn't say: take it that it did)
  if (def.kind !== "curse" || e.hit === false) return null;
  return { kind: SPELL_FX.CURSE, x: e.x, y: e.y, color: fx.color, look: fx.look, flash: false };
}
