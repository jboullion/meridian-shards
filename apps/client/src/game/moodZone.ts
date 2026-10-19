// Ours: which of the moods' cycles a room follows (docs/adr/0017-lighting-moods.md), after the UE
// remaster's zone rules (meridian-unreal tools/world/zone_configs.py): a room mostly under open
// sky is outdoor; caves, dungeons, sewers and crypts are underground; inns have their own warm
// light; everything else is an interior.

import type { Room } from "@shards/formats";
import type { MoodCycleName } from "@shards/render";
import { AMBIENT_ROOMS, habitatOf } from "@shards/world";

/** Rooms that need a word: the Underworld has its own mood */
const OVERRIDES: Record<string, MoodCycleName> = {
  "uworld.roo": "underworld",
};

/** A room at least this much under open sky (by floor area) is outdoor (zone_configs.py's half) */
const OUTDOOR_SKY = 0.5;

/** How much of the room's floor (by area) is under open sky, 0..1 */
export function skyFraction(room: Room): number {
  let sky = 0,
    all = 0;
  for (const n of room.nodes) {
    if (n.type !== "leaf" || !n.sector || n.points.length < 3) continue;
    let a = 0;
    for (let i = 0; i < n.points.length; i++) {
      const p = n.points[i],
        q = n.points[(i + 1) % n.points.length];
      a += p.x * q.y - q.x * p.y;
    }
    a = Math.abs(a) / 2;
    all += a;
    if (room.sectors[n.sector - 1]?.ceilingType === 0) sky += a;
  }
  return all > 0 ? sky / all : 0;
}

/** The moods' cycle for a room, by its file (lower case), shape and terrain */
export function zoneKind(room: Room, file: string, terrain: readonly string[] | undefined): MoodCycleName {
  const named = OVERRIDES[file];
  if (named) return named;
  if (AMBIENT_ROOMS[file]?.kind === "inn") return "inn";
  if (skyFraction(room) >= OUTDOOR_SKY) return "outdoor";
  const habitat = habitatOf(file, terrain)?.name;
  if (habitat === "cave" || habitat === "dungeon" || habitat === "sewer" || habitat === "crypt") return "underground";
  if ((terrain ?? []).includes("NECROPOLIS") || /crypt|sew/.test(file)) return "underground";
  return "interior";
}
