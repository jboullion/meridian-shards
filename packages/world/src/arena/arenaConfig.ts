// Ours (docs/adr/0007-arena.md): everything about the arena that can be changed without code. The
// defaults are here; the relay reads an arena.json (ARENA_CONFIG) and merges it over them with
// `readArenaConfig`, which keeps only what it understands and says what it threw away.

import { ARENA_ARCHETYPES, ARENA_ARMOUR, ARENA_SPELLS, ARENA_WEAPONS, type ArchetypeDef, type ArenaSpellDef, type ArenaWeaponDef } from "./arenaData.ts";

export interface ArenaConfig {
  /** How many fight a round (picked anew each round) */
  floor: [number, number];
  /** At least this many of a round's fighters are casters, when the roster has them (so there's magic to see) */
  minCasters: number;
  /** People always in the stands while it's open (the beaten besides) */
  spectators: number;
  /** Fighters in a season's roster */
  rosterSize: number;
  /** How many of each archetype the roster has, against the others */
  mix: Record<string, number>;
  /** The game hours it's open, from and to (22 to 6 shut, as before); from after to runs past midnight */
  open: [number, number];
  /** A round that goes on this long ends: the healthiest left wins */
  roundMaxMs: number;
  /** The winner's moment, and the wait for the next lot (ms) */
  victoryMs: [number, number];
  restMs: [number, number];
  /** The beaten watch from the stands this long (ms) */
  beatenWatchMs: [number, number];
  /**
   * The walls' lives against the server's (theirs are 20 s to over 4 minutes, which would choke
   * the floor): each wall lasts its Kod duration times this
   */
  fieldLife: number;
  /** Every hurt times this (to make fights shorter or longer) */
  damageScale: number;
  spells: Record<string, ArenaSpellDef>;
  weapons: Record<string, ArenaWeaponDef>;
  armour: typeof ARENA_ARMOUR;
  archetypes: Record<string, ArchetypeDef>;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  floor: [4, 8],
  minCasters: 2,
  spectators: 14,
  rosterSize: 24,
  mix: { warrior: 3, knight: 2, duelist: 2, kraanan: 2, faren: 2, qor: 1.5, shalille: 1.5, riija: 1.5 },
  open: [6, 22],
  roundMaxMs: 4 * 60_000,
  victoryMs: [5000, 7000],
  restMs: [2000, 4000],
  beatenWatchMs: [60_000, 120_000],
  fieldLife: 0.15,
  damageScale: 1,
  spells: ARENA_SPELLS,
  weapons: ARENA_WEAPONS,
  armour: ARENA_ARMOUR,
  archetypes: ARENA_ARCHETYPES,
};

/**
 * The Arena of Death's (docs/adr/0019-arena-bouts.md): one against one, its elites only, and open
 * at night, while the Arena of Kraanan is shut
 */
export const DEATH_ARENA_CONFIG: ArenaConfig = {
  ...DEFAULT_ARENA_CONFIG,
  floor: [2, 2],
  minCasters: 0,
  spectators: 10,
  rosterSize: 16,
  mix: { gladiator: 4, qorbattle: 2, farenbattle: 2, riijabattle: 2 },
  open: [22, 6],
  roundMaxMs: 3 * 60_000,
};

/** Whether an arena is open at a game hour (null: as by day) */
export function arenaOpenAt(open: readonly [number, number], hour: number | null): boolean {
  if (hour === null) return open[0] < open[1] || open[0] === open[1];
  return open[0] <= open[1] ? hour >= open[0] && hour < open[1] : hour >= open[0] || hour < open[1];
}

/** Maps whose entries may be added to: a new entry takes what it leaves out from the first default */
const OPEN_MAPS = new Set(["spells", "weapons", "armour", "archetypes", "mix"]);

type Json = unknown;

