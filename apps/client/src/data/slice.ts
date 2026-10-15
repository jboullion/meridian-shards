// The room viewer's rooms: Tos on the 101 server (Kod RIDs from blakston.khd, piBaseLight and
// piOutside_factor from each room's Kod: tosrm/*.kod, objroom/tosinn.kod), with a square inside
// each to stand on. The default lighting is what the 104 server sent in BP_PLAYER /
// BP_LIGHT_SHADING (2026-10-06); outdoor values change with the game's time of day.

export interface SliceRoom {
  rid: number;
  name: string;
  roo: string;
  /** Kod room light (piBaseLight) and how much the time of day changes it (piOutside_factor) */
  baseLight: number;
  outsideFactor: number;
  teleport: { row: number; col: number; angle: number | null };
  outdoor: boolean;
}

/**
 * The ambient light the server sends for a room (kod room.kod GetRoomLight):
 * baseLight + outsideFactor * (brightness - 50) / 4, clamped to 0..255, with Kod's
 * left-to-right integer arithmetic. `brightness` is the system's time-of-day value (0..100).
 */
export function roomAmbient(room: SliceRoom, brightness: number): number {
  const light = room.baseLight + Math.trunc((room.outsideFactor * (brightness - 50)) / 4);
  return Math.max(0, Math.min(255, light));
}

export const SLICE_ROOMS: SliceRoom[] = [
  { rid: 50, baseLight: 209, outsideFactor: 10, name: "The Streets of Tos", roo: "tos.roo", teleport: { row: 35, col: 21, angle: null }, outdoor: true },
  { rid: 51, baseLight: 100, outsideFactor: 0, name: "The Freelance Merchant and Menders Shop", roo: "tossmith.roo", teleport: { row: 5, col: 4, angle: null }, outdoor: false },
  { rid: 52, baseLight: 164, outsideFactor: 5, name: "Familiars", roo: "tosinn.roo", teleport: { row: 6, col: 6, angle: null }, outdoor: false },
  { rid: 53, baseLight: 164, outsideFactor: 3, name: "Frisconar's Mysticals", roo: "tosapoth.roo", teleport: { row: 5, col: 4, angle: null }, outdoor: false },
  { rid: 54, baseLight: 164, outsideFactor: 3, name: "First Royal Bank of Tos", roo: "tosbank.roo", teleport: { row: 5, col: 5, angle: null }, outdoor: false },
  { rid: 72, baseLight: 164, outsideFactor: 3, name: "The Adventurer's Hall of Tos", roo: "toshall.roo", teleport: { row: 9, col: 12, angle: null }, outdoor: false },
  { rid: 76, baseLight: 164, outsideFactor: 0, name: "Abandoned Fountain Tavern", roo: "tostavern.roo", teleport: { row: 7, col: 6, angle: null }, outdoor: false },
];

/**
 * What our server sent on 2026-10-06: ambient 213 in Raza and the inn (brightness 33),
 * player light 5, Raza's sun shading intensity 5 at angle 130.
 */
export const DEFAULT_LIGHTING = { brightness: 33, viewerLight: 5, shade: 5, sunAngle: 130 };
