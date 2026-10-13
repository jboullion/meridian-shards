// Ours (docs/adr/0007-arena.md): the arena's fighters for a season, and their records. A season is a
// Meridian year: a game day is two real hours (system.kod SystemInitGameHour, util/system.kod:4361)
// and a year 240 of them (NewGameDay, :4480), so 20 real days. The relay can't read the server's
// year, so seasons count from a fixed day of our own. Each season's roster is made from the game
// server's name and the season's number, so it's the same wherever it's made.

import { personName } from "../ambient/names.ts";
import { fighterAppearance, mageAppearance, type Appearance } from "../ambient/townsfolk.ts";
import { seededRandom } from "../ambient/ambientLife.ts";
import type { ArenaConfig } from "./arenaConfig.ts";

/** A Meridian year in real ms: 240 game days of two hours */
export const SEASON_MS = 240 * 2 * 3600_000;
/** Season 1 began on 1 October 2026 (UTC) */
export const SEASON_EPOCH = Date.UTC(2026, 9, 1);

/** The season at a time (ms since 1970), from 1 */
export function seasonAt(now: number): number {
  return Math.max(1, Math.floor((now - SEASON_EPOCH) / SEASON_MS) + 1);
}

/** When a season began */
export function seasonStart(season: number): number {
  return SEASON_EPOCH + (season - 1) * SEASON_MS;
}

/** One of a season's fighters */
export interface RosterEntry {
  /** Their place in the roster (0-based), which records are kept by */
  id: number;
  name: string;
  /** The archetype's key (arenaData.ts ARENA_ARCHETYPES, or arena.json's) */
  arch: string;
  /** Their weapon (a key of the config's weapons), null for a caster */
  weapon: string | null;
  /** The spell they'd rather cast (a key of the config's spells), null for none */
  spell: string | null;
  look: Appearance;
}

/** A fighter's season so far */
export interface ArenaRecord {
  wins: number;
  losses: number;
  kills: number;
}

/** A season's champion: the most wins (fewest losses between equals) */
export interface ArenaChampion {
  season: number;
  name: string;
  arch: string;
}

/** FNV-1a */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

function weighted<T>(rand: () => number, list: readonly (readonly [T, number])[]): T {
  const total = list.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = rand() * total;
  for (const [v, w] of list) if ((r -= Math.max(0, w)) < 0) return v;
  return list[list.length - 1][0];
}

/** A season's fighters on a game server */
export function makeRoster(server: string, season: number, config: ArenaConfig): RosterEntry[] {
  const rand = seededRandom(hashText(`${server.toLowerCase()}|arena|${season}`));
  const mix = Object.entries(config.mix).filter(([k]) => config.archetypes[k]);
  const out: RosterEntry[] = [];
  const names = new Set<string>();
  for (let id = 0; id < config.rosterSize; id++) {
    const arch = weighted(rand, mix);
    const a = config.archetypes[arch];
    const female = rand() < (a.role === "mage" ? 0.45 : 0.4);
    const weapon = a.weapons.length ? a.weapons[Math.floor(rand() * a.weapons.length) % a.weapons.length] : null;
    const spell = a.spells.length ? weighted(rand, a.spells) : null;
    const armour = a.armour.length ? weighted(rand, a.armour) : "";
    const look =
      a.role === "mage"
        ? mageAppearance(rand, female)
        : fighterAppearance(rand, { armour, weapon: weapon ? config.weapons[weapon].overlay : undefined, shield: a.shield, helm: a.helm, female });
    let name = personName(rand, a.role, female);
    for (let k = 0; names.has(name) && k < 20; k++) name = personName(rand, a.role, female);
    names.add(name);
    out.push({ id, name, arch, weapon, spell, look });
  }
  return out;
}

/** Who won a season, from its records: the most wins, then the fewest losses, then the most kills */
export function championOf(roster: RosterEntry[], records: Record<number, ArenaRecord>, season: number): ArenaChampion | null {
  let best: RosterEntry | null = null;
  let bestRec: ArenaRecord | null = null;
  for (const r of roster) {
    const rec = records[r.id];
    if (!rec || rec.wins === 0) continue;
    if (!bestRec || rec.wins > bestRec.wins || (rec.wins === bestRec.wins && (rec.losses < bestRec.losses || (rec.losses === bestRec.losses && rec.kills > bestRec.kills)))) {
      best = r;
      bestRec = rec;
    }
  }
  return best ? { season, name: best.name, arch: best.arch } : null;
}
