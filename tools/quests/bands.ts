// The monster-by-band table (docs/adr/0009-quests.md 8): which creatures live near which hub, and
// which health they're worth fighting at, for choosing a band's quest targets. It reads the Kod
// (spawn lists, monster levels, room exits) and writes docs/research/monster-bands.md.
//
//   npm run quests:bands
//
// A room belongs to the hub its exits reach in the fewest steps. A monster gives full XP while
// the player's base health is below its viLevel (tools/quests/xp.ts), so its band ends there.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isA, rawLookup } from "../assets/kodClasses.ts";
import { buildRoomLinks, buildRoomList, type KodFile } from "../assets/roomLinks.ts";
import { nameOf, readKod, worldFrom, type World } from "./world.ts";
import { QUEST_SHARE, xpBetween, xpToNext } from "./xp.ts";

/** The hubs, by their town's room (the guide's, 2026-10-17) */
export const HUBS: { name: string; rid: number; stage: string }[] = [
  { name: "Raza", rid: 300, stage: "early" },
  { name: "Marion", rid: 200, stage: "early" },
  { name: "Cor Noth", rid: 150, stage: "early" },
  { name: "Tos", rid: 50, stage: "mid (the Duke)" },
  { name: "Barloque", rid: 102, stage: "mid (the Princess)" },
  { name: "Jasper", rid: 350, stage: "mid (Jonas)" },
  { name: "Ko'catan", rid: 2000, stage: "late" },
  { name: "Brax", rid: 828, stage: "late" },
  { name: "Bergholt", rid: 2800, stage: "" },
];

/** Rooms set apart from the hubs: the death realm's copies of the world, the desert */
const apart = (rid: number): string | null => (rid >= 3000 && rid < 3100 ? "Death Realm" : rid >= 1500 && rid < 1700 ? "The desert" : null);

export interface BandRoom {
  rid: number;
  name: string;
  /** Exits between it and its hub; null when no way leads there */
  hops: number | null;
  monsters: string[];
}

export interface BandMonster {
  cls: string;
  name: string;
  /** viLevel; null when the Kod works it out */
  level: number | null;
  difficulty: number | null;
  /** Where it spawns: hub (or region) name -> room numbers */
  where: Map<string, number[]>;
}

export interface BandTable {
  regions: { name: string; stage: string; rooms: BandRoom[] }[];
  monsters: BandMonster[];
}

const num = (s: string | null): number | null => {
  const n = s === null ? NaN : Number(s.trim());
  return Number.isFinite(n) ? n : null;
};

export function bandTable(files: KodFile[], khd: string, w: World = worldFrom(files, khd)): BandTable {
  const list = buildRoomList(files, khd);
  const rooOf = new Map(list.map((r) => [r.rid, r.roo]));
  // The death realm's rooms share their originals' files: a file is its first room's
  const ridOf = new Map<string, number>();
  for (const r of list) if (!ridOf.has(r.roo)) ridOf.set(r.roo, r.rid);
  const links = buildRoomLinks(files, khd);

  // Hops from each hub to every room it reaches
  const dist = new Map<string, Map<number, number>>();
  for (const hub of HUBS) {
    const seen = new Map<number, number>();
    const start = rooOf.get(hub.rid);
    if (start) {
      const queue: [string, number][] = [[start, 0]];
      const done = new Set([start]);
      while (queue.length) {
        const [roo, d] = queue.shift()!;
        const rid = ridOf.get(roo);
        if (rid !== undefined && !apart(rid)) seen.set(rid, d);
        for (const next of links[roo] ?? []) {
          const nr = ridOf.get(next);
          if (done.has(next) || (nr !== undefined && apart(nr))) continue;
          done.add(next);
          queue.push([next, d + 1]);
        }
      }
    }
    dist.set(hub.name, seen);
  }

  const regions = new Map<string, { name: string; stage: string; rooms: BandRoom[] }>();
  const region = (name: string, stage = "") => {
    let r = regions.get(name);
    if (!r) regions.set(name, (r = { name, stage, rooms: [] }));
    return r;
  };
  for (const hub of HUBS) region(hub.name, hub.stage);

  const monsters = new Map<string, BandMonster>();
  for (const [rid, spawns] of [...w.spawns].sort((a, b) => a[0] - b[0])) {
    let home = apart(rid);
    let hops: number | null = null;
    if (!home) {
      for (const hub of HUBS) {
        const d = dist.get(hub.name)!.get(rid);
        if (d !== undefined && (hops === null || d < hops)) [home, hops] = [hub.name, d];
      }
    }
    home ??= "Not linked to a hub";
    region(home).rooms.push({ rid, name: w.rooms.get(rid) ?? "", hops, monsters: spawns });
    for (const cls of spawns) {
      if (!isA(w.classes, cls, "Monster")) continue;
      let m = monsters.get(cls);
      if (!m)
        monsters.set(
          cls,
          (m = {
            cls,
            name: nameOf(w, cls),
            level: num(rawLookup(w.classes, cls, "vilevel")),
            difficulty: num(rawLookup(w.classes, cls, "vidifficulty")),
            where: new Map(),
          }),
        );
      m.where.set(home, [...(m.where.get(home) ?? []), rid]);
    }
  }

  return {
    regions: [...regions.values()].filter((r) => r.rooms.length),
    monsters: [...monsters.values()].sort((a, b) => (a.level ?? 999) - (b.level ?? 999) || a.name.localeCompare(b.name)),
  };
}

