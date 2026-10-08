// Damage numbers over what we hit (ours: the original only prints the line in the text window).
//
// battler.kod AssessHit tells the attacker "Your mace wounds the rat for 7 damage." with
// battler_attacker_hit (the target is a player, its name a %q string) or battler_attacker_hit_mob
// (a monster, its name a resource). Melee, ranged weapons and attack spells (atakspel.kod) all
// come this way. The parameters, in order: colour, weapon, damage word, article ("the "), name,
// damage (damage / 100), colour. Misses, kills and hits too weak to hurt use other formats.

import type { ByteReader } from "@shards/protocol";

/** battler_attacker_hit(_mob): "%sYour %s %s %s%q for ~k~B%i~B%s damage." */
const ATTACKER_HIT = /^%sYour %s %s %s%([qs]) for (?:~.)*%i(?:~.)*%s damage\.$/;

export interface DamageDealt {
  /** The target's name, without the article ("rat", or a player's name) */
  name: string;
  damage: number;
}

/**
 * The damage we did, when `format` is one of our hit messages; `r` is at the message's
 * parameters (after the format id) and is read from.
 */
export function readDamageDealt(format: string, r: ByteReader, lookup: (id: number) => string | undefined): DamageDealt | null {
  const m = ATTACKER_HIT.exec(format);
  if (!m) return null;
  try {
    r.u32(); // colour
    r.u32(); // weapon ("mace", "punch", a spell's attack name)
    r.u32(); // damage word ("wounds")
    r.u32(); // article
    const name = m[1] === "q" ? r.string() : (lookup(r.u32()) ?? "");
    const damage = r.i32();
    return name ? { name, damage } : null;
  } catch {
    return null;
  }
}
