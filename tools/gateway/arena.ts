// The arena on the relay (docs/adr/0007-arena.md): one ArenaSim per game server, run while anyone
// on that server watches the arena (a player with Ambient Life on, in tosarena.roo), so everyone
// there sees the same fights, friends or not. It ticks every 50 ms against the wall clock and
// sends watchers what changed every 100 ms (packages/world arenaWire.ts). A minute after the last
// watcher leaves, the round is dropped; the next visitor starts a new one.
//
// The season's roster and records (arenaRoster.ts) are kept in one small JSON file (ARENA_STATE),
// written when a round ends and when the season turns: the one thing the relay keeps on disk.
//
// The room comes from the asset build (tosarena.roo and nav/tosarena.nav in ARENA_ASSETS), so the
// sim walks the same floor the clients draw.

import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRoo } from "@shards/formats";
import {
  ARENA_SEND_EVERY, ARENA_TICK_MS, ArenaSim, arenaHourAt, buildNavGrid, championOf, decodeNavGrid, hashText, makeRoster, seasonAt,
  type ArenaChampion, type ArenaConfig, type ArenaRecord, type NavGrid, type RosterEntry,
} from "@shards/world";

/** The room the arena is in */
export const ARENA_ROOM = "tosarena.roo";
/** After the last watcher leaves, the round goes on this long (ms) in case they come back */
const IDLE_MS = 60_000;
/** Ticks due at once beyond this (a stall) are dropped rather than run */
const MAX_CATCH_UP = 40;
/** Champions kept per server */
const MAX_CHAMPIONS = 20;

/** Someone watching: the relay's connection, as text */
export interface ArenaWatcher {
  send(text: string): void;
}

/** A game server's season, as kept on disk */
interface Season {
  season: number;
  roster: RosterEntry[];
  records: Record<number, ArenaRecord>;
  champions: ArenaChampion[];
}

interface Arena {
  server: string;
  sim: ArenaSim;
  watchers: Set<ArenaWatcher>;
  timer: ReturnType<typeof setInterval>;
  idleSince: number | null;
  ticks: number;
  /** The game hour the watchers' sun shows (the latest said), or null for the wall clock's guess */
  hour: number | null;
}

export interface ArenaHostOptions {
  config: ArenaConfig;
  /** Where tosarena.roo and nav/tosarena.nav are (the asset build) */
  assetsDir: string;
  /** The season file, or null to keep nothing */
  statePath: string | null;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** For the tests: no timers, step() by hand */
  manual?: boolean;
}

export class ArenaHost {
  /** The only room watched */
  readonly room = ARENA_ROOM;
  private readonly opts: ArenaHostOptions;
  private readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;
  private grid: NavGrid | null | undefined;
  private readonly arenas = new Map<string, Arena>();
  private seasons: Record<string, Season> = {};
  private writer: Promise<void> | null = null;
  private dirty = false;

  constructor(opts: ArenaHostOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.load();
  }

  /** Whether there's an arena to watch (its room was found) */
  get available(): boolean {
    return this.floor() !== null;
  }

  /** How many servers' arenas are running (for the log and tests) */
  get running(): number {
    return this.arenas.size;
  }

  /** The room's nav grid, read once */
  private floor(): NavGrid | null {
    if (this.grid !== undefined) return this.grid;
    const roo = join(this.opts.assetsDir, ARENA_ROOM);
    if (!existsSync(roo)) {
      this.log(`arena: no ${roo}, so no arena on the relay`);
      return (this.grid = null);
    }
    const room = parseRoo(new Uint8Array(readFileSync(roo)));
    const nav = join(this.opts.assetsDir, "nav", ARENA_ROOM.replace(/\.roo$/, ".nav"));
    this.grid = (existsSync(nav) ? decodeNavGrid(new Uint8Array(readFileSync(nav)), room) : null) ?? buildNavGrid(room);
    return this.grid;
  }

  /**
   * Someone on `server` starts watching: they get everything now, and the ticks after. `hour` is
   * the game hour their sun shows (null: not known)
   */
  watch(server: string, w: ArenaWatcher, hour: number | null = null): boolean {
    const grid = this.floor();
    if (!grid) return false;
    let a = this.arenas.get(server);
    if (!a) a = this.start(server, grid);
    if (hour !== null) a.hour = hour;
    a.watchers.add(w);
    a.idleSince = null;
    w.send(JSON.stringify(a.sim.state()));
    return true;
  }

  /**
   * A watcher's sun moved: the game's hour, which the arena opens and shuts by. Every player on a
   * server sees the same sun, so the latest word is everyone's; an admin setting the time moves it
   */
  setHour(server: string, hour: number | null): void {
    const a = this.arenas.get(server);
    if (a && hour !== null) a.hour = hour;
  }

  /** They stop watching (left the room, or went) */
  leave(server: string, w: ArenaWatcher): void {
    const a = this.arenas.get(server);
    if (!a || !a.watchers.delete(w)) return;
    if (!a.watchers.size) a.idleSince = this.now();
  }

