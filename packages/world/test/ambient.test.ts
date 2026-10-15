import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ANIMATE } from "@shards/protocol";
import { kodToClient, parseRoo } from "@shards/formats";
import { PlayerMover } from "../src/movement.ts";
import { buildNavGrid, cellAt, cellCentre, decodeNavGrid, encodeNavGrid, findCells, findPath, isOpen } from "../src/navGrid.ts";
import { AMBIENT_ID_BASE, isAmbientId, localRes, localResName } from "../src/ambient/ambientIds.ts";
import { AmbientLife, seededRandom, type AmbientExits } from "../src/ambient/ambientLife.ts";
import { AMBIENT_ROOMS, busyAt, hourFromSun, isErrandRoom, torchHours, weatherScale } from "../src/ambient/ambientRooms.ts";
import { chatterLine } from "../src/ambient/chatter.ts";
import { Critters, batsOf, habitatOf } from "../src/ambient/critters.ts";
import { SF, floorHeightAt, leafAt } from "@shards/formats";
import {
  FACTIONS, TORCH_LIGHT, fighterAppearance, guardAppearance, isImpressiveBody, knightAppearance, ladyAppearance, lookFor, makePerson, randomAppearance,
  setTorch, twoColorXlat,
} from "../src/ambient/townsfolk.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets-101");
const have = existsSync(join(ASSETS, "tos.roo")) && existsSync(join(ASSETS, "roomexits.json"));
const room = (name: string) => parseRoo(new Uint8Array(readFileSync(join(ASSETS, name))));
const exits = (): Record<string, AmbientExits> => (have ? JSON.parse(readFileSync(join(ASSETS, "roomexits.json"), "utf8")) : {});

describe("ambient ids and art", () => {
  test("ids sit above any server id, art is named by file", () => {
    expect(isAmbientId(AMBIENT_ID_BASE)).toBe(true);
    expect(isAmbientId(0x0fffffff)).toBe(false);
    expect(isAmbientId(-3)).toBe(false);
    const res = localRes("BTA.bgf");
    expect(localRes("bta.bgf")).toBe(res);
    expect(localResName(res)).toBe("bta.bgf");
    expect(localResName(12)).toBeUndefined();
  });
});

describe("townsfolk (player.kod SendOverlays)", () => {
  test("two-colour translations as util.kod EncodeTwoColorXLAT makes them", () => {
    expect(twoColorXlat(6, 1)).toBe(0x87 + 67); // blue cloth, skin 1
    expect(twoColorXlat(11, 2)).toBe(123); // XLAT_REDTODGREEN2
    expect(twoColorXlat(12, 1)).toBe(125); // XLAT_REDTOBLACK1
  });

  test("a player's eight parts, walking arms and legs", () => {
    const a = randomAppearance(seededRandom(3));
    a.hair = "ptad.bgf";
    const stand = lookFor(a, "stand");
    expect(stand.overlays.map((o) => o.hotspot)).toEqual([31, 21, 41, 1, 12, 11, 14, 13]);
    expect(stand.overlays.every((o) => o.anim.type === ANIMATE.NONE && o.anim.group === 0)).toBe(true);
    const walk = lookFor(a, "walk");
    // ANIMATE_CYCLE 100 ms over groups 2..5 for the legs, 200 ms over 2..3 for the arms (0-based here)
    expect(walk.overlays[2].anim).toMatchObject({ type: ANIMATE.CYCLE, period: 100, groupLow: 1, groupHigh: 4 });
    expect(walk.overlays[0].anim).toMatchObject({ type: ANIMATE.CYCLE, period: 200, groupLow: 1, groupHigh: 2 });
    expect(lookFor({ ...a, hair: "" }, "stand").overlays).toHaveLength(7);
    const p = makePerson(a, 1000, 2000, 0);
    expect(isAmbientId(p.id)).toBe(true);
    expect(localResName(p.info.iconRes)).toBe(a.body);
    expect(p.look).toBe(p.normal);
  });
});

