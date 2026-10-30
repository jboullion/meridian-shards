// The arena (docs/adr/0007-arena.md): its settings, seasons and roster, the fights on the real
// room (when the assets are built), and how a client draws them.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FINENESS, parseRoo } from "@shards/formats";
import { cellAt, type NavGrid } from "../src/navGrid.ts";
import { navGridOf } from "./navFixture.ts";
import { localResName } from "../src/ambient/ambientIds.ts";
import { seededRandom } from "../src/ambient/ambientLife.ts";
import { fighterAppearance } from "../src/ambient/townsfolk.ts";
import { ARENA_SPELLS, ARENA_WEAPONS, WEAPON_DAMAGE } from "../src/arena/arenaData.ts";
import { DEATH_ARENA_CONFIG, DEFAULT_ARENA_CONFIG, arenaOpenAt, readArenaConfig, type ArenaConfig } from "../src/arena/arenaConfig.ts";
import { arenaFloorArea, readArenaConfigs } from "../src/arena/arenaRooms.ts";
import { SEASON_EPOCH, SEASON_MS, championOf, makeRoster, seasonAt, seasonStart, type ArenaRecord } from "../src/arena/arenaRoster.ts";
import { ARENA_BUSY_MAX_MS, ArenaSim, arenaHourAt } from "../src/arena/arenaSim.ts";
import { ArenaView } from "../src/arena/arenaView.ts";
import { ARENA_STATUS, type ArenaPersonWire, type ArenaState, type ArenaTick } from "../src/arena/arenaWire.ts";

const SQ = FINENESS;
const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "tosarena.roo"));
let gridCache: NavGrid | null = null;
const grid = () => (gridCache ??= navGridOf(parseRoo(new Uint8Array(readFileSync(join(ASSETS, "tosarena.roo"))))));

const SERVER = "ws://test/ws";

/** A roster of only these archetypes (the others weighed at nothing) */
const only = (mix: Record<string, number>) => ({ ...Object.fromEntries(Object.keys(DEFAULT_ARENA_CONFIG.mix).map((k) => [k, 0])), ...mix });

function sim(seed: number, config: ArenaConfig = DEFAULT_ARENA_CONFIG, records: Record<number, ArenaRecord> = {}) {
  return new ArenaSim(grid(), { config, roster: makeRoster(SERVER, 1, config), records, champions: [], season: 1, seed, now: 1_000_000 });
}

/** Run a sim `ms`, calling `each` with the tick message every 100 ms */
function run(s: ArenaSim, ms: number, each?: (m: ArenaTick) => void, hour = 14): void {
  for (let t = 0, k = 0; t < ms; t += 50, k++) {
    s.update(50, hour);
    if (k % 2) each?.(s.tick());
  }
}

describe("arena settings (arena.json)", () => {
  test("the defaults, untouched without a file", () => {
    const { config, errors } = readArenaConfig(undefined);
    expect(errors).toEqual([]);
    expect(config.floor).toEqual([4, 8]);
    expect(config.spells.fireball.damage).toEqual([9, 15]);
  });

  test("changes merge over the defaults; what isn't understood is reported and dropped", () => {
    const { config, errors } = readArenaConfig({
      floor: [2, 4],
      spectators: 6,
      spells: { fireball: { damage: [20, 30] } },
      archetypes: { warrior: { hp: [200, 220] }, brute: { label: "Brute", weapons: ["hammer"], spells: [["fireball", 1]] } },
      mix: { brute: 5 },
      nonsense: 1,
      roundMaxMs: "long",
    });
    expect(config.floor).toEqual([2, 4]);
    expect(config.spectators).toBe(6);
    expect(config.spells.fireball.damage).toEqual([20, 30]);
    expect(config.spells.fireball.mana).toBe(7);
    expect(config.archetypes.warrior.hp).toEqual([200, 220]);
    // A new archetype takes what it leaves out from the first
    expect(config.archetypes.brute).toMatchObject({ label: "Brute", role: "fighter", weapons: ["hammer"], spells: [["fireball", 1]] });
    expect(config.mix.brute).toBe(5);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("nonsense"), expect.stringContaining("roundMaxMs")]));
    expect(config.roundMaxMs).toBe(DEFAULT_ARENA_CONFIG.roundMaxMs);
    // The defaults themselves are never changed
    expect(DEFAULT_ARENA_CONFIG.spells.fireball.damage).toEqual([9, 15]);
  });

  test("names that don't exist are dropped, and numbers kept in bounds", () => {
    const { config, errors } = readArenaConfig({ floor: [1, 99], archetypes: { knight: { weapons: ["longsword", "spoon"] } }, mix: { ghost: 2 } });
    expect(config.floor).toEqual([2, 12]);
    expect(config.archetypes.knight.weapons).toEqual(["longsword"]);
    expect(config.mix.ghost).toBeUndefined();
    expect(errors.length).toBe(3);
  });

  test("the spells' and weapons' numbers are the Kod's", () => {
    expect(ARENA_SPELLS.lightning.damage).toEqual([13, 18]);
    expect(ARENA_SPELLS.blind.curse).toMatchObject({ base: 4000, perPower: 60, min: 4000, max: 18000 });
    expect(ARENA_SPELLS.web.wall).toMatchObject({ field: "web", count: 9, ahead: 2 });
    expect(ARENA_SPELLS.bramble.wall).toMatchObject({ field: "bramble", count: 5, ahead: 1 });
    expect(WEAPON_DAMAGE.slash).toEqual([7, 13]);
    expect(ARENA_WEAPONS.scimitar).toMatchObject({ kind: "slash", quality: 1 });
  });
});

