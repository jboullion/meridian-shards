// Ours: which rooms get ambient life, and how much (before the Ambient Life setting scales it).
// Towns get townsfolk walking from door to door, and guards pacing a beat; inns and taverns get
// patrons who stand about, chat and now and then leave; the castles get knights and courtiers,
// the arena its fights (its own sim: arena/), and the city's shops customers who come in, look
// about a while and go. Rooms not listed get nothing.

import type { Place } from "./chatter.ts";
import { C, type Faction } from "./townsfolk.ts";

export type AmbientKind = "town" | "inn" | "castle" | "arena" | "shop";

export interface AmbientRoomSpec {
  kind: AmbientKind;
  /** How many at the Normal setting (guards besides) */
  count: number;
  /** For what they say */
  place?: Place;
  /** Towns: guards pacing a beat in the town's colours; castles: knights standing watch */
  guards?: number;
  /** Towns: the guards' colour (blakston.khd XLAT_TO_*) */
  livery?: number;
  /** Castles: whose (the knights' shields) */
  faction?: Faction;
  /** The arena's floor: its fights are the arena sim's (arena/arenaSim.ts), watched by everyone alike */
  arena?: boolean;
}

/**
 * Rooms much bigger than others of their kind (the Bhrama & Falcon is a hall of an inn): their
 * crowd is the kind's times this, so they don't look empty (2 still left the Bhrama & Falcon's
 * hall feeling empty by day: 2026-10-14)
 */
export const BIG_ROOM = 4;

const town = (count: number, place: Place, guards: number, livery: number): AmbientRoomSpec => ({ kind: "town", count, place, guards, livery });
/** `size`: 1, or BIG_ROOM for a big one */
const inn = (count: number, place?: Place, size = 1): AmbientRoomSpec => ({ kind: "inn", count: count * size, place });
const castle = (count: number, faction: Faction, guards: number): AmbientRoomSpec => ({
  kind: "castle", count, faction, guards, place: faction === "duke" ? "blackstone" : "castle",
});
const shop = (count: number, place: Place): AmbientRoomSpec => ({ kind: "shop", count, place });

/** By room file (lower case) */
export const AMBIENT_ROOMS: Record<string, AmbientRoomSpec> = {
  // Tos
  "tos.roo": town(12, "tos", 2, C.BLUE),
  "toseast.roo": town(6, "tos", 1, C.BLUE),
  "tosinn.roo": inn(5, "tos"),
  "tostavern.roo": inn(4, "tos"),
  // The Arena of Kraanan and its foyer
  "tosarena.roo": { kind: "arena", count: 0, place: "arena", arena: true },
  "tosaren2.roo": { kind: "arena", count: 6, place: "arena" },
  // Barloque
  "barln.roo": town(14, "barloque", 2, C.PURPLE),
  "barls.roo": town(14, "barloque", 2, C.PURPLE),
  "barlport.roo": town(9, "barloque", 1, C.PURPLE),
  "barinn.roo": inn(5, "barloque"),
  // The Bhrama & Falcon: much bigger than the other inns
  "barlbar1.roo": inn(4, "barloque", BIG_ROOM),
  // Blackstone Keep, the Duke's: its courtyard, hall, chambers and feast hall. Few knights; the
  // court mostly nobles
  "duke1.roo": castle(10, "duke", 1),
  "duke2.roo": castle(9, "duke", 1),
  "duke3.roo": castle(6, "duke", 0),
  "duke4.roo": castle(10, "duke", 0),
  // Bourgeois Castle, the Princess's: the grounds, the banquet hall, the assembly chamber and the library
  "castle2b.roo": castle(11, "princess", 1),
  "castle2a.roo": castle(10, "princess", 0),
  "castle2c.roo": castle(7, "princess", 0),
  "castle2d.roo": castle(6, "princess", 0),
  // Marion
  "marion.roo": town(12, "marion", 2, C.GREEN),
  "marinn.roo": inn(5, "marion"),
  // Jasper
  "jaseast.roo": town(7, "jasper", 1, C.RED),
  "jaswest.roo": town(9, "jasper", 1, C.RED),
  "jasinn.roo": inn(4, "jasper"),
  "jastavrn.roo": inn(4, "jasper"),
  // Cor Noth
  "cornoth.roo": town(12, "cornoth", 2, C.DGREEN),
  "corinn.roo": inn(5, "cornoth"),
  // Raza
  "raza.roo": town(7, "raza", 1, C.GRAY),
  "razainn.roo": inn(4, "raza"),
  "razabar.roo": inn(3, "raza"),
  // Ko'catan
  "settle1.roo": town(8, "kocatan", 1, C.YELLOW),
  "kocinn.roo": inn(5, "kocatan"),
  "koctav.roo": inn(4, "kocatan"),
  // Bergensdorf and Jixa
  "bergcity.roo": town(8, "bergen", 1, C.SKY),
  "berginn.roo": inn(4, "bergen"),
  "jixa.roo": town(6, "jixa", 1, C.BLACK),
  "jixa_inn.roo": inn(4, "jixa"),
  // The cities' shops, banks and adventurers' halls: a customer or two
  "tossmith.roo": shop(2, "tos"),
  "tosapoth.roo": shop(2, "tos"),
  "tosbank.roo": shop(3, "tos"),
  "toshall.roo": shop(2, "tos"),
  "barsmith.roo": shop(2, "barloque"),
  "barapoth.roo": shop(2, "barloque"),
  "barmerch.roo": shop(2, "barloque"),
  "barhall.roo": shop(2, "barloque"),
  "barlmarket.roo": shop(5, "barloque"),
  "marsmith.roo": shop(2, "marion"),
  "marhall.roo": shop(2, "marion"),
  "marheal.roo": shop(2, "marion"),
  "jassmith.roo": shop(2, "jasper"),
  "jasstore.roo": shop(2, "jasper"),
  "jasbank.roo": shop(3, "jasper"),
  "jashall.roo": shop(2, "jasper"),
  "corgroc.roo": shop(2, "cornoth"),
  "cortail.roo": shop(2, "cornoth"),
  "corhall.roo": shop(2, "cornoth"),
  "razasmith.roo": shop(2, "raza"),
  "razaapoth.roo": shop(2, "raza"),
  "razabank.roo": shop(2, "raza"),
  "kocapoth.roo": shop(2, "kocatan"),
  "kocstore.roo": shop(2, "kocatan"),
  "koctail.roo": shop(2, "kocatan"),
  "kocblack.roo": shop(2, "kocatan"),
  "bergsmith.roo": shop(2, "bergen"),
  "bergstore.roo": shop(2, "bergen"),
  "bergbank.roo": shop(2, "bergen"),
  "berghall.roo": shop(2, "bergen"),
  "bergauc.roo": shop(3, "bergen"),
  "jixa_smith.roo": shop(2, "jixa"),
  "jixa_hall.roo": shop(2, "jixa"),
};