describe("dressed for a part (player.kod SendOverlays, the item classes' overlays)", () => {
  const at = (look: ReturnType<typeof lookFor>, hotspot: number) => look.overlays.filter((o) => o.hotspot === hotspot);

  test("a knight: plate, gauntlets, the army's shield and emblem, a weapon held up", () => {
    const k = knightAppearance(seededRandom(11), "duke");
    expect(["bte.bgf", "btf.bgf"]).toContain(k.body);
    expect(k.arms[0]).toMatch(/^bl[ef]\.bgf$/);
    const stand = lookFor(k, "stand");
    // The weapon in the right hand (group 4), the arm bent to hold it (group 17)
    expect(at(stand, 22)[0].anim).toMatchObject({ type: ANIMATE.NONE, group: 3 });
    expect(stand.overlays[1].anim).toMatchObject({ type: ANIMATE.NONE, group: 16 });
    // The soldier's shield (group 2) in the Duke's purple, his emblem over it, the left arm bent
    const [shield, emblem] = at(stand, 32);
    expect(localResName(shield.iconRes)).toBe("gshe.bgf");
    expect(shield.translation).toBe(twoColorXlat(FACTIONS.duke.color, FACTIONS.duke.color));
    expect(shield.anim).toMatchObject({ group: 1 });
    expect(localResName(emblem.iconRes)).toBe("gshdaov.bgf");
    expect(stand.overlays[0].anim).toMatchObject({ group: 6 });
    // Walking, the arms keep holding them
    expect(lookFor(k, "walk").overlays[1].anim).toMatchObject({ type: ANIMATE.NONE, group: 16 });
  });

  test("a swing (PANM_WEAPON_ATTACK) plays once and ends holding the weapon", () => {
    const f = fighterAppearance(seededRandom(5));
    const swing = lookFor(f, "attack");
    // The body bends into it too (player.kod SendAnimation), or the arms come away from it
    expect(swing.anim).toMatchObject({ type: ANIMATE.ONCE, period: 300, groupLow: 1, groupHigh: 3, groupFinal: 0 });
    expect(swing.overlays[1].anim).toMatchObject({ type: ANIMATE.ONCE, period: 300, groupLow: 3, groupHigh: 5, groupFinal: 16 });
    expect(at(swing, 22)[0].anim).toMatchObject({ type: ANIMATE.ONCE, groupLow: 0, groupHigh: 2, groupFinal: 3 });
    expect(swing.overlays[2].anim).toMatchObject({ type: ANIMATE.ONCE, period: 900 });
  });

  test("helms that hide the hair do (RemoveHair); circlets sit over it", () => {
    const k = knightAppearance(seededRandom(2), "princess");
    k.hair = "ptad.bgf";
    k.gear!.hat = { file: "khelm.bgf", hidesHair: true };
    expect(at(lookFor(k, "stand"), 13).map((o) => localResName(o.iconRes))).toEqual(["khelm.bgf"]);
    const lady = ladyAppearance(seededRandom(4));
    lady.hair = "ptca.bgf";
    expect(at(lookFor(lady, "stand"), 13).map((o) => localResName(o.iconRes))).toEqual(["ptca.bgf", lady.gear!.hat!.file]);
    expect(lady.body).toBe("btd.bgf");
  });

  test("guards wear leather in the town's colours; a torch takes the shield's hand", () => {
    const g = guardAppearance(seededRandom(9), 6);
    expect(["btg.bgf", "bth.bgf"]).toContain(g.body);
    g.gear!.shield = { file: "metlshld.bgf", xlat: 0 };
    const lit = lookFor(g, "walk", true);
    expect(at(lit, 32).map((o) => localResName(o.iconRes))).toEqual(["torchov.bgf"]);
  });

  test("emotes: a dance (PANM_DANCE), a point, a cast, and our cheer, a held frame of the dance", () => {
    const a = randomAppearance(seededRandom(21));
    a.gear = undefined;
    const dance = lookFor(a, "dance");
    expect(dance.anim).toMatchObject({ type: ANIMATE.CYCLE, period: 150, groupLow: 5, groupHigh: 21 });
    expect(dance.overlays[0].anim).toMatchObject({ groupLow: 9, groupHigh: 25 });
    expect(dance.overlays[1].anim).toMatchObject({ groupLow: 17, groupHigh: 33 });
    expect(dance.overlays[2].anim).toMatchObject({ groupLow: 7, groupHigh: 23 });
    expect(lookFor(a, "point").overlays[1].anim).toMatchObject({ type: ANIMATE.ONCE, period: 700, groupLow: 11, groupHigh: 11, groupFinal: 0 });
    const cast = lookFor(a, "cast");
    expect(cast.overlays[0].anim).toMatchObject({ groupLow: 7 });
    expect(cast.overlays[1].anim).toMatchObject({ groupLow: 10 });
    // The same point in the dance for the body, arms and legs, held still
    const cheer = lookFor(a, "cheer", false, 5);
    expect(cheer.anim).toMatchObject({ type: ANIMATE.NONE, group: 10 });
    expect(cheer.overlays[0].anim).toMatchObject({ type: ANIMATE.NONE, group: 14 });
    expect(cheer.overlays[1].anim).toMatchObject({ type: ANIMATE.NONE, group: 22 });
    expect(cheer.overlays[2].anim).toMatchObject({ type: ANIMATE.NONE, group: 12 });
  });

  test("every helmet hides the hair (RemoveHair), whoever wears it", () => {
    for (let k = 0; k < 200; k++) {
      const r = seededRandom(k);
      for (const a of [knightAppearance(r, "duke"), guardAppearance(r, 3), fighterAppearance(r)]) {
        if (!a.gear?.hat) continue;
        a.hair = "ptad.bgf";
        expect(a.gear.hat.hidesHair).toBe(true);
        expect(lookFor(a, "stand").overlays.some((o) => localResName(o.iconRes) === "ptad.bgf")).toBe(false);
      }
    }
  });

  test("nobody wears the steel helm", () => {
    for (let k = 0; k < 300; k++) {
      const r = seededRandom(k);
      for (const a of [knightAppearance(r, "duke"), guardAppearance(r, 3), fighterAppearance(r)]) expect(a.gear?.hat?.file ?? "").not.toMatch(/whelm/);
    }
  });

  test("armour worth a second look", () => {
    expect(["bte.bgf", "BTM.bgf", "btk.bgf"].every(isImpressiveBody)).toBe(true);
    expect(["bta.bgf", "btg.bgf", "btc.bgf"].some(isImpressiveBody)).toBe(false);
  });
});

