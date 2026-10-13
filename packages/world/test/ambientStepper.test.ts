import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRoo } from "@shards/formats";
import { AMBIENT_ROOMS, AMBIENT_SLOT_MS, AMBIENT_TICK_MS, AmbientLife, AmbientStepper, buildNavGrid, slotSeed, type AmbientExits } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "tosinn.roo")) && existsSync(join(ASSETS, "roomexits.json"));

describe("slotSeed", () => {
  test("the same for a room within a slot, another in the next or another room", () => {
    const t = 1_760_000_000_000;
    const a = slotSeed("tosarena.roo", t);
    expect(slotSeed("TOSARENA.ROO", t + 1000)).toEqual(a);
    expect(a.since).toBeLessThanOrEqual(t);
    expect(t - a.since).toBeLessThan(AMBIENT_SLOT_MS);
    expect(slotSeed("tosarena.roo", a.since + AMBIENT_SLOT_MS).seed).not.toBe(a.seed);
    expect(slotSeed("tos.roo", t).seed).not.toBe(a.seed);
  });
});

describe.skipIf(!have)("the same crowd for friends (ADR 0005 section 6)", () => {
  test("someone arriving late catches up to the crowd someone there all along sees", () => {
    const room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, "tosinn.roo"))));
    const exits = JSON.parse(readFileSync(join(ASSETS, "roomexits.json"), "utf8")) as Record<string, AmbientExits>;
    const grid = buildNavGrid(room);
    const shared = { seed: 99, since: 1_000_000 };
    const make = () => new AmbientStepper(new AmbientLife(room, AMBIENT_ROOMS["tosinn.roo"], exits["tosinn.roo"], shared.seed, grid), shared);
    const frame = { player: null, scale: 1, hour: 14 };
    // Alice is there from the start, at an uneven frame rate
    const alice = make();
    let now = shared.since;
    for (let i = 0; now < shared.since + 120_000; i++) {
      const dt = 13 + (i % 7) * 5;
      now += dt;
      alice.advance(now, dt, frame, frame, 1000);
    }
    // Compare at a tick, where neither is drawn between two
    now = shared.since + Math.ceil((now - shared.since) / AMBIENT_TICK_MS) * AMBIENT_TICK_MS;
    alice.advance(now, 16, frame, frame, 1000);
    // Bob comes two minutes in, and catches up at once
    const bob = make();
    for (let i = 0; i < 5; i++) bob.advance(now, 16, frame, frame, 1000);
    expect(bob.catchingUp).toBe(false);
    // Ids come from one counter for every crowd made, so they differ; where everyone stands doesn't
    const where = (s: AmbientStepper) => s.life.objects().map((o) => [o.info.iconRes, Math.round(o.x), Math.round(o.y)]);
    expect(where(bob).length).toBeGreaterThan(2);
    expect(where(bob)).toEqual(where(alice));
  });
});