/** The Ambient Life setting's population scale */
export const AMBIENT_SCALE = { off: 0, few: 0.5, normal: 1, many: 2 } as const;
export type AmbientLevel = keyof typeof AMBIENT_SCALE;

/**
 * How busy a room is by the game hour (0-23), against its count: the streets empty at night and
 * the inns fill in the evening. A game day is two real hours, an hour five minutes (system.kod
 * SystemInitGameHour).
 */
const TOWN_BY_HOUR = [0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.55, 0.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.75, 0.55, 0.4, 0.3, 0.25];
const INN_BY_HOUR = [0.8, 0.6, 0.4, 0.4, 0.4, 0.4, 0.5, 0.5, 0.5, 0.7, 0.7, 0.7, 0.8, 0.7, 0.7, 0.7, 0.7, 0.9, 1.2, 1.2, 1.2, 1.2, 1.2, 1];
/** Castles keep their people by day, fewer at night */
const COURT_BY_HOUR = [0.5, 0.4, 0.4, 0.4, 0.4, 0.5, 0.7, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5];
/** The arena is shut from 22 to 6: nobody on the floor, in the stands or the foyer */
const ARENA_BY_HOUR = [0, 0, 0, 0, 0, 0, 0.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0, 0];

/** Whether the arena is shut at a game hour */
export function arenaClosed(hour: number | null): boolean {
  return hour !== null && ARENA_BY_HOUR[((Math.floor(hour) % 24) + 24) % 24] === 0;
}

/** The population scale for a kind of room at a game hour (null: not known, as by day) */
export function busyAt(kind: AmbientKind, hour: number | null): number {
  if (hour === null) return 1;
  const table = kind === "town" || kind === "shop" ? TOWN_BY_HOUR : kind === "inn" ? INN_BY_HOUR : kind === "arena" ? ARENA_BY_HOUR : COURT_BY_HOUR;
  return table[((Math.floor(hour) % 24) + 24) % 24];
}

/** Rain and snow: fewer out in the streets, and the inns fuller */
export function weatherScale(kind: AmbientKind, weather: "rain" | "snow" | null): number {
  if (!weather) return 1;
  if (kind === "inn" || kind === "shop") return 1.2;
  if (kind === "town") return weather === "rain" ? 0.5 : 0.6;
  return 0.8;
}

/** Whether it's dark enough for a torch: system.kod's night (before 6, after 20) and the end of dusk */
export function torchHours(hour: number | null): boolean {
  return hour !== null && (hour >= 19 || hour < 6);
}

/**
 * The game hour from the sun's angle, which the server sends every player wherever they are and
 * moves every game hour (sun.kod NewGameHour: angle = ((hour + 19) % 24) * 130)
 */
export function hourFromSun(angle: number): number {
  return (Math.round(angle / 130) + 5) % 24;
}

/**
 * Doors to where townsfolk go on errands (the destination room's file): smiths, banks and vaults,
 * shops, apothecaries, healers, tailors, the markets
 */
export function isErrandRoom(file: string | null): boolean {
  return !!file && /(smith|bank|vault|apoth|merch|store|groc|tail|market|auc|heal|weaponsm)\.roo$/.test(file);
}