/** The health a monster is worth fighting at: from 30 below its level (not under 20) to just under it */
export const bandOf = (level: number): [number, number] => [Math.max(20, level - 30), level - 1];

export function renderBands(t: BandTable, levelOf: (cls: string) => number | null): string {
  const out: string[] = [];
  const mon = (cls: string) => {
    const l = levelOf(cls);
    return `${cls} ${l ?? "?"}`;
  };
  out.push(
    "# Monsters by band",
    "",
    "Generated by `npm run quests:bands` (`tools/quests/bands.ts`) from the Kod: don't edit it by hand. For choosing quest targets band by band ([ADR 0009](../adr/0009-quests.md) 8).",
    "",
    "- **A monster's level** (`viLevel`) is the most it's worth: a kill gives about that much XP, and only while your base health is below it. **Worth fighting** below is from 30 under its level up to just under it.",
    "- **A room's hub** is the town its exits reach in the fewest steps (hops). The death realm and the desert are set apart.",
    "- Spawn lists only (`plMonsters`); bosses a room's Kod makes itself aren't listed.",
    "",
    "## XP by band",
    "",
    "The next point of health past h costs (h+1)² XP. A third of it is to come from quests.",
    "",
    "| Health | XP to cross | From quests (a third) | Kills of a monster 5 above the band's top |",
    "|---|---|---|---|",
  );
  for (let a = 20; a < 150; a += 10) {
    const xp = xpBetween(a, a + 10);
    out.push(`| ${a}-${a + 10} | ${xp.toLocaleString("en")} | ${Math.round(xp * QUEST_SHARE).toLocaleString("en")} | ${Math.round(xp / (a + 15)).toLocaleString("en")} |`);
  }
  out.push("", `One point at 20 costs ${xpToNext(20)}; at 50, ${xpToNext(50).toLocaleString("en")}; at 100, ${xpToNext(100).toLocaleString("en")}.`, "");

  out.push("## By hub", "");
  for (const r of t.regions) {
    out.push(`### ${r.name}${r.stage ? ` (${r.stage})` : ""}`, "", "| Room | Hops | Monsters (level) |", "|---|---|---|");
    for (const room of [...r.rooms].sort((a, b) => (a.hops ?? 99) - (b.hops ?? 99) || a.rid - b.rid))
      out.push(`| ${room.name || "?"} (${room.rid}) | ${room.hops ?? "-"} | ${room.monsters.map(mon).join(", ")} |`);
    out.push("");
  }

  out.push("## Monsters", "", "| Monster | Class | Level | Difficulty | Worth fighting at health | Where |", "|---|---|---|---|---|---|");
  for (const m of t.monsters) {
    const band = m.level === null ? "?" : bandOf(m.level).join("-");
    const where = [...m.where].map(([hub, rids]) => `${hub} (${rids.length})`).join(", ");
    out.push(`| ${m.name} | ${m.cls} | ${m.level ?? "?"} | ${m.difficulty ?? "-"} | ${band} | ${where} |`);
  }
  out.push("");
  return out.join("\n");
}

if (import.meta.main) {
  const kodRoot = resolve(import.meta.dirname, "../../server/src/kod");
  const { files, khd } = readKod(kodRoot);
  const w = worldFrom(files, khd);
  const t = bandTable(files, khd, w);
  const levels = new Map(t.monsters.map((m) => [m.cls, m.level]));
  const path = resolve(import.meta.dirname, "../../docs/research/monster-bands.md");
  writeFileSync(path, renderBands(t, (c) => levels.get(c) ?? num(rawLookup(w.classes, c, "vilevel"))));
  console.log(`monster bands: ${t.monsters.length} monsters in ${t.regions.length} regions; ${path}`);
}
