import { describe, expect, test } from "vitest";
import { ANIMATE, BP, ByteReader, ByteWriter } from "@shards/protocol";
import { animStateFrom, animStep } from "../src/animation.ts";
import { WorldState, kodToFine } from "../src/state.ts";

describe("animation (animate.c AnimateSingle)", () => {
  test("cycle through a range, 1-based groups from the server", () => {
    const a = animStateFrom({ type: ANIMATE.CYCLE, period: 100, groupLow: 2, groupHigh: 4 });
    expect(a.group).toBe(1);
    expect(animStep(a, 10, 50)).toBe(false);
    expect(animStep(a, 10, 50)).toBe(true);
    expect(a.group).toBe(2);
    animStep(a, 10, 100);
    animStep(a, 10, 100);
    expect(a.group).toBe(1); // wrapped to low
  });
  test("low == high cycles every group", () => {
    const a = animStateFrom({ type: ANIMATE.CYCLE, period: 10, groupLow: 1, groupHigh: 1 });
    for (let i = 0; i < 3; i++) animStep(a, 3, 10);
    expect(a.group).toBe(0);
  });
  test("once ends on the final group", () => {
    const a = animStateFrom({ type: ANIMATE.ONCE, period: 10, groupLow: 1, groupHigh: 2, groupFinal: 5 });
    animStep(a, 0, 10);
    animStep(a, 0, 10);
    expect(a.type).toBe(ANIMATE.NONE);
    expect(a.group).toBe(4);
  });
});

/** A minimal room object as the server writes it (no amount, no light, no overlays). */
function roomObject(w: ByteWriter, id: number, row: number, col: number, angle: number) {
  w.u32(id).u32(100).u32(200).u32(1).u8(0).u32(0).u32(0).u8(0).u8(0);
  w.u16(0); // light flags
  w.u8(ANIMATE.NONE).u16(1); // animation: group 1
  w.u8(0); // overlays
  w.u16(row).u16(col).u16(angle);
  w.u8(ANIMATE.NONE).u16(1).u8(0); // motion animation + overlays
}

describe("WorldState", () => {
  test("room contents, move, turn, remove", () => {
    const world = new WorldState();
    const events: string[] = [];
    world.on((e) => events.push(e.type));
    const w = new ByteWriter().u32(55).u16(2);
    roomObject(w, 1, 192, 512, 1024);
    roomObject(w, 2, 256, 256, 0);
    expect(world.handle(BP.ROOM_CONTENTS, new ByteReader(w.finish()))).toBe(true);
    expect(world.objects.size).toBe(2);
    const o = world.objects.get(1)!;
    expect(o.normal.anim.group).toBe(0);
    expect([o.x, o.y]).toEqual([kodToFine(512), kodToFine(192)]);
    // speed 25 = 2.5 squares / 10 s; moving 0.13 squares takes ~50 ms, interpolated (moveobj.c)
    world.handle(BP.MOVE, new ByteReader(new ByteWriter().u32(1).u16(200).u16(520).u8(25).finish()));
    expect(o.motion).not.toBeNull();
    expect(o.look).toBe(o.moving);
    world.tick(10);
    expect(o.x).toBeGreaterThan(kodToFine(512));
    world.tick(1000);
    expect([o.x, o.y]).toEqual([kodToFine(520), kodToFine(200)]);
    expect(o.look).toBe(o.normal);
    world.handle(BP.TURN, new ByteReader(new ByteWriter().u32(1).u16(2048).finish()));
    expect(world.objects.get(1)!.angle).toBe(2048);
    world.handle(BP.REMOVE, new ByteReader(new ByteWriter().u32(2).finish()));
    expect(world.objects.has(2)).toBe(false);
    expect(events).toEqual(["roomContents", "objectMoved", "objectMoved", "objectRemoved"]);
  });
  test("lighting messages", () => {
    const world = new WorldState();
    world.handle(BP.LIGHT_AMBIENT, new ByteReader(Uint8Array.of(200)));
    world.handle(BP.LIGHT_SHADING, new ByteReader(new ByteWriter().u8(5).u16(130).u16(77).finish()));
    expect(world.lighting).toMatchObject({ ambient: 200, shadeIntensity: 5, sunAngle: 130 });
  });
});

