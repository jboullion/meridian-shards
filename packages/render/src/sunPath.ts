// Ours: the sun moving smoothly (docs/adr/0017-lighting-moods.md). The server moves the sun once
// a game hour (shards-server object/passive/sun.kod NewGameHour, every KodPeriod minutes: 5),
// so it jumps. Between the hours we run the server's own formulas on a fractional hour, worked
// out from how long ago the hour last changed; at whole hours they give exactly what it sends.

/** drawdefs.h VIEWER_DISTANCE, as skyOverlays.ts uses it: height pixels become atan(height / 512) */
const VIEWER_DISTANCE = 512;
/** How long a game hour lasts until we've timed one (blakserv.cfg [Auto] KodPeriod 5 minutes) */
export const DEFAULT_HOUR_MS = 5 * 60 * 1000;

/** sun.kod NewGameHour's angle (client units, east 0, a full turn 4096) at a fractional hour */
export const sunAngleAt = (hour: number): number => ((((hour + 19) % 24) + 24) % 24) * 130;

/** sun.kod NewGameHour's height (pixels above the horizon) at a fractional hour; at least -200 */
export const sunHeightAt = (hour: number): number => Math.max(-200, 420 - 7 * (hour - 13) * (hour - 13));

/** A sky overlay's direction in client axes (x east, y south, z up), as skyOverlays.ts places it */
export function skyDirection(angle: number, height: number): [number, number, number] {
  const az = (angle * 2 * Math.PI) / 4096;
  const el = Math.atan(height / VIEWER_DISTANCE);
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

/** The sun at a fractional game hour (0..24) */
export function sunAt(hour: number): { angle: number; height: number; dir: [number, number, number] } {
  const h = ((hour % 24) + 24) % 24;
  // The angle wraps at 5 (sun.kod: ((h + 19) % 24) * 130), while the sun is below the horizon
  const angle = sunAngleAt(h);
  const height = sunHeightAt(h);
  return { angle, height, dir: skyDirection(angle, height) };
}

/**
 * Times the game's hours from the sun overlay's changes: `hourNow(serverHour, nowMs)` gives the
 * hour with its fraction, from when `serverHour` was first seen.
 */
export class GameClock {
  private hour: number | null = null;
  private since = 0;
  private hourMs = DEFAULT_HOUR_MS;

  /** The game hour now, with the fraction gone since the server's hour last changed (below 1) */
  hourNow(serverHour: number, nowMs: number): number {
    if (this.hour === null) {
      this.hour = serverHour;
      // Seen mid-hour: assume half of it has gone, so the light doesn't jump half an hour later
      this.since = nowMs - this.hourMs / 2;
    } else if (serverHour !== this.hour) {
      const next = (this.hour + 1) % 24;
      const took = nowMs - this.since;
      // A plain step on: time it (within reason). A jump (SetHour, the dashboard): start over
      if (serverHour === next && took > 20_000 && took < 30 * 60_000) this.hourMs = took;
      this.hour = serverHour;
      this.since = nowMs;
    }
    return serverHour + Math.min(0.999, Math.max(0, (nowMs - this.since) / this.hourMs));
  }

  /** How long a game hour lasts, as timed */
  get hourLength(): number {
    return this.hourMs;
  }
}