describe("arena seasons and roster", () => {
  test("a season is a Meridian year: 240 game days of two hours", () => {
    expect(SEASON_MS).toBe(480 * 3600_000);
    expect(seasonAt(SEASON_EPOCH)).toBe(1);
    expect(seasonAt(SEASON_EPOCH + SEASON_MS - 1)).toBe(1);
    expect(seasonAt(SEASON_EPOCH + SEASON_MS)).toBe(2);
    expect(seasonStart(3)).toBe(SEASON_EPOCH + 2 * SEASON_MS);
  });

  test("the same roster for a server and season wherever it's made; another next season", () => {
    const a = makeRoster(SERVER, 4, DEFAULT_ARENA_CONFIG);
    expect(a).toHaveLength(DEFAULT_ARENA_CONFIG.rosterSize);
    expect(makeRoster(SERVER.toUpperCase(), 4, DEFAULT_ARENA_CONFIG)).toEqual(a);
    expect(makeRoster(SERVER, 5, DEFAULT_ARENA_CONFIG).map((r) => r.name)).not.toEqual(a.map((r) => r.name));
    expect(new Set(a.map((r) => r.name)).size).toBe(a.length);
    for (const r of a) {
      const arch = DEFAULT_ARENA_CONFIG.archetypes[r.arch];
      expect(arch).toBeDefined();
      // A fighter carries their favourite weapon; a caster none, and favours one of their spells
      if (arch.role === "fighter") expect(r.look.gear?.weapon).toBe(DEFAULT_ARENA_CONFIG.weapons[r.weapon!].overlay);
      else expect(r.look.gear?.weapon).toBeUndefined();
      if (r.spell) expect(arch.spells.map(([s]) => s)).toContain(r.spell);
    }
  });

  test("the champion: most wins, then fewest losses", () => {
    const roster = makeRoster(SERVER, 1, DEFAULT_ARENA_CONFIG);
    const records = { 0: { wins: 3, losses: 4, kills: 5 }, 1: { wins: 3, losses: 1, kills: 0 }, 2: { wins: 1, losses: 0, kills: 9 } };
    expect(championOf(roster, records, 1)).toEqual({ season: 1, name: roster[1].name, arch: roster[1].arch });
    expect(championOf(roster, {}, 1)).toBeNull();
  });

  test("the game hour as blakserv works it out (a day is two real hours)", () => {
    const base = (1760000000 + 5 * 3600) * 1000;
    expect(arenaHourAt(base)).toBe(0);
    expect(arenaHourAt(base + 5 * 60_000)).toBe(1);
    expect(arenaHourAt(base + 115 * 60_000)).toBe(23);
    expect(arenaHourAt(base + 120 * 60_000)).toBe(0);
  });
});

