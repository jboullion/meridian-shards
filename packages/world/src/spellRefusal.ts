// The server's refusals of a cast, for Study mode (ours; apps/client study.ts), which must tell
// "out of reagents" (stop and log off) from "out of mana" (rest) and "resting" (stand).
//
// spell.kod CanPayCosts / CanPayReagents send them with MsgSendUser, the spell's name (vrName, a
// resource) as the only parameter:
//   spell_insufficient_reagent = "You don't have the reagents to cast %s!"
//   spell_insufficient_magic   = "You don't have enough mana to cast %s!"
//   spell_no_rest              = "You can't cast spells while resting!"
// Matched loosely, on the English format string, in case the wording moves a little.

import type { ByteReader } from "@shards/protocol";

export type SpellRefusalReason = "reagents" | "mana" | "resting";

export interface SpellRefusal {
  reason: SpellRefusalReason;
  /** The spell's name, when the message gives it ("" when it doesn't) */
  spell: string;
}

const REFUSALS: [RegExp, SpellRefusalReason][] = [
  [/^You don't have the reagents? to cast %s/i, "reagents"],
  [/^You don't have enough mana to cast %s/i, "mana"],
  [/^You can't cast spells while resting/i, "resting"],
];

/**
 * The refusal, when `format` is one of the server's "can't cast" messages; `r` is at the
 * message's parameters (after the format id) and is read from.
 */
export function readSpellRefusal(format: string, r: ByteReader, lookup: (id: number) => string | undefined): SpellRefusal | null {
  const hit = REFUSALS.find(([re]) => re.test(format));
  if (!hit) return null;
  let spell = "";
  if (format.includes("%s")) {
    try {
      spell = lookup(r.u32()) ?? "";
    } catch {
      spell = "";
    }
  }
  return { reason: hit[1], spell };
}
