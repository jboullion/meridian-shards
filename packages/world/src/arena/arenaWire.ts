// Ours (docs/adr/0007-arena.md 3): what the arena's sim tells those watching, whether it runs on the
// relay or (with no relay) in the client itself. The first message has everything (ArenaState);
// then a tick every 100 ms has what changed (ArenaTick). Positions are fine units, angles client
// angle units (4096 a turn), times the sim's clock (the relay's ms).

import type { Appearance, Pose } from "../ambient/townsfolk.ts";
import type { ArenaChampion, ArenaRecord } from "./arenaRoster.ts";
import type { FieldKind } from "./arenaData.ts";

/** Status bits (ArenaPersonWire.st) */
export const ARENA_STATUS = { WEBBED: 1, BLIND: 2, DAZZLED: 4, POISONED: 8, WINNER: 16, BEATEN: 32 } as const;

/** Someone in the arena, all of them */
export interface ArenaPersonWire {
  id: number;
  /** Their roster place, or -1 for a spectator who isn't a fighter */
  rid: number;
  name: string;
  /** Their archetype's key, or "" */
  arch: string;
  role: "fighter" | "mage" | "spectator";
  look: Appearance;
  x: number;
  y: number;
  a: number;
  pose: Pose;
  /** Counts up each time a pose that plays once starts again (a swing, a cast) */
  ps: number;
  /** Which frame of the dance a cheer holds */
  cf: number;
  hp: number;
  mhp: number;
  /** ARENA_STATUS bits */
  st: number;
  /** How visible (0-100), and whether fading in (1), out (-1) or not (0) */
  fade: number;
  fd: number;
  /** A spectator's favourite fighter this round (their id), or -1 (absent from relays before 2026-10-13) */
  fav?: number;
}

/**
 * What may change about someone tick to tick: [id, x, y, a, pose, ps, cf, hp, st, fade, fd, fav]
 * (fav last, absent from older relays, and ignored by older clients)
 */
export type ArenaMove = [number, number, number, number, Pose, number, number, number, number, number, number, number?];

/** A wall spell's element */
export interface ArenaFieldWire {
  id: number;
  kind: FieldKind;
  x: number;
  y: number;
  a: number;
  /** When it was laid, and when it goes */
  t: number;
  end: number;
  /** A bramble's look by its health (bramble.kod SendAnimation: group 1-5), 0 while growing */
  g: number;
  /** Lit (every other fire element) */
  lit: boolean;
}

/** A spell in flight */
export interface ArenaShotWire {
  id: number;
  spell: string;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  /** When it left */
  t: number;
}

/** Something that made a sound, or a stir */
export type ArenaEvent =
  /** A swing: what it struck (by how hard: player.kod DoHitMessageSound), and the victim's cry (1-4, GetOuchSound), 0 for a miss */
  | { type: "swing"; x: number; y: number; hit: "metal" | "leather" | "flesh" | null; ouch: number; female: boolean }
  /** A spell cast (its key) */
  | { type: "cast"; x: number; y: number; spell: string }
  /** A spell landing (its key), and whether it struck someone, and their cry */
  | { type: "impact"; x: number; y: number; spell: string; ouch: number; female: boolean }
  /** Stuck in a web, scratched by brambles, burned by a wall of fire, poisoned by the fog */
  | { type: "stuck" | "scratch" | "burn" | "poisoned"; x: number; y: number; ouch: number; female: boolean }
  /** A bramble cut down */
  | { type: "chop"; x: number; y: number }
  | { type: "cheer"; x: number; y: number; female: boolean }
  | { type: "death"; x: number; y: number; female: boolean }
  | { type: "victory"; x: number; y: number };

/** A roster entry as watchers see it, with its season so far */
export interface ArenaRosterWire {
  rid: number;
  name: string;
  arch: string;
  weapon: string | null;
  spell: string | null;
  rec: ArenaRecord;
  /** Seasons they were champion of */
  champ: number[];
}

/** Everything, for someone who starts watching */
export interface ArenaState {
  t: "arenaState";
  now: number;
  season: number;
  /** Labels for archetypes, weapons and spells, so the client needn't have the relay's config */
  labels: { arch: Record<string, string>; weapon: Record<string, string>; spell: Record<string, string> };
  people: ArenaPersonWire[];
  fields: ArenaFieldWire[];
  shots: ArenaShotWire[];
  roster: ArenaRosterWire[];
  champions: ArenaChampion[];
  /** The phase of the round: fighting, the winner's moment, between rounds, shut for the night */
  phase: ArenaPhase;
}

export type ArenaPhase = "fight" | "won" | "rest" | "closed";

/** What changed since the last tick */
export interface ArenaTick {
  t: "arenaTick";
  now: number;
  phase: ArenaPhase;
  /** Newcomers, in full */
  add?: ArenaPersonWire[];
  /** Movers and changes */
  mv?: ArenaMove[];
  /** Gone */
  del?: number[];
  /** Fields laid, changed (a bramble's look) and gone */
  fa?: ArenaFieldWire[];
  fc?: [number, number][];
  fd?: number[];
  /** Spells cast */
  sh?: ArenaShotWire[];
  ev?: ArenaEvent[];
  /** Lines said: [id, text] */
  say?: [number, string][];
  /** Roster entries whose records changed */
  ro?: ArenaRosterWire[];
  champions?: ArenaChampion[];
  season?: number;
}

export type ArenaMessage = ArenaState | ArenaTick;