describe.skipIf(!have)("the arena's fights on the real room", () => {
  test("the same seed gives the same fights", () => {
    const a = sim(11),
      b = sim(11);
    const ma: string[] = [],
      mb: string[] = [];
    run(a, 60_000, (m) => ma.push(JSON.stringify(m)));
    run(b, 60_000, (m) => mb.push(JSON.stringify(m)));
    expect(mb).toEqual(ma);
  }, 30_000);

  test("rounds: the beaten go to the stands until one is left, who wins with their weapon put away", () => {
    const records: Record<number, ArenaRecord> = {};
    const s = sim(5, DEFAULT_ARENA_CONFIG, records);
    const g = s.nav;
    let victories = 0,
      deaths = 0,
      rounds = 0;
    let sawFloor = false;
    run(s, 8 * 60_000, (m) => {
      for (const e of m.ev ?? []) {
        if (e.type === "death") deaths++;
        if (e.type !== "victory") continue;
        victories++;
        // One winner, alone on the floor
        const floor = s.everyone.filter((p) => p.role !== "spectator" && p.fd >= 0 && !(p.st & ARENA_STATUS.BEATEN));
        expect(floor).toHaveLength(1);
        expect(floor[0].st & ARENA_STATUS.WINNER).toBeTruthy();
      }
      // (The last winner may still be walking off)
      const fighting = s.everyone.filter((p) => p.role !== "spectator" && p.fd >= 0 && !(p.st & ARENA_STATUS.WINNER));
      if (s.phase === "fight" && fighting.length >= 4 && !sawFloor) {
        sawFloor = true;
        rounds++;
        expect(fighting.length).toBeLessThanOrEqual(8);
        // Casters among them (two when the roster has two free: the beaten watching aren't)
        expect(fighting.filter((p) => p.role === "mage").length).toBeGreaterThanOrEqual(1);
      }
      if (s.phase !== "fight") sawFloor = false;
      // The beaten watch from the stands, not the floor
      for (const p of s.everyone) if (p.st & ARENA_STATUS.BEATEN && p.fd >= 0) expect(g.area[cellAt(g, p.x, p.y)]).not.toBe(1);
    });
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(victories).toBeGreaterThanOrEqual(2);
    expect(deaths).toBeGreaterThan(victories);
    // The season's records
    const all = Object.values(records);
    expect(all.reduce((t, r) => t + r.wins, 0)).toBe(victories);
    expect(all.reduce((t, r) => t + r.losses, 0)).toBeGreaterThanOrEqual(deaths);
    expect(all.reduce((t, r) => t + r.kills, 0)).toBeGreaterThan(0);
  }, 60_000);

  test("spectators cheer for a fighter each round: by name, loudest when they win, booing when they fall", () => {
    const s = sim(9);
    const lines: string[] = [];
    let checked = 0;
    let cheered = 0,
      booed = 0;
    run(s, 6 * 60_000, (m) => {
      const people = new Map(s.everyone.map((p) => [p.id, p]));
      const fighters = s.everyone.filter((p) => p.role !== "spectator" && p.fd >= 0);
      const names = fighters.map((p) => p.name);
      for (const [id, text] of m.say ?? []) {
        const who = people.get(id);
        if (who?.role !== "spectator" || who.rid >= 0) continue;
        lines.push(text);
        if (names.some((n) => text.includes(n))) cheered++;
        if (/Boo|Rubbish|Pathetic|wager/.test(text)) booed++;
      }
      if (s.phase !== "fight") return;
      // A favourite is always someone on the floor and still standing
      for (const p of s.everyone) {
        if (p.role !== "spectator" || p.fav === undefined || p.fav < 0) continue;
        const fav = people.get(p.fav)!;
        expect(fav.role).not.toBe("spectator");
        expect(fav.st & ARENA_STATUS.BEATEN).toBeFalsy();
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(100);
    expect(cheered).toBeGreaterThan(0);
    expect(booed).toBeGreaterThan(0);
  }, 60_000);

  test("shut from 22 to 6: everyone goes", () => {
    const s = sim(3);
    run(s, 20_000);
    expect(s.everyone.length).toBeGreaterThan(4);
    run(s, 2000, undefined, 23);
    expect(s.phase).toBe("closed");
    expect(s.everyone).toHaveLength(0);
    run(s, 5000, undefined, 8);
    expect(s.everyone.length).toBeGreaterThan(0);
  }, 30_000);

  test("a web holds whoever steps into it 1-5 s (web.kod), and they don't move while held", () => {
    // Tricksters (webs) against warriors (who walk into them)
    const { config } = readArenaConfig({ mix: only({ riija: 1, warrior: 1 }) });
    let holds = 0;
    for (const seed of [1, 2]) {
      const held = new Map<number, { x: number; y: number; ticks: number }>();
      const s = sim(seed, config);
      // Every 50 ms tick (a hold may end and another begin between two messages)
      for (let t = 0; t < 6 * 60_000; t += 50) {
        s.update(50, 14);
        for (const p of s.everyone) {
          const h = held.get(p.id);
          if (p.st & ARENA_STATUS.WEBBED) {
            if (!h) held.set(p.id, { x: p.x, y: p.y, ticks: 1 });
            else {
              expect([p.x, p.y]).toEqual([h.x, h.y]);
              h.ticks++;
            }
          } else if (h) {
            held.delete(p.id);
            holds++;
            // A hold of 1-5 s: 19-100 ticks
            expect(h.ticks).toBeGreaterThanOrEqual(19);
            expect(h.ticks).toBeLessThanOrEqual(100);
          }
        }
      }
    }
    expect(holds).toBeGreaterThan(2);
  }, 60_000);

  test("brambles bar the way while they stand; fighters hack them down", () => {
    const { config } = readArenaConfig({ mix: only({ faren: 1, warrior: 1 }), archetypes: { faren: { spells: [["bramble", 1]] } } });
    let walls = 0,
      chops = 0;
    const s = sim(4, config);
    run(s, 6 * 60_000, (m) => {
      for (const e of m.ev ?? []) if (e.type === "chop") chops++;
      const brambles = s.fieldList.filter((f) => f.kind === "bramble");
      if (brambles.length) walls++;
      const g = s.nav;
      for (const b of brambles) {
        expect(g.closed[cellAt(g, b.x, b.y)]).toBe(1);
        // Nobody stands in one
        for (const p of s.everyone) if (p.role !== "spectator" && p.fd >= 0) expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(0.15 * SQ);
      }
      if (!brambles.length) expect(g.closed.every((c) => c === 0)).toBe(true);
    });
    expect(walls).toBeGreaterThan(0);
    expect(chops).toBeGreaterThan(0);
  }, 60_000);

  test("the blind and dazzled stumble about and neither swing nor cast", () => {
    const { config } = readArenaConfig({ mix: only({ qor: 1, shalille: 1, warrior: 1 }) });
    const last = new Map<number, ArenaPersonWire>();
    let blindTicks = 0,
      stumbles = 0;
    const s = sim(8, config);
    run(s, 6 * 60_000, () => {
      for (const p of s.everyone) {
        const before = last.get(p.id);
        const blind = p.st & (ARENA_STATUS.BLIND | ARENA_STATUS.DAZZLED);
        if (before && blind && before.st & (ARENA_STATUS.BLIND | ARENA_STATUS.DAZZLED)) {
          blindTicks++;
          if (p.ps !== before.ps) expect(["attack", "cast"]).not.toContain(p.pose);
          if (p.x !== before.x || p.y !== before.y) stumbles++;
        }
        last.set(p.id, { ...p });
      }
    });
    expect(blindTicks).toBeGreaterThan(20);
    expect(stumbles).toBeGreaterThan(0);
  }, 60_000);
});

describe("the arena as drawn (ArenaView)", () => {
  const person = (over: Partial<ArenaPersonWire>): ArenaPersonWire => ({
    id: 1, rid: 0, name: "Bram the Bold", arch: "warrior", role: "fighter", look: fighterAppearance(seededRandom(2), { weapon: "swordov.bgf" }),
    x: 10 * SQ, y: 10 * SQ, a: 0, pose: "stand", ps: 0, cf: 0, hp: 50, mhp: 100, st: 0, fade: 100, fd: 0, ...over,
  });
  const state = (people: ArenaPersonWire[]): ArenaState => ({
    t: "arenaState", now: 5000, season: 2, phase: "fight", people, fields: [], shots: [], champions: [{ season: 1, name: "Bram the Bold", arch: "warrior" }],
    labels: { arch: { warrior: "Warrior" }, weapon: { longsword: "long sword" }, spell: {} },
    roster: [{ rid: 0, name: "Bram the Bold", arch: "warrior", weapon: "longsword", spell: null, rec: { wins: 4, losses: 1, kills: 6 }, champ: [1] }],
  });
  const files = (overlays: { iconRes: number }[]) => overlays.map((o) => localResName(o.iconRes));

  test("the winner cheers with their weapon put away, walking or standing", () => {
    const v = new ArenaView();
    v.receive(state([person({})]));
    v.update(0, 16);
    expect(files(v.objects()[0].normal.overlays)).toContain("swordov.bgf");
    v.receive({ t: "arenaTick", now: 5100, phase: "won", mv: [[1, 10 * SQ, 10 * SQ, 0, "cheer", 1, 3, 50, ARENA_STATUS.WINNER, 100, 0]] });
    v.update(1000, 16);
    const o = v.objects()[0];
    expect(files(o.normal.overlays)).not.toContain("swordov.bgf");
    expect(files(o.moving.overlays)).not.toContain("swordov.bgf");
  });

  test("webs on the legs of the stuck, the blinding ring on the blind", () => {
    const v = new ArenaView();
    v.receive(state([person({ st: ARENA_STATUS.WEBBED }), person({ id: 2, rid: -1, role: "spectator", st: ARENA_STATUS.BLIND })]));
    v.update(0, 16);
    const [a, b] = v.objects();
    expect(files(a.normal.overlays)).toContain("webov.bgf");
    expect(files(b.normal.overlays)).toContain("blindring.bgf");
  });

  test("ticks play back a little behind, figures gliding between them", () => {
    const v = new ArenaView({ delayMs: 200 });
    v.receive(state([person({})]));
    v.update(0, 16);
    v.receive({ t: "arenaTick", now: 5100, phase: "fight", mv: [[1, 11 * SQ, 10 * SQ, 0, "walk", 0, 0, 50, 0, 100, 0]] });
    v.update(50, 16);
    // Not yet: it's for 100 ms after the state, shown 200 ms behind
    expect(v.objects()[0].x).toBe(10 * SQ);
    v.update(350, 16);
    const x = v.objects()[0].x;
    expect(x).toBeGreaterThan(10 * SQ);
    expect(x).toBeLessThan(11 * SQ);
    v.update(500, 16);
    expect(v.objects()[0].x).toBe(11 * SQ);
  });

  test("the inspect window: archetype, favourite weapon, the season's record, champion", () => {
    const v = new ArenaView();
    v.receive(state([person({})]));
    v.update(0, 16);
    const info = v.describe(v.objects()[0].id)!;
    expect(info.role).toBe("Warrior");
    expect(info.arena).toMatchObject({ archetype: "Warrior", weapon: "long sword", wins: 4, losses: 1, kills: 6, season: 2, champion: [1], hp: 50, maxHp: 100 });
    expect(info.doing).toBe("Fighting a bout");
  });

  test("the inspect window: whom a spectator cheers for, as the ticks say", () => {
    const v = new ArenaView();
    const fan = person({ id: 2, rid: -1, name: "Wenna", arch: "", role: "spectator", fav: -1 });
    v.receive(state([person({}), fan]));
    v.update(0, 16);
    const id = v.objects()[1].id;
    expect(v.describe(id)!.cheering).toBeUndefined();
    v.receive({ t: "arenaTick", now: 5100, phase: "fight", mv: [[2, 10 * SQ, 10 * SQ, 0, "stand", 0, 0, 1, 0, 100, 0, 1]] });
    v.update(1000, 16);
    expect(v.describe(id)!.cheering).toBe("Bram the Bold");
    // A relay from before favourites sends none: nothing changes
    v.receive({ t: "arenaTick", now: 5200, phase: "fight", mv: [[2, 10 * SQ, 10 * SQ, 0, "stand", 0, 0, 1, 0, 100, 0]] });
    v.update(2000, 16);
    expect(v.describe(id)!.cheering).toBe("Bram the Bold");
  });
});

// ---- the Arena of Death (docs/adr/0019-arena-bouts.md) ----

const haveDeath = existsSync(join(ASSETS, "tosarena_death.roo"));
let deathCache: NavGrid | null = null;
const deathGrid = () => (deathCache ??= navGridOf(parseRoo(new Uint8Array(readFileSync(join(ASSETS, "tosarena_death.roo"))))));

function deathSim(seed: number, config: ArenaConfig = DEATH_ARENA_CONFIG) {
  const g = deathGrid();
  return new ArenaSim(g, {
    config, roster: makeRoster(`${SERVER}|death`, 1, config), records: {}, champions: [], season: 1, seed, now: 1_000_000,
    floorArea: arenaFloorArea("tosarena_death.roo", g),
  });
}

/** The Arena of Death's settings with a roster of only these archetypes */
const deathOnly = (mix: Record<string, number>, over: Record<string, unknown> = {}) =>
  readArenaConfig({ mix: { ...Object.fromEntries(Object.keys(DEATH_ARENA_CONFIG.mix).map((k) => [k, 0])), ...mix }, ...over }, DEATH_ARENA_CONFIG).config;

/** Those fighting on the floor now */
const onFloor = (s: ArenaSim) => s.everyone.filter((p) => p.role !== "spectator" && p.fd >= 0 && !(p.st & (ARENA_STATUS.BEATEN | ARENA_STATUS.WINNER)));

describe("arena settings for each room", () => {
  test("hours that run past midnight", () => {
    expect(arenaOpenAt([22, 6], 23)).toBe(true);
    expect(arenaOpenAt([22, 6], 3)).toBe(true);
    expect(arenaOpenAt([22, 6], 6)).toBe(false);
    expect(arenaOpenAt([22, 6], 12)).toBe(false);
    // Not known: as by day
    expect(arenaOpenAt([22, 6], null)).toBe(false);
    expect(arenaOpenAt([6, 22], null)).toBe(true);
    expect(arenaOpenAt([6, 22], 21)).toBe(true);
    expect(arenaOpenAt([6, 22], 22)).toBe(false);
  });

  test("arena.json: the Arena of Kraanan's at the top, the Arena of Death's under death", () => {
    const { configs, errors } = readArenaConfigs({ spectators: 3, death: { spectators: 5, open: [21, 5] } });
    expect(errors).toEqual([]);
    expect(configs["tosarena.roo"]!.spectators).toBe(3);
    expect(configs["tosarena.roo"]!.open).toEqual([6, 22]);
    expect(configs["tosarena_death.roo"]!.spectators).toBe(5);
    expect(configs["tosarena_death.roo"]!.open).toEqual([21, 5]);
    expect(configs["tosarena_death.roo"]!.floor).toEqual([2, 2]);
    expect(Object.keys(configs["tosarena_death.roo"]!.mix)).toEqual(["gladiator", "qorbattle", "farenbattle", "riijabattle"]);
    expect(readArenaConfigs({ death: { nonsense: 1 } }).errors).toEqual(["death.nonsense: unknown"]);
  });

  test("the Arena of Death's roster: gladiators in heavy armour, battle mages in their schools' robes", () => {
    const roster = makeRoster(`${SERVER}|death`, 1, DEATH_ARENA_CONFIG);
    expect(roster).toHaveLength(16);
    for (const r of roster) {
      const g = r.look.gear;
      if (r.arch === "gladiator") {
        expect(["bte.bgf", "btf.bgf", "bti.bgf", "btj.bgf", "btm.bgf", "btn.bgf"]).toContain(r.look.body);
        // A fine weapon in hand, or a bow
        expect(!!g?.weapon !== !!g?.bow).toBe(true);
        if (g?.bow) expect(g.shield).toBeUndefined();
      } else {
        const school = { qorbattle: "q", farenbattle: "f", riijabattle: "r" }[r.arch]!;
        expect(g?.emblem?.file).toBe(`emblm-${school}${r.look.female ? "f" : "m"}.bgf`);
        expect(g?.hat?.file).toBe(school === "q" ? "thocirclov.bgf" : "circlet.bgf");
        if (school === "q") expect(g?.shield?.file).toBe("osh.bgf");
        if (school === "r") expect(g?.shield?.emblem).toBe("gshriov.bgf");
        if (school === "f") expect(g?.shield).toBeUndefined();
      }
    }
  });
});

describe.skipIf(!haveDeath)("the Arena of Death's fights on the real room", () => {
  test("one against one in the cage, by night; the stands round it; shut by day", () => {
    const s = deathSim(3);
    const g = s.nav;
    const floor = arenaFloorArea("tosarena_death.roo", g);
    // The cage is not the biggest area: the stands round it are
    expect(floor).not.toBe(1);
    let pairs = 0;
    run(s, 4 * 60_000, () => {
      const on = onFloor(s);
      expect(on.length).toBeLessThanOrEqual(2);
      if (s.phase === "fight" && on.length === 2) pairs++;
      for (const p of on) expect(g.area[cellAt(g, p.x, p.y)]).toBe(floor);
      for (const p of s.everyone) if (p.role === "spectator" && p.fd >= 0) expect(g.area[cellAt(g, p.x, p.y)]).not.toBe(floor);
    }, 23);
    expect(pairs).toBeGreaterThan(10);
    const day = deathSim(3);
    run(day, 5000, undefined, 12);
    expect(day.phase).toBe("closed");
    expect(day.everyone).toHaveLength(0);
  }, 30_000);

  test("the same seed gives the same fights", () => {
    const a = deathSim(9),
      b = deathSim(9);
    const ma: string[] = [],
      mb: string[] = [];
    run(a, 40_000, (m) => ma.push(JSON.stringify(m)), 23);
    run(b, 40_000, (m) => mb.push(JSON.stringify(m)), 23);
    expect(mb).toEqual(ma);
  }, 30_000);

  test("a battle mage's Hold leaves its foe standing still", () => {
    const s = deathSim(4, deathOnly({ qorbattle: 1 }, { archetypes: { qorbattle: { spells: [["hold", 1]] } } }));
    let held = 0;
    const stillAt = new Map<number, string>();
    let stayedStill = 0;
    run(s, 90_000, () => {
      for (const p of onFloor(s)) {
        if (!(p.st & ARENA_STATUS.HELD)) {
          stillAt.delete(p.id);
          continue;
        }
        held++;
        const at = `${p.x},${p.y}`;
        if (stillAt.get(p.id) === at) stayedStill++;
        stillAt.set(p.id, at);
      }
    }, 23);
    expect(held).toBeGreaterThan(5);
    expect(stayedStill).toBeGreaterThan(3);
  }, 30_000);

  test("gladiators with bows keep off and shoot arrows, drawing as they do", () => {
    const s = deathSim(6, deathOnly({ gladiator: 1 }, { archetypes: { gladiator: { weapons: ["longbow"] } } }));
    let arrows = 0,
      drawn = 0;
    run(s, 60_000, (m) => {
      arrows += (m.sh ?? []).filter((x) => x.spell === "arrow").length;
      drawn += (m.mv ?? []).filter((mv) => mv[4] === "shoot").length;
    }, 23);
    expect(arrows).toBeGreaterThan(5);
    expect(drawn).toBeGreaterThan(0);
  }, 30_000);

  test("a player's bout takes the floor: the fighters leave, and no round is fought until it's over", () => {
    const s = deathSim(8);
    run(s, 60_000, undefined, 23);
    // Into a round
    for (let k = 0; k < 400 && !(s.phase === "fight" && onFloor(s).length === 2); k++) run(s, 50, undefined, 23);
    expect(onFloor(s)).toHaveLength(2);
    s.setBusy(true);
    run(s, 20_000, undefined, 23);
    expect(s.phase).toBe("rest");
    expect(onFloor(s)).toHaveLength(0);
    // The stands stay
    expect(s.everyone.some((p) => p.role === "spectator" && p.fd >= 0)).toBe(true);
    run(s, 60_000, () => expect(s.phase).toBe("rest"), 23);
    s.setBusy(false);
    let fought = false;
    run(s, 30_000, () => (fought ||= s.phase === "fight"), 23);
    expect(fought).toBe(true);
  }, 30_000);

  test("a busy floor lapses by itself after a while", () => {
    const s = deathSim(2);
    s.setBusy(true);
    run(s, ARENA_BUSY_MAX_MS - 1000, undefined, 23);
    expect(s.busy).toBe(true);
    run(s, 2000, undefined, 23);
    expect(s.busy).toBe(false);
  }, 60_000);
});
