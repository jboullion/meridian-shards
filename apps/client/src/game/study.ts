// Study mode (ours; the original has none): practise a spell while away from the keyboard, so
// players needn't run bots for it. Pick a spell and how many times to cast it; we cast it, rest
// when our mana runs short, stand and cast again when it's back, and log off when the reagents
// run out or the count is reached. Everything happens on the client: the server sees what a
// player at the keys would send (BP_REQ_CAST, UC_REST, UC_STAND), and the spell improves (or
// not) by its own roll on each cast (spell.kod ImproveAbility).
//
// The server doesn't say when a cast went ahead. As for the quick slots' cooldown (cooldowns.ts),
// our mana dropping within CONFIRM_MS confirms it; its refusals come as messages (no reagents,
// no mana, resting: @shards/world spellRefusal.ts). StudySession is the plan, fed what we see and
// answering with what to do; GameView does it.

import { CONFIRM_MS } from "./cooldowns.ts";

/** A spell's entry in spelltimes.json (tools/assets/spellTimes.ts) */
export interface StudySpellInfo {
  /** Seconds before another spell can be cast */
  postCast: number;
  mana: number;
  /** What one cast uses up, by item name in lower case; missing in assets built before Study mode */
  reagents?: { name: string; plural?: string; amount: number }[];
}

export interface StudyConfig {
  /** The spell's English name in lower case (spelltimes.json's key) */
  spell: string;
  /** Casts wanted; null: until the reagents run out */
  count: number | null;
  /** Log off when done (out of reagents, the count reached, hurt) */
  logOff: boolean;
}

export type StudyAction =
  | { type: "cast" }
  | { type: "rest" }
  | { type: "stand" }
  /** Study is over: why, and whether to log off */
  | { type: "finish"; reason: string; logOff: boolean };

/** What we see each tick; null for what we don't know yet */
export interface StudySnapshot {
  mana: number | null;
  maxMana: number | null;
  hp: number | null;
  resting: boolean;
}

export type StudyPhase = "cast" | "confirm" | "cooldown" | "rest" | "done";

/** Casts in a row that go unconfirmed (no mana drop) before we give up: a bad target, a spell the server won't allow */
export const MAX_MISSES = 3;
/** Resting with our mana not rising this long, we stand (and stop, if it's still too low to cast), ms */
export const STALL_MS = 30_000;
/** Between casts, on top of the post-cast delay: up to this much more, at random, ms */
export const JITTER_MS = 700;
/** Standing up before casting again, ms */
const STAND_MS = 600;
/**
 * Mana a second while resting, until we've measured this character's: a guess (the server's
 * regeneration depends on the character), only for the first estimate
 */
export const DEFAULT_REST_REGEN = 0.5;
/** Each rest costs a little besides the mana: lying down, standing up, a tick to notice, s */
const REST_OVERHEAD_S = 3;

export class StudySession {
  readonly config: StudyConfig;
  readonly info: StudySpellInfo;
  phase: StudyPhase = "cast";
  /** Casts confirmed */
  casts = 0;
  /** Mana a second while resting, measured this study (null until a rest has shown it) */
  regen: number | null = null;
  /** Why it ended */
  reason: string | null = null;
  private readonly random: () => number;
  private until = 0;
  private castAt = 0;
  private manaAtCast: number | null = null;
  private misses = 0;
  private hp: number | null = null;
  private restFrom: { t: number; mana: number } | null = null;
  private lastRise: { t: number; mana: number } | null = null;

  constructor(config: StudyConfig, info: StudySpellInfo, random: () => number = Math.random) {
    this.config = config;
    this.info = info;
    this.random = random;
  }

  get done(): boolean {
    return this.phase === "done";
  }

  /** Stopped by the player: no log off. */
  cancel(reason = "You stop studying."): StudyAction[] {
    return this.finish(reason, false);
  }