describe("interface state (milestone 5)", () => {
  /** server.c ExtractObject: plain object, no light, animation NONE group 1, no overlays */
  const obj = (w: ByteWriter, id: number, amount?: number) => {
    w.u32(id);
    if (amount !== undefined) w.u32(amount);
    return w.u32(100).u32(200).u32(0).u8(0).u32(0).u32(0).u8(0).u8(0).u16(0).u8(1).u16(1).u8(0);
  };
  const feed = (world: WorldState, type: number, w: ByteWriter) => world.handle(type, new ByteReader(w.finish()));

  test("ids match without their tag bits (object.c CompareIdObject)", () => {
    const world = new WorldState();
    const coins = 0x1000248d;
    feed(world, BP.INVENTORY, obj(new ByteWriter().u16(1), coins, 931));
    expect(world.inventory.get(0x248d)?.amount).toBe(931);
    // BP_CHANGE updates the stack in the inventory too (game.c ChangeObject)
    feed(world, BP.CHANGE, obj(new ByteWriter(), coins, 900).u8(1).u16(1).u8(0));
    expect(world.inventory.get(coins)?.amount).toBe(900);
    feed(world, BP.INVENTORY_REMOVE, new ByteWriter().u32(0x248d));
    expect(world.inventory.size).toBe(0);
  });

  test("stats replace by number; use list; enchantments by kind", () => {
    const world = new WorldState();
    const stat = (num: number, value: number) =>
      new ByteWriter().u8(1).u8(num).u32(10 + num).u8(1).u8(1).i32(value).i32(0).i32(100).i32(value);
    feed(world, BP.STAT, stat(1, 20));
    feed(world, BP.STAT, stat(2, 22));
    feed(world, BP.STAT, stat(1, 15));
    expect(world.stats.get(1)?.map((s) => [s.num, s.numeric?.value])).toEqual([[1, 15], [2, 22]]);
    feed(world, BP.USE_LIST, new ByteWriter().u16(2).u32(7).u32(8));
    feed(world, BP.UNUSE, new ByteWriter().u32(7));
    expect([...world.inUse]).toEqual([8]);
    feed(world, BP.ADD_ENCHANTMENT, obj(new ByteWriter().u8(2), 99));
    expect(world.enchantments.room.has(99)).toBe(true);
    feed(world, BP.REMOVE_ENCHANTMENT, new ByteWriter().u8(2).u32(99));
    expect(world.enchantments.room.size).toBe(0);
  });
});

describe("combat state (milestone 6)", () => {
  /** server.c ExtractNewRoomObject: plain object at (row, col) in Kod fine units */
  const roomObj = (w: ByteWriter, id: number, row: number, col: number) =>
    w.u32(id).u32(100).u32(200).u32(8).u8(0).u32(0).u32(0).u8(0).u8(0).u16(0).u8(1).u16(1).u8(0)
      .u16(row).u16(col).u16(0).u8(1).u16(1).u8(0);
  const feed = (world: WorldState, type: number, w: ByteWriter) => world.handle(type, new ByteReader(w.finish()));

  test("a shot flies from source to dest at speed squares per second (project.c)", () => {
    const world = new WorldState();
    const rc = new ByteWriter().u32(1).u16(2);
    roomObj(rc, 10, 64 * 2, 64 * 2);
    roomObj(rc, 11, 64 * 2, 64 * 6);
    feed(world, BP.ROOM_CONTENTS, rc);
    // icon, animation NONE group 1, source, dest, speed 8 sq/s, flags, no light
    feed(world, BP.SHOOT, new ByteWriter().u32(555).u8(1).u16(1).u32(10).u32(11).u8(8).u16(0).u16(0));
    const [p] = [...world.projectiles.values()];
    expect(p.id).toBeLessThan(0);
    world.tick(250); // 4 squares at 8/s = 500 ms
    expect(p.x).toBeCloseTo(kodToFine(64 * 2) + 2 * 1024, 0);
    world.tick(300);
    expect(world.projectiles.size).toBe(0);
  });

  test("effects count down; paralyze lasts until released", () => {
    const world = new WorldState();
    feed(world, BP.EFFECT, new ByteWriter().u16(7).i32(1500)); // pain
    feed(world, BP.EFFECT, new ByteWriter().u16(3)); // paralyze
    world.tick(1000);
    expect(world.effects.pain).toBe(500);
    expect(world.effects.paralyzed).toBe(true);
    feed(world, BP.EFFECT, new ByteWriter().u16(4));
    expect(world.effects.paralyzed).toBe(false);
  });

  test("player overlays fill their slot (overlay.c SetPlayerOverlay)", () => {
    const world = new WorldState();
    // hotspot SE (5), object id 2 = slot 2, no lighting
    feed(world, BP.PLAYER_OVERLAY, new ByteWriter().u8(5).u32(2).u32(300).u32(0).u32(0).u8(0).u32(0).u32(0).u8(0).u8(0).u8(1).u16(5).u8(0));
    expect(world.playerOverlays[1]?.hotspot).toBe(5);
    expect(world.playerOverlays[1]?.look.anim.group).toBe(4);
  });
});
