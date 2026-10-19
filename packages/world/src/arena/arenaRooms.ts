// Ours (docs/adr/0007-arena.md, docs/adr/0019-arena-bouts.md): the rooms with an arena show, and
// what makes each its own: where its fighting floor is, its settings, and its season's key.
//
//   tosarena.roo        the Arena of Kraanan: melees of four to eight by day
//   tosarena_death.roo  the Arena of Death: duels of its elites, by night only
//
// arena.json (the relay's ARENA_CONFIG) changes the Arena of Kraanan with its fields as ever, and
// the Arena of Death with the same fields under "death".

import { FINENESS } from "@shards/formats";
import { cellAt, type NavGrid } from "../navGrid.ts";
import { DEATH_ARENA_CONFIG, DEFAULT_ARENA_CONFIG, readArenaConfig, type ArenaConfig } from "./arenaConfig.ts";

export interface ArenaRoomDef {
  /** A square on the fighting floor (Kod row, column): the floor is the nav area there; the stands are the other big ones */
  floorAt: { row: number; col: number };
  /** The settings before arena.json */
  defaults: ArenaConfig;
  /** Its settings in arena.json: at the top (null) or under this key */
  jsonKey: string | null;
  /** Its season (roster, records, champions) is kept under the game server's name and this */
  seasonKey: string;
}

export const ARENA_ROOM_DEFS: Readonly<Record<string, ArenaRoomDef>> = {
  "tosarena.roo": { floorAt: { row: 13, col: 13 }, defaults: DEFAULT_ARENA_CONFIG, jsonKey: null, seasonKey: "" },
  // The cage (server sector 2, SECTOR_ID_FIGHT: tosdeatharena.kod); the stands round it
  "tosarena_death.roo": { floorAt: { row: 10, col: 12 }, defaults: DEATH_ARENA_CONFIG, jsonKey: "death", seasonKey: "|death" },
};

/** The rooms with an arena */
export const ARENA_ROOM_FILES = Object.keys(ARENA_ROOM_DEFS);

/** The nav area of a room's fighting floor (1, the biggest, if its square is in none) */
export function arenaFloorArea(file: string, grid: NavGrid): number {
  const def = ARENA_ROOM_DEFS[file];
  if (!def) return 1;
  const cell = cellAt(grid, (def.floorAt.col - 0.5) * FINENESS, (def.floorAt.row - 0.5) * FINENESS);
  return (cell >= 0 && grid.area[cell]) || 1;
}

/** Every arena's settings from arena.json (parsed; undefined for none), and what couldn't be used */
export function readArenaConfigs(json: unknown): { configs: Record<string, ArenaConfig>; errors: string[] } {
  const configs: Record<string, ArenaConfig> = {};
  const errors: string[] = [];
  const top = json && typeof json === "object" && !Array.isArray(json) ? { ...(json as Record<string, unknown>) } : undefined;
  const keys = new Set(ARENA_ROOM_FILES.map((f) => ARENA_ROOM_DEFS[f].jsonKey).filter((k): k is string => !!k));
  const sub: Record<string, unknown> = {};
  if (top)
    for (const k of keys)
      if (k in top) {
        sub[k] = top[k];
        delete top[k];
      }
  for (const file of ARENA_ROOM_FILES) {
    const def = ARENA_ROOM_DEFS[file];
    const r = readArenaConfig(def.jsonKey ? sub[def.jsonKey] : top, def.defaults);
    configs[file] = r.config;
    errors.push(...r.errors.map((e) => (def.jsonKey ? `${def.jsonKey}.${e}` : e)));
  }
  return { configs, errors };
}