  /** A tick: what to do now. */
  step(now: number, s: StudySnapshot): StudyAction[] {
    if (this.phase === "done") return [];
    // Hurt while away: something is attacking us
    if (s.hp !== null) {
      if (this.hp !== null && s.hp < this.hp) return this.finish("You were hurt while studying.", this.config.logOff);
      this.hp = s.hp;
    }
    if (s.maxMana !== null && s.maxMana < this.info.mana) return this.finish(`You don't have enough mana to cast ${this.config.spell}.`, false);
    switch (this.phase) {
      case "cast":
        if (s.resting) return this.beginRest(now, s, false);
        if (s.mana !== null && s.mana < this.info.mana) return this.beginRest(now, s, true);
        this.phase = "confirm";
        this.castAt = now;
        this.manaAtCast = s.mana;
        return [{ type: "cast" }];
      case "confirm":
        if (this.info.mana > 0 && s.mana !== null && this.manaAtCast !== null && s.mana < this.manaAtCast) return this.confirmed();
        if (now - this.castAt < CONFIRM_MS) return [];
        // A spell that costs nothing can't be confirmed: no refusal in time is as good
        if (this.info.mana <= 0 || this.manaAtCast === null) return this.confirmed();
        if (++this.misses >= MAX_MISSES) return this.finish(`${this.config.spell} isn't working; study stopped.`, false);
        this.wait(this.castAt + this.info.postCast * 1000);
        return [];
      case "cooldown":
        if (now >= this.until) this.phase = "cast";
        return [];
      case "rest":
        return this.resting(now, s);
    }
    return [];
  }

  /** The server refused our cast. */
  refused(reason: "reagents" | "mana" | "resting", spell: string, now: number, s: StudySnapshot): StudyAction[] {
    if (this.phase === "done") return [];
    // Someone else's cast? Only ours are sent while studying, but the name says for sure
    if (spell && spell.toLowerCase() !== this.config.spell) return [];
    switch (reason) {
      case "reagents":
        return this.finish(`You've run out of reagents for ${this.config.spell}.`, this.config.logOff);
      case "mana":
        // spelltimes.json's cost was low (a spell's cost can grow with its power)
        return this.beginRest(now, s, true);
      case "resting":
        this.wait(now + STAND_MS);
        return [{ type: "stand" }];
    }
  }

  private confirmed(): StudyAction[] {
    this.casts++;
    this.misses = 0;
    if (this.config.count !== null && this.casts >= this.config.count) return this.finish(`You've cast ${this.config.spell} ${this.casts} times.`, this.config.logOff);
    this.wait(this.castAt + this.info.postCast * 1000 + this.random() * JITTER_MS);
    return [];
  }

  /** Cast again at `until` (performance.now() time) */
  private wait(until: number): void {
    this.phase = "cooldown";
    this.until = until;
  }

  private beginRest(now: number, s: StudySnapshot, lieDown: boolean): StudyAction[] {
    this.phase = "rest";
    const mana = s.mana ?? 0;
    this.restFrom = { t: now, mana };
    this.lastRise = { t: now, mana };
    return lieDown && !s.resting ? [{ type: "rest" }] : [];
  }

  private resting(now: number, s: StudySnapshot): StudyAction[] {
    if (s.mana === null || !this.restFrom || !this.lastRise) return [];
    if (s.mana > this.lastRise.mana) {
      this.lastRise = { t: now, mana: s.mana };
      const secs = (now - this.restFrom.t) / 1000;
      // A few seconds' rising before it's a rate worth trusting
      if (secs >= 5 && s.mana > this.restFrom.mana) this.regen = (s.mana - this.restFrom.mana) / secs;
    }
    const full = s.maxMana !== null && s.mana >= s.maxMana;
    const stalled = now - this.lastRise.t >= STALL_MS;
    if (!full && !stalled) return [];
    if (s.mana < this.info.mana) return this.finish(`Your mana stopped rising before you could cast ${this.config.spell}.`, false);
    this.wait(now + STAND_MS);
    return s.resting ? [{ type: "stand" }] : [];
  }

  private finish(reason: string, logOff: boolean): StudyAction[] {
    if (this.phase === "done") return [];
    this.phase = "done";
    this.reason = reason;
    return [{ type: "finish", reason, logOff }];
  }
}