  /** Everything stops (the gateway shutting down) */
  async stop(): Promise<void> {
    for (const a of this.arenas.values()) clearInterval(a.timer);
    this.arenas.clear();
    await this.save();
  }

  private season(server: string, at: number): Season {
    const n = seasonAt(at);
    let s = this.seasons[server];
    if (!s) {
      s = this.seasons[server] = { season: n, roster: makeRoster(server, n, this.opts.config), records: {}, champions: [] };
      void this.save();
    }
    return s;
  }

  private start(server: string, grid: NavGrid): Arena {
    const now = this.now();
    const s = this.season(server, now);
    const sim = new ArenaSim(grid, {
      config: this.opts.config, roster: s.roster, records: s.records, champions: s.champions, season: s.season, now,
      seed: hashText(`${server}|${now}`),
    });
    sim.onRoundEnd = () => void this.save();
    const a: Arena = { server, sim, watchers: new Set(), timer: undefined as unknown as ReturnType<typeof setInterval>, idleSince: null, ticks: 0, hour: null };
    if (!this.opts.manual) a.timer = setInterval(() => this.run(a), ARENA_TICK_MS);
    this.arenas.set(server, a);
    this.log(`arena: started for ${server} (season ${s.season})`);
    this.checkSeason(a);
    return a;
  }

  /** The ticks due by now, and what changed to whoever watches */
  private run(a: Arena): void {
    const now = this.now();
    if (a.idleSince !== null && now - a.idleSince > IDLE_MS) {
      clearInterval(a.timer);
      this.arenas.delete(a.server);
      this.log(`arena: stopped for ${a.server} (nobody watching)`);
      void this.save();
      return;
    }
    let due = Math.floor((now - a.sim.now) / ARENA_TICK_MS);
    if (due > MAX_CATCH_UP) {
      // A stall: skip the time rather than run it all
      a.sim.now = now - MAX_CATCH_UP * ARENA_TICK_MS;
      due = MAX_CATCH_UP;
    }
    for (let k = 0; k < due; k++) this.step(a);
  }

  /** One tick of one arena (the tests call it through stepAll) */
  private step(a: Arena): void {
    a.sim.update(ARENA_TICK_MS, a.hour ?? arenaHourAt(a.sim.now));
    this.checkSeason(a);
    if (++a.ticks % ARENA_SEND_EVERY) return;
    const text = JSON.stringify(a.sim.tick());
    for (const w of a.watchers) w.send(text);
  }

  /** For the tests: `n` ticks of every arena, whatever the clock */
  stepAll(n: number): void {
    for (let k = 0; k < n; k++) for (const a of [...this.arenas.values()]) this.step(a);
  }

  /** For the tests: what the timers do, by the clock (`now`) */
  pump(): void {
    for (const a of [...this.arenas.values()]) this.run(a);
  }

  /** For the tests: the arena watchers of a server see */
  simOf(server: string): ArenaSim | undefined {
    return this.arenas.get(server)?.sim;
  }

  /** A new Meridian year: last season's champion is remembered, and a new roster fights from the next round */
  private checkSeason(a: Arena): void {
    const s = this.seasons[a.server];
    const n = seasonAt(a.sim.now);
    if (!s || s.season === n) return;
    const champ = championOf(s.roster, s.records, s.season);
    const champions = champ ? [...s.champions, champ].slice(-MAX_CHAMPIONS) : s.champions;
    const next: Season = { season: n, roster: makeRoster(a.server, n, this.opts.config), records: {}, champions };
    this.seasons[a.server] = next;
    a.sim.setSeason(n, next.roster, next.records, next.champions);
    this.log(`arena: season ${n} on ${a.server}${champ ? `; ${champ.name} was champion of season ${s.season}` : ""}`);
    void this.save();
  }

  // ---- the season file ----

  private load(): void {
    const path = this.opts.statePath;
    if (!path || !existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { version?: number; servers?: Record<string, Season> };
      if (data.version === 1 && data.servers && typeof data.servers === "object") {
        for (const [server, s] of Object.entries(data.servers))
          if (Number.isInteger(s?.season) && Array.isArray(s.roster) && s.records && Array.isArray(s.champions)) this.seasons[server] = s;
      }
      this.log(`arena: seasons for ${Object.keys(this.seasons).length} server(s) from ${path}`);
    } catch (e) {
      this.log(`arena: couldn't read ${path}: ${(e as Error).message}`);
    }
  }

  /**
   * Written whole to a file beside it, then renamed over it, so a crash never leaves half a file;
   * one write at a time, and another after it if anything changed meanwhile
   */
  save(): Promise<void> {
    if (!this.opts.statePath) return Promise.resolve();
    this.dirty = true;
    this.writer ??= this.flush(this.opts.statePath).finally(() => (this.writer = null));
    return this.writer;
  }

  private async flush(path: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    while (this.dirty) {
      this.dirty = false;
      try {
        await writeFile(tmp, JSON.stringify({ version: 1, servers: this.seasons }));
        await rename(tmp, path);
      } catch (e) {
        this.log(`arena: couldn't save ${path}: ${(e as Error).message}`);
      }
    }
  }
}
