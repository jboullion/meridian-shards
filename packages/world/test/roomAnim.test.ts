import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ANIMATE, CHANGE_OVERRIDE, CTF, RA } from "@shards/protocol";
import { WF, parseRoo } from "@shards/formats";
import { LiveRoom } from "../src/roomAnim.ts";
import { PlayerMover } from "../src/movement.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "razacrypt.roo")) && existsSync(join(ASSETS, "raza.roo"));
const load = (f: string) => parseRoo(new Uint8Array(readFileSync(join(ASSETS, f))));

describe.skipIf(!have)("room changes (roomanim.c)", () => {
  // razacrypt.kod: SECTOR_DOOR = 3, a ceiling that lifts (84 shut, 172 open, Kod units)
  const DOOR = 3;

  test("the crypt door lifts at its speed, its walls follow, and the file's room stays as it was", () => {
    const base = load("razacrypt.roo");
    const live = new LiveRoom(base);
    const door = live.room.sectors.findIndex((s) => s.serverId === DOOR);
    expect(live.room.sectors[door].ceilingHeight).toBe(84 * 16);
    live.apply({ type: "sectorMove", animation: ANIMATE.CEILING_LIFT, sector: DOOR, height: 172, speed: 16 });
    expect(live.animating).toBe(true);
    // 16 Kod units/s = 256 fine units/s, over 88 * 16 = 1408 fine units: 5.5 s
    live.tick(2750);
    expect(live.room.sectors[door].ceilingHeight).toBe(84 * 16 + 704);
    live.tick(3000);
    expect(live.animating).toBe(false);
    expect(live.room.sectors[door].ceilingHeight).toBe(172 * 16);
    // SectorAdjustHeight -> SetWallHeights: the door's walls reach the new ceiling
    const walls = live.room.walls.filter((w) => w.posSector === door + 1 || w.negSector === door + 1);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.some((w) => w.z2 === 172 * 16 || w.z3 === 172 * 16)).toBe(true);
    expect(load("razacrypt.roo").walls.some((w) => w.z2 === 172 * 16 || w.z3 === 172 * 16)).toBe(false);
    expect(base.sectors[door].ceilingHeight).toBe(84 * 16);
  });

  test("speed 0 is at once (what the server sends on entering)", () => {
    const live = new LiveRoom(load("razacrypt.roo"));
    live.apply({ type: "sectorMove", animation: ANIMATE.FLOOR_LIFT, sector: 4, height: 105, speed: 0 });
    expect(live.animating).toBe(false);
    expect(live.room.sectors.find((s) => s.serverId === 4)!.floorHeight).toBe(105 * 16);
  });

  test("the open door lets you through; the shut one doesn't", () => {
    const run = (open: boolean) => {
      const live = new LiveRoom(load("razacrypt.roo"));
      if (open) live.apply({ type: "sectorMove", animation: ANIMATE.CEILING_LIFT, sector: DOOR, height: 172, speed: 0 });
      const door = live.room.sectors.findIndex((s) => s.serverId === DOOR) + 1;
      // a wall between the door's sector and the corridor beside it
      const wall = live.room.walls.find((w) => (w.posSector === door) !== (w.negSector === door) && w.posSector && w.negSector)!;
      const m = new PlayerMover({ move: () => {}, turn: () => {} });
      m.room = live.room;
      // stand a little on the far side of the wall's midpoint, then walk across it
      const mx = (wall.x0 + wall.x1) / 2, my = (wall.y0 + wall.y1) / 2;
      const nx = -(wall.y1 - wall.y0), ny = wall.x1 - wall.x0;
      const len = Math.hypot(nx, ny);
      const side = wall.posSector === door ? -1 : 1;
      m.place(mx + (side * nx * 300) / len, my + (side * ny * 300) / len, 0);
      m.angle = Math.round((Math.atan2(-side * ny, -side * nx) * 4096) / (2 * Math.PI)) & 4095;
      let t = 0;
      for (let i = 0; i < 60; i++) m.update({ forward: 1, strafe: 0, run: false }, 16, (t += 16), [], 0);
      return Math.hypot(m.x - mx, m.y - my) * Math.sign((m.x - mx) * nx + (m.y - my) * ny) * -side;
    };
    expect(run(false)).toBeLessThan(0); // still on our side
    expect(run(true)).toBeGreaterThan(0); // through
  });

  test("the Raza clock shows the hour's group (raza.kod AnimateWall, ANIMATE_NONE)", () => {
    const live = new LiveRoom(load("raza.roo"));
    live.apply({ type: "wallAnimate", wall: 1, animation: { type: ANIMATE.NONE, group: 5 }, action: RA.NONE });
    const face = live.room.sidedefs.filter((s) => s.serverId === 1);
    expect(face.length).toBeGreaterThan(0);
    expect(face.every((s) => s.group === 4)).toBe(true); // 1-based from the server
    expect(live.animating).toBe(false);
  });

  test("a wall that animates once and then vanishes (RA_INVISIBLE_END)", () => {
    const live = new LiveRoom(load("raza.roo"));
    live.apply({ type: "wallAnimate", wall: 1, animation: { type: ANIMATE.ONCE, period: 100, groupLow: 1, groupHigh: 3, groupFinal: 3 }, action: RA.INVISIBLE_END });
    const s = live.room.sidedefs.find((sd) => sd.serverId === 1)!;
    expect(s.flags & WF.PASSABLE).toBe(0);
    for (let i = 0; i < 10; i++) live.tick(100);
    expect(live.animating).toBe(false);
    expect(s.flags & WF.PASSABLE).toBe(WF.PASSABLE);
    expect(s.normalType).toBe(0);
  });

  test("texture changes and sector flags (snow on the ground, frozen water)", () => {
    const live = new LiveRoom(load("raza.roo"));
    live.apply({ type: "changeTexture", id: 15, texture: 61016, flags: CTF.BELOWWALL });
    expect(live.room.sidedefs.filter((s) => s.serverId === 15).every((s) => s.belowType === 61016)).toBe(true);
    expect(live.textureIds().has(61016)).toBe(true);
    const sector = live.room.sectors[0];
    sector.serverId = 99;
    sector.flags = 0x2 | (2 << 2) | (3 << 4) | 0x80;
    live.apply({ type: "sectorChange", sector: 99, depth: 0, scroll: 0 });
    expect(sector.flags).toBe(0);
    sector.flags = 0x1 | (3 << 4) | 0x80;
    live.apply({ type: "sectorChange", sector: 99, depth: CHANGE_OVERRIDE, scroll: 2 });
    expect(sector.flags).toBe(0x1 | (2 << 2) | (3 << 4) | 0x80);
  });
});