/** Casts the reagents we carry are enough for; null for a spell that needs none. */
export function castsFromReagents(info: StudySpellInfo, carried: (name: string) => number): number | null {
  const reagents = info.reagents ?? [];
  if (!reagents.length) return null;
  // A stack of more than one goes by the plural (numbitem.kod GetName)
  const have = (r: (typeof reagents)[number]) => carried(r.name) + (r.plural ? carried(r.plural) : 0);
  return Math.min(...reagents.map((r) => (r.amount > 0 ? Math.floor(have(r) / r.amount) : Infinity)));
}

/** How much of each item (by English name, lower case) we carry: number items by their amount. */
export function carriedCounts(items: Iterable<{ name: string; amount: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { name, amount } of items) {
    const k = name.toLowerCase();
    out.set(k, (out.get(k) ?? 0) + Math.max(amount, 1));
  }
  return out;
}

export interface StudyEstimate {
  /** Casts the study will make; null: no end (no reagents needed and no count) */
  casts: number | null;
  /** What ends it */
  limit: "count" | "reagents" | "none";
  /** Casts the reagents are enough for (null: none needed) */
  reagentCasts: number | null;
  /** How long it should take, s; null with no end */
  seconds: number | null;
}

/**
 * How many casts a study will make and about how long it will take: each cast's post-cast delay
 * and jitter, and the rests to make up the mana beyond what we have (at `regen` mana a second).
 */
export function studyEstimate(
  info: StudySpellInfo, count: number | null, reagentCasts: number | null, mana: number, maxMana: number, regen: number = DEFAULT_REST_REGEN,
): StudyEstimate {
  let casts: number | null;
  let limit: StudyEstimate["limit"];
  if (count === null) {
    casts = reagentCasts;
    limit = reagentCasts === null ? "none" : "reagents";
  } else if (reagentCasts !== null && reagentCasts < count) {
    casts = reagentCasts;
    limit = "reagents";
  } else {
    casts = count;
    limit = "count";
  }
  if (casts === null) return { casts, limit, reagentCasts, seconds: null };
  const perCast = info.postCast + JITTER_MS / 2000 + CONFIRM_MS / 4000;
  const needed = casts * info.mana - mana;
  let rest = 0;
  if (needed > 0 && info.mana > 0) {
    // Each rest fills us up, and a cast's worth must fit
    const perRest = Math.max(maxMana - info.mana, info.mana, 1);
    rest = needed / Math.max(regen, 0.01) + Math.ceil(needed / perRest) * REST_OVERHEAD_S;
  }
  return { casts, limit, reagentCasts, seconds: casts * perCast + rest };
}

/** "about 1 h 20 min", "about 5 min", "under a minute" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

/** What Study remembers per character: the last choices, and the rate our mana comes back resting */
export interface StudyMemory {
  spell: string;
  count: number | null;
  logOff: boolean;
  regen: number | null;
}

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (server: string, character: string) => `shards.study.${server}.${character.toLowerCase()}`;

export function loadStudyMemory(store: Store, server: string, character: string): StudyMemory {
  const empty: StudyMemory = { spell: "", count: 10, logOff: true, regen: null };
  try {
    const raw = store.getItem(storageKey(server, character));
    const m = raw ? (JSON.parse(raw) as Partial<StudyMemory>) : {};
    return {
      spell: typeof m.spell === "string" ? m.spell : empty.spell,
      count: m.count === null || (typeof m.count === "number" && m.count > 0) ? m.count : empty.count,
      logOff: typeof m.logOff === "boolean" ? m.logOff : empty.logOff,
      regen: typeof m.regen === "number" && m.regen > 0 ? m.regen : null,
    };
  } catch {
    return empty;
  }
}

export function saveStudyMemory(store: Store, server: string, character: string, memory: StudyMemory): void {
  try {
    store.setItem(storageKey(server, character), JSON.stringify(memory));
  } catch {
    // storage unavailable: kept for this session
  }
}
