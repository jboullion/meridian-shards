// The Raza vertical slice rooms (Kod RIDs 300-308, 330-333), with the arrival
// square and Kod base light from meridian-unreal data/zones.json.
// Ambient/player light and sun shading are what our server sent in BP_PLAYER /
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
  { rid: 300, baseLight: 255, outsideFactor: 10, name: "Raza", roo: "raza.roo", teleport: { row: 23, col: 41, angle: 3072 }, outdoor: true },
  { rid: 301, baseLight: 255, outsideFactor: 10, name: "The Inn of Raza", roo: "razainn.roo", teleport: { row: 3, col: 8, angle: 1792 }, outdoor: false },
  { rid: 302, baseLight: 164, outsideFactor: 5, name: "The Adventurer's Hall of Raza", roo: "razahall.roo", teleport: { row: 6, col: 5, angle: null }, outdoor: false },
  { rid: 303, baseLight: 164, outsideFactor: 5, name: "The Blacksmith of Raza", roo: "razasmith.roo", teleport: { row: 5, col: 4, angle: 2560 }, outdoor: false },
  { rid: 304, baseLight: 164, outsideFactor: 5, name: "Ravi's Magicks of Raza", roo: "razaapoth.roo", teleport: { row: 5, col: 4, angle: null }, outdoor: false },
  { rid: 305, baseLight: 164, outsideFactor: 5, name: "The Home of Roderic D'Stane", roo: "razahut.roo", teleport: { row: 2, col: 2, angle: null }, outdoor: false },
  { rid: 306, baseLight: 124, outsideFactor: 0, name: "Mausoleum", roo: "razacrypt.roo", teleport: { row: 11, col: 23, angle: null }, outdoor: false },
  { rid: 307, baseLight: 164, outsideFactor: 5, name: "Eric's Stout Spirits", roo: "razabar.roo", teleport: { row: 5, col: 4, angle: null }, outdoor: false },
  { rid: 308, baseLight: 164, outsideFactor: 5, name: "The Grand Museum of Raza", roo: "razamuseum.roo", teleport: { row: 8, col: 11, angle: null }, outdoor: false },
  { rid: 330, baseLight: 164, outsideFactor: 8, name: "Outskirts of Raza", roo: "razaforest.roo", teleport: { row: 24, col: 37, angle: null }, outdoor: true },
  { rid: 331, baseLight: 164, outsideFactor: 8, name: "Western Edge of the Forest of Farol", roo: "farolwest.roo", teleport: { row: 27, col: 40, angle: null }, outdoor: true },
  { rid: 332, baseLight: 164, outsideFactor: 3, name: "Raza Vaults", roo: "razavault.roo", teleport: { row: 3, col: 6, angle: null }, outdoor: false },
  { rid: 333, baseLight: 164, outsideFactor: 3, name: "Royal Bank of Raza", roo: "razabank.roo", teleport: { row: 3, col: 6, angle: null }, outdoor: false },
];

/**
 * What our server sent on 2026-10-06: ambient 213 in Raza and the inn (brightness 33),
 * player light 5, Raza's sun shading intensity 5 at angle 130.
 */
export const DEFAULT_LIGHTING = { brightness: 33, viewerLight: 5, shade: 5, sunAngle: 130 };
