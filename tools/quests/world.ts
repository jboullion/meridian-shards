// What the quest generator checks quests against, read from the server's Kod: its classes (with
// names and pictures), the RID_ numbers, the rooms' names, and which rooms create which NPCs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { isA, lookup, rawLookup, readClasses, type KodClasses } from "../assets/kodClasses.ts";
import { buildRoomList, parseRids, type KodFile } from "../assets/roomLinks.ts";

export interface World {
  classes: KodClasses;
  /** Lower-case class name -> as declared (Kod ignores case) */
  byLower: Map<string, string>;
  /** RID_ name -> number */
  rids: Map<string, number>;
  /** Every NAME = number constant in the headers (QST_ID_*, HP*_CHAIN, ...) */
  consts: Map<string, number>;
  /** Room number -> name */
  rooms: Map<number, string>;
  /** Class -> the rooms whose Kod creates one (NPCs, bosses) */
  npcRooms: Map<string, number[]>;
  /** Room number -> the monster classes its spawn list (plMonsters) makes, its parents' when it has none */
  spawns: Map<number, string[]>;
}

/** The classes in a class's own `plMonsters = ...;` lines, or null when it has none */
function ownSpawns(src: string, byLower: Map<string, string>): string[] | null {
  const found = [...src.matchAll(/\bplMonsters\s*=\s*([^;]*);/g)];
  if (!found.length) return null;
  const out = new Set<string>();
  for (const m of found) for (const c of m[1]!.matchAll(/&(\w+)/g)) out.add(byLower.get(c[1]!.toLowerCase()) ?? c[1]!);
  return [...out];
}

export function worldFrom(files: KodFile[], khd: string): World {
  const classes = readClasses(files);
  const byLower = new Map([...classes.keys()].map((c) => [c.toLowerCase(), c]));
  const rids = parseRids(khd);
  const rooms = new Map(buildRoomList(files, khd).map((r) => [r.rid, r.name]));
  const npcRooms = new Map<string, number[]>();
  for (const info of classes.values()) {
    const ridName = /\bpiRoom_num\s*=\s*(RID_\w+)/.exec(info.src)?.[1];
    const rid = ridName ? rids.get(ridName) : undefined;
    if (rid === undefined) continue;
    for (const m of info.src.matchAll(/Create\(\s*&(\w+)/g)) {
      const cls = byLower.get(m[1]!.toLowerCase());
      if (!cls) continue;
      const list = npcRooms.get(cls) ?? [];
      if (!list.includes(rid)) list.push(rid);
      npcRooms.set(cls, list);
    }
  }
  // The god room makes the wanderers (the Minstrel, Maleval), who walk off: it's no one's room
  const godRoom = rids.get("RID_GODROOM");
  for (const [cls, list] of [...npcRooms]) {
    const kept = list.filter((rid) => rid !== godRoom);
    if (kept.length) npcRooms.set(cls, kept);
    else npcRooms.delete(cls);
  }
  // Spawn lists by room, inherited from the parent classes; the survival rooms make whatever
  // their waves call for, so they're no place to send anyone
  const spawns = new Map<number, string[]>();
  for (const [cls, info] of classes) {
    const ridName = /\bpiRoom_num\s*=\s*(RID_\w+)/.exec(info.src)?.[1];
    const rid = ridName ? rids.get(ridName) : undefined;
    if (rid === undefined || isA(classes, cls, "SurvivalRoom") || isA(classes, cls, "SurvivalArena")) continue;
    let list: string[] | null = null;
    for (let c: string | undefined = cls, n = 0; c && list === null && n < 30; n++) {
      const src = classes.get(c)?.src;
      if (!src) break;
      list = ownSpawns(src, byLower);
      c = classes.get(c)?.parent;
    }
    if (list?.length) spawns.set(rid, [...new Set([...(spawns.get(rid) ?? []), ...list])]);
  }
  const consts = new Map<string, number>();
  // Decimal or hex (the NODE_ bits are 0x0001...)
  for (const m of khd.matchAll(/^\s*(\w+)\s*=\s*(-?(?:0x[0-9a-fA-F]+|\d+))\b/gm)) if (!consts.has(m[1]!)) consts.set(m[1]!, Number(m[2]));
  return { classes, byLower, rids, consts, rooms, npcRooms, spawns };
}

/**
 * The rooms where the class (or one of its kinds, unless exact) is found: their spawn lists make
 * it, or their Kod creates one (a boss: Create(&GiantRatKing))
 */
export function spawnRooms(w: World, cls: string, exact: boolean): number[] {
  const matches = (c: string) => (exact ? c === cls : isA(w.classes, c, cls));
  const out = new Set<number>();
  for (const [rid, list] of w.spawns) if (list.some(matches)) out.add(rid);
  for (const [c, rids] of w.npcRooms) if (matches(c)) for (const rid of rids) out.add(rid);
  return [...out].filter((rid) => w.rooms.has(rid)).sort((a, b) => a - b);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".kod")
    .map((e) => join(e.parentPath, e.name));
}

/** The Kod under kodRoot (shards-server's kod/): its object files, and its headers joined */
export function readKod(kodRoot: string): { files: KodFile[]; khd: string } {
  // util/questdefs.kod is ours to write: left out, so a broken one never hides a class
  const files = walk(join(kodRoot, "object")).map((path) => ({ path, text: readFileSync(path, "latin1") }));
  const khd = readdirSync(join(kodRoot, "include"))
    .filter((f) => extname(f).toLowerCase() === ".khd")
    .map((f) => readFileSync(join(kodRoot, "include", f), "latin1"))
    .join("\n");
  return { files, khd };
}

/** The world from the Kod under kodRoot */
export function loadWorld(kodRoot: string): World {
  const { files, khd } = readKod(kodRoot);
  return worldFrom(files, khd);
}

/** The class as declared, or null */
export const classOf = (w: World, name: string): string | null => w.byLower.get(name.toLowerCase()) ?? null;

export const nameOf = (w: World, cls: string): string => lookup(w.classes, cls, "vrname") ?? cls;

export const iconOf = (w: World, cls: string): string | null => lookup(w.classes, cls, "vricon");

/** A monster that's an NPC (AI_NPC): townsfolk and the like, who can give quests */
export const isNpc = (w: World, cls: string): boolean =>
  isA(w.classes, cls, "Monster") && /\bAI_NPC\b/.test(rawLookup(w.classes, cls, "videfault_behavior") ?? "");

export const isMonster = (w: World, cls: string): boolean => isA(w.classes, cls, "Monster");

export const isItem = (w: World, cls: string): boolean => isA(w.classes, cls, "Item");

export const isFood = (w: World, cls: string): boolean => isA(w.classes, cls, "Food");

export const isNumberItem = (w: World, cls: string): boolean => isA(w.classes, cls, "NumberItem");

export const isSpell = (w: World, cls: string): boolean => isA(w.classes, cls, "Spell");

export const isSkill = (w: World, cls: string): boolean => isA(w.classes, cls, "Skill");
