// The quick slots' cooldown (ours; the Modern interface's hotbar and the phone's Cast button). The
// server keeps one timer for casting and attacking (player.kod IsOkayAttackTime, ptAttackTimer):
// a spell that goes ahead starts it for the spell's viPostCast_time (spelltimes.json, from Kod), and
// no spell can be cast until it runs out. So one cooldown covers every spell slot.
//
// The server doesn't say when a cast went ahead. A cast we send starts the cooldown at once; if the
// spell costs mana and our mana hasn't dropped within CONFIRM_MS, the server refused it (too little
// mana, no reagents, a bad target) and the cooldown is taken back. A cast sent while the cooldown
// runs is refused by the server without a word, so it changes nothing here.

export interface Cooldown {
  /** performance.now() times */
  start: number;
  end: number;
}

/** How long a cast has to show it went ahead (our mana dropping), ms: a round trip and then some */
export const CONFIRM_MS = 2000;

export class CastCooldown {
  active: Cooldown | null = null;
  /** A cast not yet confirmed: the mana we had when we sent it, and when to give up */
  private pending: { manaAt: number; deadline: number } | null = null;

  /**
   * A cast sent: `postCastMs` from spelltimes.json, `mana` its cost (0 needs no confirming),
   * `manaNow` our mana (null unknown). True if the cooldown changed.
   */
  cast(postCastMs: number, mana: number, manaNow: number | null, now: number): boolean {
    if (this.active && now < this.active.end) return false;
    if (postCastMs <= 0) return false;
    this.active = { start: now, end: now + postCastMs };
    this.pending = mana > 0 && manaNow !== null ? { manaAt: manaNow, deadline: now + CONFIRM_MS } : null;
    return true;
  }

  /** Our mana now: a drop since the cast confirms it. */
  mana(value: number): void {
    if (this.pending && value < this.pending.manaAt) this.pending = null;
  }

  /** Expire the cooldown, or take back an unconfirmed one. True if it changed. */
  tick(now: number): boolean {
    if (!this.active) return false;
    if (this.pending && now >= this.pending.deadline) {
      this.pending = null;
      this.active = null;
      return true;
    }
    if (now >= this.active.end && !this.pending) {
      this.active = null;
      return true;
    }
    return false;
  }
}