describe("what they say (ours)", () => {
  test("by the weather, the place and who's talking", () => {
    const lines = (ctx: Parameters<typeof chatterLine>[1]) => new Set(Array.from({ length: 200 }, (_, k) => chatterLine(seededRandom(k), ctx)));
    const wet = lines({ role: "folk", hour: 12, weather: "rain", place: "tos" });
    expect([...wet].some((l) => /rain|soaked|hood|puddle|crops/i.test(l))).toBe(true);
    // Indoors the rain isn't mentioned
    expect([...lines({ role: "patron", hour: 12, weather: "rain" })].some((l) => /rain|soaked/i.test(l))).toBe(false);
    expect([...lines({ role: "folk", hour: 12, weather: null, greeting: true })].every((l) => l.length < 30)).toBe(true);
    expect(lines({ role: "fighter", hour: 12, weather: null, place: "arena" }).size).toBeGreaterThan(3);
  });

  test("errands go to smiths, banks and shops; the weather thins the streets", () => {
    expect(["tossmith.roo", "jasbank.roo", "barmerch.roo", "corgroc.roo"].every(isErrandRoom)).toBe(true);
    expect(["tosinn.roo", "duke1.roo", null].some(isErrandRoom)).toBe(false);
    expect(weatherScale("town", "rain")).toBeLessThan(1);
    expect(weatherScale("inn", "snow")).toBeGreaterThan(1);
  });
});