const isObject = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/** `over` merged into `base`, by base's shape: numbers stay numbers, lists keep their length, unknown keys go */
function merge(base: Json, over: Json, path: string, errors: string[], open = false): Json {
  if (over === undefined) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return void errors.push(`${path}: expected a list`), base;
    // Lists of names (weapons) take any length; other lists of plain values are tuples of fixed
    // length ([low, high], [spell, weight]); lists of tuples take any length of the sample's shape
    const names = (v: Json[]) => v.every((x) => typeof x === "string");
    const pair = (x: Json) => Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && typeof x[1] === "number";
    if (!base.length) {
      if (names(over) || over.every(pair)) return over;
      return void errors.push(`${path}: expected names or [name, weight] pairs`), base;
    }
    if (names(base)) return names(over) ? over : (errors.push(`${path}: expected names`), base);
    if (base.every((v) => typeof v !== "object")) {
      if (over.length !== base.length) return void errors.push(`${path}: expected ${base.length} values`), base;
      return base.map((b, i) => merge(b, over[i], `${path}[${i}]`, errors));
    }
    const sample = base[0];
    return over.map((v, i) => merge(sample, v, `${path}[${i}]`, errors));
  }
  if (isObject(base)) {
    if (!isObject(over)) return void errors.push(`${path}: expected an object`), base;
    const out: Record<string, Json> = structuredClone(base);
    // An open map's entries may use any field one of them has (a spell's `wall`, another's `curse`)
    const union: Record<string, Json> = open ? Object.assign({}, ...Object.values(base).filter(isObject).reverse()) : {};
    for (const [k, v] of Object.entries(over)) {
      const p = path ? `${path}.${k}` : k;
      if (open) {
        const own = base[k];
        if (own !== undefined && !isObject(own)) {
          out[k] = merge(own, v, p, errors);
          continue;
        }
        // A new entry takes what it leaves out from the first default
        const sample = (own ?? Object.values(base)[0]) as Json;
        if (sample === undefined) {
          errors.push(`${p}: can't add here`);
          continue;
        }
        if (!isObject(sample)) {
          out[k] = merge(sample, v, p, errors);
          continue;
        }
        const wide = { ...union, ...sample };
        const got = merge(wide, v, p, errors) as Record<string, Json>;
        for (const f of Object.keys(got)) if (!(f in sample) && !(isObject(v) && f in v)) delete got[f];
        out[k] = got;
      } else if (k in base) out[k] = merge(base[k], v, p, errors, OPEN_MAPS.has(k));
      else errors.push(`${p}: unknown`);
    }
    return out;
  }
  if (typeof base === "number") {
    if (typeof over !== "number" || !Number.isFinite(over)) return void errors.push(`${path}: expected a number`), base;
    return over;
  }
  if (typeof base === "string") {
    if (typeof over !== "string") return void errors.push(`${path}: expected text`), base;
    return over;
  }
  if (typeof base === "boolean") {
    if (typeof over !== "boolean") return void errors.push(`${path}: expected true or false`), base;
    return over;
  }
  return base;
}

/** What's wrong with a merged config that the shapes alone don't catch */
function check(c: ArenaConfig, errors: string[]): ArenaConfig {
  const clampPair = (p: [number, number], lo: number, hi: number, name: string): [number, number] => {
    const a = Math.max(lo, Math.min(hi, p[0])),
      b = Math.max(a, Math.min(hi, p[1]));
    if (a !== p[0] || b !== p[1]) errors.push(`${name}: kept to ${lo}-${hi}, low to high`);
    return [a, b];
  };
  c.floor = clampPair(c.floor, 2, 12, "floor");
  c.minCasters = Math.max(0, Math.min(c.floor[1], Math.round(c.minCasters)));
  c.spectators = Math.max(0, Math.min(40, Math.round(c.spectators)));
  c.rosterSize = Math.max(c.floor[1] + 2, Math.min(64, Math.round(c.rosterSize)));
  // Either way round: from after to is open across midnight
  const hours = c.open.map((h) => Math.max(0, Math.min(24, Math.round(h))));
  if (hours[0] !== c.open[0] || hours[1] !== c.open[1]) errors.push("open: kept to whole hours 0-24");
  c.open = [hours[0], hours[1]];
  c.fieldLife = Math.max(0.02, Math.min(2, c.fieldLife));
  c.damageScale = Math.max(0.1, Math.min(10, c.damageScale));
  for (const [k, a] of Object.entries(c.archetypes)) {
    a.weapons = a.weapons.filter((w) => {
      if (c.weapons[w]) return true;
      errors.push(`archetypes.${k}.weapons: no weapon "${w}"`);
      return false;
    });
    a.spells = a.spells.filter(([s]) => {
      if (c.spells[s]) return true;
      errors.push(`archetypes.${k}.spells: no spell "${s}"`);
      return false;
    });
    a.armour = a.armour.filter(([s]) => {
      if (!s || c.armour[s]) return true;
      errors.push(`archetypes.${k}.armour: no armour "${s}"`);
      return false;
    });
    if (a.role === "fighter" && !a.weapons.length) a.weapons = ["longsword"];
  }
  for (const k of Object.keys(c.mix))
    if (!c.archetypes[k]) {
      errors.push(`mix.${k}: no such archetype`);
      delete c.mix[k];
    }
  if (!Object.keys(c.mix).length) c.mix = { ...DEFAULT_ARENA_CONFIG.mix };
  return c;
}

/** The defaults (`defaults`, the Arena of Kraanan's unless said) with `json` (arena.json, parsed) merged over them, and what couldn't be used */
export function readArenaConfig(json: unknown, defaults: ArenaConfig = DEFAULT_ARENA_CONFIG): { config: ArenaConfig; errors: string[] } {
  const errors: string[] = [];
  const base = structuredClone(defaults);
  const merged = json === undefined || json === null ? base : (merge(base, json, "", errors) as ArenaConfig);
  return { config: check(merged, errors), errors };
}
