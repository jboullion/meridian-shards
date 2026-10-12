import { describe, expect, it } from "vitest";
import { FollowPlanner, exitTaken, squareCentre, type AmbientExits, type FollowFrame } from "../src/index.ts";

const exits: AmbientExits = {
  doors: [[5, 10, "inn.roo"], [5, 11, "inn.roo"], [20, 3, "smithy.roo"]],
  edges: [{ side: "N", to: "north.roo" }, { side: "S", to: "south.roo" }, { side: "E", to: "south.roo" }],
  arrivals: [],
};
const size = { width: 40 * 1024, height: 30 * 1024 };

const frame = (over: Partial<FollowFrame>): FollowFrame => ({
  now: 0, room: "town.roo", self: squareCentre(10, 10), leader: null, grid: null, size, exits, ...over,
});

describe("exitTaken", () => {
  it("finds the door near the leader's last square that leads where they are now", () => {
    expect(exitTaken(exits, "town.roo", "inn.roo", [6, 11], size)).toMatchObject({ door: [5, 11] });
  });
  it("falls back to an edge, the nearest side when several lead there", () => {
    expect(exitTaken(exits, "town.roo", "north.roo", [1, 15], size)).toMatchObject({ edge: "N" });
    expect(exitTaken(exits, "town.roo", "south.roo", [15, 40], size)).toMatchObject({ edge: "E" });
    expect(exitTaken(exits, "town.roo", "south.roo", [30, 15], size)).toMatchObject({ edge: "S" });
  });
  it("knows a teleport isn't an exit", () => {
    const e = exitTaken(exits, "town.roo", "uworld.roo", [10, 10], size);
    expect(e.door).toBeUndefined();
    expect(e.edge).toBeUndefined();
  });
});

describe("FollowPlanner", () => {
  it("walks to a spot behind the leader and stands when close", () => {
    const p = new FollowPlanner("Alice");
    const far = p.step(frame({ leader: { ...squareCentre(10, 20), speed: 25 } }));
    expect(far.kind).toBe("walk");
    if (far.kind === "walk") {
      expect(far.to.x).toBeLessThan(squareCentre(10, 20).x);
      expect(far.run).toBe(true); // ten squares behind
    }
    expect(p.step(frame({ leader: { ...squareCentre(10, 11), speed: 25 } })).kind).toBe("idle");
  });

  it("follows the trail through a door, then carries on in the next room", () => {
    const p = new FollowPlanner("Alice");
    p.step(frame({ leader: { ...squareCentre(6, 10), speed: 25 } }));
    expect(p.addExit({ type: "exit", from: "town.roo", to: "inn.roo", at: [5, 10], door: [5, 10] })).toBeNull();
    const walk = p.step(frame({ now: 100 }));
    expect(walk).toMatchObject({ kind: "walk", to: squareCentre(5, 10) });
    // Close, but not on the door's square: straight onto it (BP_REQ_GO needs us there)
    const near = { x: squareCentre(5, 10).x + 300, y: squareCentre(5, 10).y + 600 };
    expect(p.step(frame({ now: 150, self: near }))).toMatchObject({ kind: "walk", to: squareCentre(5, 10) });
    expect(p.step(frame({ now: 200, self: squareCentre(5, 10) }))).toEqual({ kind: "go" });
    expect(p.step(frame({ now: 300, self: squareCentre(5, 10) }))).toEqual({ kind: "idle" });
    expect(p.enteredRoom("inn.roo")).toBeNull();
    expect(p.trail).toEqual([]);
  });

  it("walks off an edge past where the leader crossed", () => {
    const p = new FollowPlanner("Alice");
    p.step(frame({}));
    p.addExit({ type: "exit", from: "town.roo", to: "north.roo", at: [1, 15], edge: "N" });
    expect(p.step(frame({ now: 10 }))).toMatchObject({ kind: "walk", to: squareCentre(1, 15) });
    const out = p.step(frame({ now: 20, self: squareCentre(1, 15) }));
    expect(out.kind === "walk" && out.to.y < 0).toBe(true);
  });

  it("stops for an unknown exit, too long a trail, another room, or a door that won't open", () => {
    expect(new FollowPlanner("Alice").addExit({ type: "exit", from: "town.roo", to: "uworld.roo", at: [1, 1] })).toMatch(/can't follow/);
    const p = new FollowPlanner("Alice");
    p.addExit({ type: "exit", from: "a.roo", to: "b.roo", at: [1, 1], door: [1, 1] });
    p.addExit({ type: "exit", from: "b.roo", to: "c.roo", at: [1, 1], door: [1, 1] });
    expect(p.addExit({ type: "exit", from: "c.roo", to: "d.roo", at: [1, 1], door: [1, 1] })).toMatch(/too far ahead/);
    const q = new FollowPlanner("Alice");
    q.step(frame({}));
    expect(q.enteredRoom("elsewhere.roo")).toMatch(/another way/);
    const r = new FollowPlanner("Alice");
    r.addExit({ type: "exit", from: "town.roo", to: "inn.roo", at: [5, 10], door: [5, 10] });
    r.step(frame({ now: 0, self: squareCentre(5, 10) }));
    expect(r.step(frame({ now: 7000, self: squareCentre(5, 10) }))).toMatchObject({ kind: "stop" });
  });

  it("without an exit message, waits, then takes the door nearest where the leader vanished", () => {
    const p = new FollowPlanner("Alice");
    p.step(frame({ leader: { ...squareCentre(19, 3), speed: 25 } }));
    expect(p.step(frame({ now: 100 }))).toEqual({ kind: "idle" });
    p.step(frame({ now: 3000 }));
    expect(p.trail[0]).toMatchObject({ to: "smithy.roo", door: [20, 3] });
    const lost = new FollowPlanner("Alice");
    lost.step(frame({ leader: { ...squareCentre(15, 30), speed: 25 } }));
    lost.step(frame({ now: 100 }));
    expect(lost.step(frame({ now: 3000 }))).toMatchObject({ kind: "stop" });
  });
});