describe("the time of day", () => {
  test("the hour from the sun, as sun.kod places it", () => {
    for (let h = 0; h < 24; h++) expect(hourFromSun(((h + 19) % 24) * 130)).toBe(h);
  });

  test("streets empty at night, inns fill in the evening; torches after dark", () => {
    expect(busyAt("town", 12)).toBe(1);
    expect(busyAt("town", 3)).toBeLessThan(0.5);
    expect(busyAt("inn", 20)).toBeGreaterThan(busyAt("inn", 10));
    expect(busyAt("town", null)).toBe(1);
    expect([18, 19, 22, 3, 5, 6, 12].map(torchHours)).toEqual([false, true, true, true, true, false, false]);
  });

  test("a torch in the left hand, the arm bent to hold it, and its light (torch.kod)", () => {
    const a = randomAppearance(seededRandom(8));
    const lit = lookFor(a, "walk", true);
    expect(lit.overlays.at(-1)).toMatchObject({ iconRes: localRes("torchov.bgf"), hotspot: 32 });
    expect(lit.overlays.at(-1)!.anim).toMatchObject({ type: ANIMATE.CYCLE, period: 60, groupLow: 0, groupHigh: 5 });
    // The left arm holds still, bent (group 7), while walking
    expect(lit.overlays[0].anim).toMatchObject({ type: ANIMATE.NONE, group: 6 });
    const p = makePerson(a, 0, 0, 0);
    setTorch(p, a, "walk", true);
    expect(p.info.light).toEqual(TORCH_LIGHT);
    expect(p.look).toBe(p.moving);
    setTorch(p, a, "stand", false);
    expect(p.info.light.intensity).toBe(0);
    expect(p.look.overlays.some((o) => o.hotspot === 32)).toBe(false);
  });
});

