import { describe, expect, it } from "vitest";
import type { ObjectInfo, PlayerInfo } from "../../packages/protocol/src/index.ts";
import { WorldState, type WorldObject } from "../../packages/world/src/index.ts";
import { angleTo, compass, exitLines, facing, kindOf, OF, questLogText, roomText, statusText, type View } from "./describe.ts";

const SQ = 1024;
const NAMES: Record<number, string> = { 1: "Shardscout", 2: "Raza", 3: "rat", 4: "Marcus", 5: "Health", 6: "Mana", 7: "dagger", 8: "Shardpal" };

const info = (id: number, nameRes: number, flags = 0, minimapFlags = 0, amount = 0) => ({ id, nameRes, flags, minimapFlags, amount }) as ObjectInfo;

/** An object at the middle of a Kod square */
function obj(i: ObjectInfo, row: number, col: number, angle = 0): WorldObject {
  return { id: i.id, info: i, x: (col - 0.5) * SQ, y: (row - 0.5) * SQ, angle, motion: null } as unknown as WorldObject;
}

function raza(): View {
  const world = new WorldState();
  world.player = { id: 100, nameRes: 1, roomNameRes: 2, roomRes: 9 } as PlayerInfo;
  world.objects.set(100, obj(info(100, 1, OF.PLAYER), 10, 10, 3072));
  world.objects.set(101, obj(info(101, 3, OF.ATTACKABLE, 0x20000), 10, 13));
  world.objects.set(102, obj(info(102, 4, 0, 0x40 | 0x4000), 7, 10));
  world.objects.set(103, obj(info(103, 8, OF.PLAYER), 12, 8));
  world.stats.set(1, [
    { num: 1, nameRes: 5, type: 1, numeric: { tag: 0, value: 18, min: 0, max: 100, currentMax: 25 } },
    { num: 2, nameRes: 6, type: 1, numeric: { tag: 0, value: 4, min: 0, max: 100, currentMax: 10 } },
  ]);
  world.inventory.set(200, info(200, 7, OF.GETTABLE));
  world.inUse.add(200);
  return {
    world,
    name: (res) => NAMES[res] ?? "",
    roomFile: "raza.roo",
    exits: { "raza.roo": { doors: [[3, 10, "razainn.roo"], [3, 11, "razainn.roo"]], edges: [{ side: "E", to: "razaroad.roo" }], arrivals: [] } },
    roomsOf: (f) => (f === "raza.roo" ? [{ rid: 50, name: "Raza" }] : f === "razainn.roo" ? [{ rid: 51, name: "The Raza Inn" }] : []),
  };
}

describe("the world as text", () => {
  it("names compass points with y running south", () => {
    expect(compass(1, 0)).toBe("E");
    expect(compass(0, -1)).toBe("N");
    expect(compass(-1, 1)).toBe("SW");
    expect(angleTo(0, 1)).toBe(1024);
    expect(facing(3072)).toBe("N");
    expect(facing(angleTo(-3, -3))).toBe("NW");
  });

  it("says what sort of thing an object is", () => {
    expect(kindOf(info(1, 0, OF.ATTACKABLE, 0x20000))).toBe("monster, counts for a quest");
    expect(kindOf(info(1, 0, 0, 0x40 | 0x8000))).toBe('npc, "?" quest to hand in');
    expect(kindOf(info(1, 0, OF.BUYABLE))).toBe("npc, sells (shop)");
    expect(kindOf(info(1, 0, OF.PLAYER | OF.ATTACKABLE))).toBe("player");
    expect(kindOf(info(1, 0, OF.GETTABLE))).toBe("item");
  });

  it("lists the room nearest first, with squares and bearings", () => {
    const text = roomText(raza());
    expect(text).toContain("Raza [raza.roo, RID 50]. You stand at row 10, col 10, facing N.");
    const lines = text.split("\n");
    expect(lines[2]).toContain("[103] Shardpal (player) at row 12, col 8, 2.8 sq SW");
    expect(text).toContain('[102] Marcus (npc, "!" quest offered) at row 7, col 10, 3.0 sq N');
    expect(text).toContain("[101] rat (monster, counts for a quest) at row 10, col 13, 3.0 sq E");
    expect(roomText(raza(), 2.5)).not.toContain("rat");
  });

  it("gathers a doorway's squares and names where the exits lead", () => {
    expect(exitLines(raza())).toEqual(["razainn.roo (The Raza Inn): door at row 3, col 10.5", "razaroad.roo: the E edge"]);
  });

  it("gives our status", () => {
    const text = statusText(raza(), 101);
    expect(text).toContain("You are Shardscout (object 100).");
    expect(text).toContain("Main: Health 18/25, Mana 4/10.");
    expect(text).toContain("Using: dagger.");
    expect(text).toContain("Target: rat (object 101), 3.0 sq E.");
  });

  it("writes the quest log from the catalogue", () => {
    const catalog = {
      hash: 1,
      quests: [
        {
          id: 1, name: "Rats in the Cellar",
          steps: [{ kind: "kill", objective: "Small rats slain", count: 20, auto: false, turnin: { name: "Paddock", rooms: [{ rid: 52, name: "Familiars" }] } }],
        },
      ],
    } as never;
    expect(questLogText({ active: [{ id: 1, step: 1, count: 7, secondsLeft: -1 }], done: [] }, catalog)).toBe(
      "- [1] Rats in the Cellar, step 1/1: Small rats slain 7/20 (hand in to Paddock in Familiars)",
    );
  });
});
