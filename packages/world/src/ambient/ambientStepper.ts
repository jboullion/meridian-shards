// Ours (docs/adr/0005-friends.md section 6, docs/adr/0015-social-on-our-server.md): the same crowd
// for everyone in a room. Everyone in a room gets the same seed and start from our server
// (Room.GetAmbientCrowd), and the crowd steps in fixed ticks counted from a shared start, so two clients step it the same
// number of times and see much the same play out. Someone arriving late runs the ticks they
// missed at once (a few dozen ms for ten minutes of a town), then carries on alone. (The arena's
// fights are another matter: one sim on the gateway that everyone watches, arena/.) It needn't stay exact: the player's own presence (sidestepping, waving) still
// changes their copy a little.
//
// Between ticks, walkers are drawn where they'd be, so the fixed step doesn't show.

import type { AmbientFrame, AmbientLife } from "./ambientLife.ts";

/** One tick of the shared crowd (ms) */
export const AMBIENT_TICK_MS = 50;
/** A seed holds for a room this long (ms): later arrivals with no friend there to ask get a new crowd */
export const AMBIENT_SLOT_MS = 10 * 60_000;
/** More ticks than this due at once (a hidden tab, a stall): run them without drawing in between */
const MAX_LIVE_TICKS = 40;

/**
 * A room's shared crowd: its seed, the time (ms, our clock) its ticks count from, and the game hour it
 * was made in (a late arrival can't know the hours that went by)
 */
export interface AmbientSeed {
  seed: number;
  since: number;
  hour?: number | null;
}

/** The seed for a room in a slot of a shared clock, the same for everyone (FNV-1a; before our server kept seeds) */
export function slotSeed(room: string, now: number): AmbientSeed {
  const slot = Math.floor(now / AMBIENT_SLOT_MS);
  let h = 0x811c9dc5;
  for (const c of `${room.toLowerCase()}|${slot}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return { seed: h, since: slot * AMBIENT_SLOT_MS };
}

interface Pos {
  x: number;
  y: number;
}

export class AmbientStepper {
  readonly life: AmbientLife;
  readonly shared: AmbientSeed | null;
  /** Ticks run since `shared.since` */
  private ticks = 0;
  /** Still running the ticks missed before we came (nothing to draw yet) */
  catchingUp: boolean;
  /** Where each walker was at the tick before and at the last tick */
  private prev = new Map<Pos, Pos>();
  private cur = new Map<Pos, Pos>();

  constructor(life: AmbientLife, shared: AmbientSeed | null) {
    this.life = life;
    this.shared = shared;
    this.catchingUp = shared !== null;
  }

  /**
   * One frame. Unshared, the crowd steps by the frame's time as before. Shared, it runs the ticks
   * due by `now` (our clock), at most `budgetMs` of work while catching up, then places
   * walkers between the last two ticks.
   */
  advance(now: number, dt: number, frame: AmbientFrame, catchUpFrame: AmbientFrame, budgetMs = 6): void {
    const life = this.life;
    if (!this.shared || !life.ready) {
      // The nav grid and the doors first (the same for everyone), then, unshared, the crowd itself
      life.update(Math.min(dt, 100), this.shared ? catchUpFrame : frame);
      return;
    }
    const due = Math.floor((now - this.shared.since) / AMBIENT_TICK_MS);
    if (this.catchingUp) {
      // All but the last tick missed; the last is run below, as live ones are, to draw from
      const end = performance.now() + budgetMs;
      while (this.ticks < due - 1 && performance.now() < end) this.tick(catchUpFrame);
      if (this.ticks < due - 1) return;
      this.catchingUp = false;
      this.cur = this.positions();
    }
    if (due - this.ticks > MAX_LIVE_TICKS) {
      while (this.ticks < due - 1) this.tick(frame);
      this.cur = this.positions();
    }
    if (this.ticks < due) {
      this.restore();
      while (this.ticks < due) {
        this.prev = this.positions();
        this.tick(frame);
      }
      this.cur = this.positions();
    }
    this.place((now - this.shared.since) / AMBIENT_TICK_MS - this.ticks);
  }

  private tick(frame: AmbientFrame): void {
    this.life.update(AMBIENT_TICK_MS, frame);
    this.ticks++;
  }

  /** The walkers there are now */
  private movers(): Pos[] {
    return this.life.objects();
  }

  private positions(): Map<Pos, Pos> {
    return new Map(this.movers().map((o) => [o, { x: o.x, y: o.y }]));
  }

  /** Back where the last tick left them, before the next (the crowd mustn't see where we drew them) */
  private restore(): void {
    for (const [o, p] of this.cur) {
      o.x = p.x;
      o.y = p.y;
    }
  }

  /** `t` of the way from the tick before to the last (0..1) */
  private place(t: number): void {
    const k = Math.max(0, Math.min(1, t));
    for (const [o, c] of this.cur) {
      const p = this.prev.get(o) ?? c;
      o.x = p.x + (c.x - p.x) * k;
      o.y = p.y + (c.y - p.y) * k;
    }
  }
}
