// Ours: which rooms get ambient life, and how much (before the Ambient Life setting scales it).
// Towns get townsfolk walking from door to door, and guards pacing a beat; inns and taverns get
// patrons who stand about, chat and now and then leave; the castles get knights and courtiers,
// and the arena fighters, who spar when no one's fighting for real. Rooms not listed get nothing.

import type { Place } from "./chatter.ts";
import { C, type Faction } from "./townsfolk.ts";

export type AmbientKind = "town" | "inn" | "castle" | "arena";

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
  /** The arena: mock bouts and spell duels on its floor */
  bouts?: boolean;
  /** The arena: people in the stands, always there (besides `count`) */
  spectators?: number;
}

const town = (count: number, place: Place, guards: number, livery: number): AmbientRoomSpec => ({ kind: "town", count, place, guards, livery });
const inn = (count: number, place?: Place): AmbientRoomSpec => ({ kind: "inn", count, place });
const castle = (count: number, faction: Faction, guards: number): AmbientRoomSpec => ({
  kind: "castle", count, faction, guards, place: faction === "duke" ? "blackstone" : "castle",
});

/** By room file (lower case) */
export const AMBIENT_ROOMS: Record<string, AmbientRoomSpec> = {
  // Tos
  "tos.roo": town(12, "tos", 2, C.BLUE),
  "toseast.roo": town(6, "tos", 1, C.BLUE),
  "tosinn.roo": inn(5, "tos"),
  "tostavern.roo": inn(4, "tos"),
  // The Arena of Kraanan and its foyer
  "tosarena.roo": { kind: "arena", count: 8, place: "arena", bouts: true, spectators: 14 },
  "tosaren2.roo": { kind: "arena", count: 6, place: "arena" },
  // Barloque
  "barln.roo": town(14, "barloque", 2, C.PURPLE),
  "barls.roo": town(14, "barloque", 2, C.PURPLE),
  "barlport.roo": town(9, "barloque", 1, C.PURPLE),
  "barinn.roo": inn(5, "barloque"),
  "barlbar1.roo": inn(4, "barloque"),
  // Blackstone Keep, the Duke's: its courtyard, hall, chambers and feast hall
  "duke1.roo": castle(8, "duke", 3),
  "duke2.roo": castle(7, "duke", 2),
  "duke3.roo": castle(5, "duke", 1),
  "duke4.roo": castle(8, "duke", 1),
  // Bourgeois Castle, the Princess's: the grounds, the banquet hall, the assembly chamber and the library
  "castle2b.roo": castle(9, "princess", 3),
  "castle2a.roo": castle(8, "princess", 1),
  "castle2c.roo": castle(6, "princess", 1),
  "castle2d.roo": castle(5, "princess", 0),
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
/** Castles and the arena keep their people by day, fewer at night */
const COURT_BY_HOUR = [0.5, 0.4, 0.4, 0.4, 0.4, 0.5, 0.7, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5];

/** The population scale for a kind of room at a game hour (null: not known, as by day) */
export function busyAt(kind: AmbientKind, hour: number | null): number {
  if (hour === null) return 1;
  const table = kind === "town" ? TOWN_BY_HOUR : kind === "inn" ? INN_BY_HOUR : COURT_BY_HOUR;
  return table[((Math.floor(hour) % 24) + 24) % 24];
}

/** Rain and snow: fewer out in the streets, and the inns fuller */
export function weatherScale(kind: AmbientKind, weather: "rain" | "snow" | null): number {
  if (!weather) return 1;
  if (kind === "inn") return 1.2;
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
