import { describe, expect, it } from "vitest";
import { exitsTo, findRoute, questWay, type AmbientExits, type CatalogStep } from "../src/index.ts";

// tosinn <-> tos (two doors) <-> toseast (east side); tosinn -> cellar; a locked door; an island
const EXITS: Record<string, AmbientExits> = {
  "tosinn.roo": { doors: [[1, 3, "toscellar.roo"], [3, 10, "tos.roo"], [10, 8, "tos.roo"], [6, 10, null]], edges: [], arrivals: [] },
  "toscellar.roo": { doors: [[2, 2, "tosinn.roo"]], edges: [], arrivals: [] },
  "tos.roo": { doors: [[45, 32, "tosinn.roo"]], edges: [{ side: "E", to: "toseast.roo" }], arrivals: [] },
  "toseast.roo": { doors: [], edges: [{ side: "W", to: "tos.roo" }], arrivals: [] },
  "island.roo": { doors: [], edges: [], arrivals: [] },
};
const ROO: Record<number, string> = { 50: "tos.roo", 52: "tosinn.roo", 74: "toscellar.roo", 51: "toseast.roo", 9: "island.roo" };
const rooFor = (rid: number) => ROO[rid];

const step = (s: Partial<CatalogStep>): CatalogStep => ({
  kind: "kill",
  objective: "Rats slain",
  brief: "",
  count: 5,
  className: "SmallRat",
  targetName: "small rat",
  exact: false,
  rooms: [{ rid: 74, name: "The Cellar" }],
  parcel: null,
  turnin: { name: "Paddock", className: "TosInnKeeper", placed: 0, rooms: [{ rid: 52, name: "Familiars" }] },
  auto: false,
  rewards: { xp: 0, shillings: 0, trainingPoints: 0, items: [], oneOf: [], special: [] },
  withName: null,
  amount: 0,
  items: [],
  ...s,
});

describe("the way to a quest's rooms", () => {
  it("finds the shortest path over doors and sides", () => {
    expect(findRoute(EXITS, "toseast.roo", new Set(["toscellar.roo"]))).toEqual(["toseast.roo", "tos.roo", "tosinn.roo", "toscellar.roo"]);
    expect(findRoute(EXITS, "tos.roo", new Set(["tos.roo"]))).toEqual(["tos.roo"]);
    expect(findRoute(EXITS, "tos.roo", new Set(["island.roo"]))).toBeNull();
  });

  it("marks every exit that leads the right way, doors and sides", () => {
    expect(exitsTo(EXITS, "tosinn.roo", "tos.roo")).toEqual([
      { kind: "door", row: 3, col: 10 },
      { kind: "door", row: 10, col: 8 },
    ]);
    expect(exitsTo(EXITS, "tos.roo", "toseast.roo")).toEqual([{ kind: "edge", side: "E" }]);
  });

  it("marks a doorway several squares wide once, at its middle", () => {
    // raza.roo's inn door is two squares; the museum's lists one square twice
    const wide: Record<string, AmbientExits> = {
      "raza.roo": {
        doors: [[7, 26, "razainn.roo"], [7, 27, "razainn.roo"], [27, 15, "razamuseum.roo"], [27, 14, "razamuseum.roo"], [27, 14, "razamuseum.roo"], [11, 48, "razaapoth.roo"], [12, 48, "razaapoth.roo"], [11, 49, "razaapoth.roo"], [12, 49, "razaapoth.roo"]],
        edges: [],
        arrivals: [],
      },
    };
    expect(exitsTo(wide, "raza.roo", "razainn.roo")).toEqual([{ kind: "door", row: 7, col: 26.5 }]);
    expect(exitsTo(wide, "raza.roo", "razamuseum.roo")).toEqual([{ kind: "door", row: 27, col: 14.5 }]);
    expect(exitsTo(wide, "raza.roo", "razaapoth.roo")).toEqual([{ kind: "door", row: 11.5, col: 48.5 }]);
  });

  it("leads to the area while the step counts up", () => {
    const w = questWay(EXITS, rooFor, "tos.roo", step({}), 2);
    expect(w).toMatchObject({ inArea: false, atTurnin: false, marks: [{ kind: "door", row: 45, col: 32 }] });
    expect(questWay(EXITS, rooFor, "toscellar.roo", step({}), 2)).toEqual({ inArea: true, atTurnin: false, marks: [], path: ["toscellar.roo"] });
  });

  it("leads back to the hand-in once it's counted, and for talk and deliver", () => {
    expect(questWay(EXITS, rooFor, "toscellar.roo", step({}), 5)).toMatchObject({ inArea: false, marks: [{ kind: "door", row: 2, col: 2 }] });
    expect(questWay(EXITS, rooFor, "toseast.roo", step({ kind: "talk", rooms: [] }), 0).marks).toEqual([{ kind: "edge", side: "W" }]);
    expect(questWay(EXITS, rooFor, "tosinn.roo", step({ kind: "deliver", rooms: [] }), 0)).toMatchObject({ atTurnin: true, marks: [] });
  });

  it("marks nothing with no path or nowhere to go", () => {
    expect(questWay(EXITS, rooFor, "island.roo", step({}), 0)).toEqual({ inArea: false, atTurnin: false, marks: [], path: null });
    // A kill whose monster spawns nowhere known: the way only once it's counted
    expect(questWay(EXITS, rooFor, "tos.roo", step({ rooms: [] }), 0).path).toBeNull();
    expect(questWay(EXITS, rooFor, "tos.roo", step({ rooms: [] }), 5).path).toEqual(["tos.roo", "tosinn.roo"]);
    expect(questWay(EXITS, rooFor, "tos.roo", step({ rooms: [], turnin: { name: "X", className: null, placed: 1, rooms: [] } }), 0).path).toBeNull();
  });
});
