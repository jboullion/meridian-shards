import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerInfo } from "../../packages/protocol/src/index.ts";
import { findRoute, squareOf, walkable, WorldState, type GameSession, type WorldObject } from "../../packages/world/src/index.ts";
import { GameData } from "./assets.ts";
import { Body } from "./body.ts";
import { walkTo } from "./walker.ts";

const ASSETS = join(import.meta.dirname, "..", "..", "dist", "assets");
const have = existsSync(join(ASSETS, "raza.roo")) && existsSync(join(ASSETS, "roomexits.json")) && existsSync(join(ASSETS, "rsc0000.rsb"));
const SQ = 1024;

const gameData = () =>
  new GameData({ assetsDir: ASSETS, rsbPath: join(ASSETS, "rsc0000.rsb"), configPath: join(import.meta.dirname, "..", "..", "server", "config", "blakserv.cfg") });

/** A body standing in a room (Raza by default) with a session that only records what it sends */
function inRaza(data: GameData, row: number, col: number, file = "raza.roo") {
  const world = new WorldState();
  world.player = { id: 100, nameRes: 1, roomNameRes: 2, roomRes: 9 } as PlayerInfo;
  world.objects.set(100, { id: 100, info: { id: 100, nameRes: 1 }, x: (col - 0.5) * SQ, y: (row - 0.5) * SQ, angle: 0, motion: null } as unknown as WorldObject);
  const moves: { x: number; y: number }[] = [];
  const session = {
    phase: "game",
    world,
    resource: (id: number) => (id === 9 ? file : id === 1 ? "Shardscout" : ""),
    requestMove: (x: number, y: number) => moves.push({ x, y }),
    requestTurn: () => {},
    go: () => {},
  };
  const body = new Body(data);
  body.session = session as unknown as GameSession;
  return { body, world, moves };
}

describe.skipIf(!have)("walking real rooms", () => {
  afterEach(() => void vi.useRealTimers());

  it("finds rooms by number, file and name", () => {
    const data = gameData();
    expect(data.findRoom("300")?.roo).toBe("raza.roo");
    expect(data.findRoom("razainn")?.rid).toBe(301);
    expect(data.findRoom("The Inn of Raza")?.roo).toBe("razainn.roo");
    expect(data.findRoom("blacksmith of raza")?.roo).toBe("razasmith.roo");
  });

  it("knows the way on foot from Raza to Marion", () => {
    const route = findRoute(gameData().exits, "raza.roo", new Set(["marion.roo"]));
    expect(route?.[0]).toBe("raza.roo");
    expect(route?.at(-1)).toBe("marion.roo");
  });

  it("walks as near as the floor goes to someone behind a counter (the Bank of Raza's Gamos)", async () => {
    vi.useFakeTimers();
    const data = gameData();
    // In from the door; Gamos stands at row 6, col 7, behind his counter
    const { body, world } = inRaza(data, 5, 2, "razabank.roo");
    const walking = walkTo(body, 6, 7);
    for (let i = 0; i < 100; i++) await vi.advanceTimersByTimeAsync(250);
    const r = await walking;
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/as close as the floor allows/);
    expect(squareOf(world.self!)[1]).toBeGreaterThanOrEqual(5);
  });

  it("walks across Raza in steps that never go through a wall", async () => {
    vi.useFakeTimers();
    const data = gameData();
    const grid = (await data.room("raza.roo"))!.grid!;
    // From outside the inn's door to outside the smithy's
    const { body, world, moves } = inRaza(data, 8, 27);
    const walking = walkTo(body, 18, 46);
    for (let i = 0; i < 400 && moves.length < 1000; i++) await vi.advanceTimersByTimeAsync(250);
    const r = await walking;
    expect(r.ok).toBe(true);
    expect(squareOf(world.self!)).toEqual([18, 46]);
    let from = { x: 26.5 * SQ, y: 7.5 * SQ };
    for (const m of moves) {
      expect(walkable(grid, from.x, from.y, m.x, m.y, 0)).toBe(true);
      from = m;
    }
  });
});