describe.skipIf(!have)("nav grid and ambient life on real rooms", () => {
  test("paths between Tos's doors are ones move.c lets a player walk", () => {
    const tos = room("tos.roo");
    const g = buildNavGrid(tos);
    const pts = exits()["tos.roo"].arrivals.map(([r, c]) => kodToClient(r, c));
    let walked = 0,
      arrived = 0;
    for (let k = 0; k < pts.length && walked < 20; k++)
      for (let j = k + 1; j < pts.length && walked < 20; j += 3) {
        const path = findPath(g, pts[k], pts[j]);
        if (!path) continue;
        walked++;
        // Walk a PlayerMover (move.c) along it, walls and all. Its steps drift a little off a
        // long straight line (they're truncated), so the odd one may graze a corner
        const m = new PlayerMover({ move: () => {}, turn: () => {} });
        m.room = tos;
        m.place(pts[k].x, pts[k].y, 0);
        let t = 1000,
          ok = true;
        for (const p of path) {
          for (let n = 0; n < 2000 && Math.hypot(p.x - m.x, p.y - m.y) > 200; n++) {
            m.setAngle(Math.round((Math.atan2(p.y - m.y, p.x - m.x) * 4096) / (2 * Math.PI)));
            m.update({ forward: 1, strafe: 0, run: false }, 30, (t += 30), [], 0);
          }
          if (Math.hypot(p.x - m.x, p.y - m.y) > 200) ok = false;
          if (!ok) break;
        }
        if (ok) arrived++;
      }
    expect(walked).toBeGreaterThan(10);
    expect(arrived / walked).toBeGreaterThanOrEqual(0.9);
  }, 30000);

  test("no path between areas that don't connect", () => {
    const g = buildNavGrid(room("tos.roo"));
    const a = g.area.indexOf(1),
      b = g.area.indexOf(2);
    expect(findCells(g, a, b)).toBeNull();
    expect(findCells(g, a, g.area.lastIndexOf(1))).not.toBeNull();
  });

  test("a grid built once (the asset build's nav/*.nav) reads back the same, for its own room only", () => {
    const tos = room("tos.roo");
    const g = buildNavGrid(tos);
    const back = decodeNavGrid(encodeNavGrid(g, tos), tos)!;
    expect(back).not.toBeNull();
    expect(back.walk).toEqual(g.walk);
    expect(back.links).toEqual(g.links);
    expect(back.area).toEqual(g.area);
    expect(back.blockers).toHaveLength(g.blockers.length);
    // Another room, or another version of this one: build it instead
    expect(decodeNavGrid(encodeNavGrid(g, tos), room("tosinn.roo"))).toBeNull();
    expect(decodeNavGrid(encodeNavGrid(g, { ...tos, security: tos.security + 1 }), tos)).toBeNull();
  });

  test("a crowd on a grid built beforehand starts at once", () => {
    const inn = room("tosinn.roo");
    const life = new AmbientLife(inn, AMBIENT_ROOMS["tosinn.roo"], exits()["tosinn.roo"], 3, buildNavGrid(inn));
    life.update(16, { player: null, scale: 1 });
    life.update(16, { player: null, scale: 1 });
    expect(life.ready).toBe(true);
    expect(life.objects().length).toBeGreaterThan(0);
  });

  /** `prebuilt`: hand it its grid, so nothing depends on how fast the machine builds one */
  function run(name: string, seconds: number, seed: number, prebuilt = false) {
    const r = room(name);
    const life = new AmbientLife(r, AMBIENT_ROOMS[name], exits()[name], seed, prebuilt ? buildNavGrid(r) : undefined);
    const seen = new Set<number>();
    const counts: number[] = [];
    let offGrid = 0;
    for (let t = 0; t < seconds * 1000; t += 33) {
      life.update(33, { player: null, scale: 1 });
      for (const o of life.objects()) {
        seen.add(o.id);
        const c = cellAt(life.nav!, o.x, o.y);
        if (!isOpen(life.nav!, c)) offGrid++;
      }
      counts.push(life.objects().length);
    }
    return { life, seen, counts, offGrid };
  }

  test("townsfolk come and go, about as many as asked for", () => {
    const { seen, counts } = run("tos.roo", 120, 5);
    const late = counts.slice(-1000);
    expect(Math.max(...late)).toBeLessThanOrEqual(AMBIENT_ROOMS["tos.roo"].count + (AMBIENT_ROOMS["tos.roo"].guards ?? 0) + 2);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(AMBIENT_ROOMS["tos.roo"].count / 2);
    // People went in and others came out
    expect(seen.size).toBeGreaterThan(AMBIENT_ROOMS["tos.roo"].count);
  }, 30000);

  test("inn patrons stay inside, on the floor", () => {
    const { life, counts } = run("tosinn.roo", 90, 9);
    expect(counts.at(-1)).toBeGreaterThan(0);
    for (const o of life.objects()) expect(isOpen(life.nav!, cellAt(life.nav!, o.x, o.y)) || o.info.drawingType !== 0).toBe(true);
  }, 30000);

  test("the same seed makes the same crowd", () => {
    const a = run("tosinn.roo", 20, 42, true).life.objects().map((o) => [o.x, o.y, o.info.iconRes]);
    const b = run("tosinn.roo", 20, 42, true).life.objects().map((o) => [o.x, o.y, o.info.iconRes]);
    expect(a).toEqual(b);
  }, 30000);

  test("at night the streets thin out and townsfolk carry torches; inn patrons don't", () => {
    const night = (name: string) => {
      const life = new AmbientLife(room(name), AMBIENT_ROOMS[name], exits()[name], 4, buildNavGrid(room(name)));
      for (let t = 0; t < 30000; t += 33) life.update(33, { player: null, scale: 1, hour: 2 });
      return life.objects();
    };
    const town = night("tos.roo");
    expect(town.length).toBeLessThanOrEqual(Math.round(AMBIENT_ROOMS["tos.roo"].count * busyAt("town", 2)) + (AMBIENT_ROOMS["tos.roo"].guards ?? 0) + 1);
    expect(town.some((o) => o.info.light.intensity > 0)).toBe(true);
    expect(night("tosinn.roo").every((o) => o.info.light.intensity === 0)).toBe(true);
  }, 30000);

  /** Some private state, for the tests */
  type Inside = {
    walkers: { role: string; obj: { id: number; x: number; y: number }; fleeing: boolean; beat: unknown; bout: unknown; fadeDir: number; leaving: boolean; beaten: boolean }[];
    points: { at: { x: number; y: number }; door: boolean; cell: number }[];
    bouts: unknown[];
  };
  const inside = (l: AmbientLife) => l as unknown as Inside;

  test("townsfolk go in at the middle of a door, not beside it", () => {
    const r = room("tos.roo");
    const grid = buildNavGrid(r);
    const life = new AmbientLife(r, AMBIENT_ROOMS["tos.roo"], exits()["tos.roo"], 12, grid);
    const gone = new Set<number>();
    let checked = 0;
    for (let t = 0; t < 120000; t += 33) {
      life.update(33, { player: null, scale: 1, hour: 12 });
      for (const w of inside(life).walkers) {
        if (w.fadeDir >= 0 || gone.has(w.obj.id) || w.beat) continue;
        gone.add(w.obj.id);
        // Those who go in by a door go in at its middle; the rest (no door they can reach: the
        // 101 Tos has walled-off pockets) leave out of sight, away from any door (AmbientLife.leave)
        const doors = inside(life).points.filter((p) => p.door);
        const near = Math.min(...doors.map((p) => Math.hypot(p.at.x - w.obj.x, p.at.y - w.obj.y)));
        const reachable = doors.some((p) => findPath(grid, w.obj, cellCentre(grid, p.cell)));
        if (near > 2 * 1024 || !reachable) continue;
        checked++;
        expect(near).toBeLessThan(64);
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 30000);

  test("guards pace a beat; the castles' knights carry their army's shield", () => {
    const keep = room("duke1.roo");
    const life = new AmbientLife(keep, AMBIENT_ROOMS["duke1.roo"], exits()["duke1.roo"], 6, buildNavGrid(keep));
    const start = { x: 50 * 1024, y: 52 * 1024 };
    for (let t = 0; t < 20000; t += 33) life.update(33, { player: start, scale: 1, hour: 12 });
    const ws = inside(life).walkers;
    expect(ws.filter((w) => w.beat)).toHaveLength(AMBIENT_ROOMS["duke1.roo"].guards!);
    const knights = life.objects().filter((o) => ["bte.bgf", "btf.bgf"].includes(localResName(o.info.iconRes)!));
    expect(knights.length).toBeGreaterThanOrEqual(AMBIENT_ROOMS["duke1.roo"].guards!);
    for (const k of knights) expect(k.normal.overlays.some((o) => localResName(o.iconRes) === "gshdaov.bgf")).toBe(true);
    // Those who stay keep about the player in a big courtyard
    const near = ws.filter((w) => !w.beat && Math.hypot(w.obj.x - start.x, w.obj.y - start.y) < 20 * 1024);
    expect(near.length).toBeGreaterThan(0);
  }, 30000);

  test("a spell sends them running; rain thins the streets", () => {
    const r = room("tos.roo");
    const grid = buildNavGrid(r);
    const life = new AmbientLife(r, AMBIENT_ROOMS["tos.roo"], exits()["tos.roo"], 8, grid);
    for (let t = 0; t < 10000; t += 33) life.update(33, { player: null, scale: 1, hour: 12 });
    const folk = inside(life).walkers.find((w) => w.role === "folk" && w.fadeDir >= 0)!;
    life.scatter({ x: folk.obj.x + 100, y: folk.obj.y }, 6 * 1024);
    expect(folk.fleeing).toBe(true);
    const count = (weather: "rain" | null) => {
      const l = new AmbientLife(r, AMBIENT_ROOMS["tos.roo"], exits()["tos.roo"], 8, grid);
      for (let t = 0; t < 60000; t += 33) l.update(33, { player: null, scale: 1, hour: 12, weather });
      return inside(l).walkers.filter((w) => !w.beat && w.fadeDir >= 0).length;
    };
    expect(count("rain")).toBeLessThan(count(null));
  }, 30000);

  test("nobody when the setting is off", () => {
    const life = new AmbientLife(room("tosinn.roo"), AMBIENT_ROOMS["tosinn.roo"], exits()["tosinn.roo"], 1);
    for (let t = 0; t < 5000; t += 33) life.update(33, { player: null, scale: 0 });
    expect(life.objects()).toHaveLength(0);
  });

  test("bats: caves, dungeons, crypts and Brax, prisons; nowhere else", () => {
    expect(batsOf("ratcave1.roo", ["CAVES"])).toBe("covered");
    expect(batsOf("castle1.roo", undefined)).toBe("covered");
    expect(batsOf("necarea3.roo", ["NECROPOLIS"])).toBe("necropolis");
    expect(batsOf("toscrypt.roo", ["CITY", "NECROPOLIS"])).toBe("necropolis");
    expect(batsOf("berg_jail.roo", undefined)).toBe("necropolis");
    for (const [f, t] of [["tos.roo", ["CITY"]], ["b6.roo", ["HILLS", "MOUNTAIN"]], ["forest1.roo", ["FOREST"]], ["barlsew.roo", ["SEWERS"]]] as const)
      expect(batsOf(f, t)).toBeNull();
  });

  test("critters by terrain: what lives where", () => {
    expect(habitatOf("barlsew.roo", ["SEWERS", "WATERFALL"])?.name).toBe("sewer");
    expect(habitatOf("ratcave1.roo", ["CAVES"])?.mix.map(([n]) => n)).toContain("spider");
    expect(habitatOf("b6.roo", ["HILLS", "MOUNTAIN"])?.mix.map(([n]) => n)).toEqual(["mutantAnt", "scorpion"]);
    expect(habitatOf("tos.roo", ["CITY", "FOUNTAIN", "ROAD"])?.mix).toEqual([["rat", 1]]);
    expect(habitatOf("tosinn.roo", ["CITY", "SHOP"])?.name).toBe("indoors");
    // No terrain: a town street by ambientRooms.ts, a town building, or nothing
    expect(habitatOf("barln.roo", undefined)?.name).toBe("street");
    expect(habitatOf("barinn.roo", undefined)?.name).toBe("indoors");
    expect(habitatOf("godroom.roo", ["MYSTICAL"])).toBeNull();
    // Rats in every vault, none at the arena
    for (const v of ["barvault.roo", "bergvault.roo", "jasvault.roo", "razavault.roo", "kocbank.roo"]) expect(habitatOf(v, ["CITY", "SHOP"])?.mix).toEqual([["rat", 1]]);
    expect(habitatOf("tosarena.roo", ["CITY"])).toBeNull();
    expect(habitatOf("tosaren2.roo", ["CITY"])).toBeNull();
  });

  test("critters come out on dry floor about us, run about, and die at a click", () => {
    const terrain: Record<string, string[]> = JSON.parse(readFileSync(join(ASSETS, "roomterrain.json"), "utf8"));
    for (const name of ["barlsew.roo", "forest2.roo", "cave2.roo", "b6.roo"]) {
      const r = room(name);
      const c = new Critters(r, habitatOf(name, terrain[name])!, 6);
      // Stand where critters can be (a sewer's walkways are narrow): one of the spots it finds
      const inside = c as unknown as { sampler: Generator | null; spots: number[] };
      while (inside.sampler && !inside.sampler.next().done);
      inside.sampler = null;
      const mid = Math.floor(inside.spots.length / 6) * 3;
      const player = { x: inside.spots[mid], y: inside.spots[mid + 1] };
      let moved = 0;
      const start = new Map<number, string>();
      for (let t = 0; t < 30000; t += 33) {
        c.update(33, { player, scale: 1, facing: 0, hour: 12 });
        for (const o of c.objects()) {
          if (!start.has(o.id)) start.set(o.id, `${o.x},${o.y}`);
          else if (start.get(o.id) !== `${o.x},${o.y}`) moved++;
          const leaf = leafAt(r, o.x, o.y);
          expect(leaf?.sector, name).toBeTruthy();
          const s = r.sectors[leaf!.sector - 1];
          // Dry floor, or shallow water where they swim (the sewer)
          expect(s.flags & SF.DEPTH_MASK, name).toBeLessThanOrEqual(c.habitat.wades ? 1 : 0);
          expect(Number.isFinite(floorHeightAt(s, o.x, o.y))).toBe(true);
        }
      }
      expect(c.objects().length, name).toBeGreaterThan(0);
      expect(moved, name).toBeGreaterThan(0);
      const victim = c.objects()[0];
      expect(c.has(victim.id)).toBe(true);
      expect(c.squish(victim.id)?.sound, name).toMatch(/_dth\.ogg$/);
      expect(c.has(victim.id)).toBe(false);
      expect(c.squish(victim.id)).toBeNull();
      // The corpse lies a while, then goes
      for (let t = 0; t < 8000; t += 33) c.update(33, { player, scale: 1, facing: 0, hour: 12 });
      expect(c.objects().some((o) => o.id === victim.id)).toBe(false);
    }
  }, 60000);
});
