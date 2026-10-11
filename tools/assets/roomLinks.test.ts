import { describe, expect, it } from "vitest";
import { buildRoomExits, buildRoomLinks, buildRoomTerrain, parseRids } from "./roomLinks.ts";

const KHD = `
   RID_RAZA = 300
   RID_RAZA_INN = 301
   RID_RAZA_FOREST = 330
   RID_FAROL_WEST = 331
`;

const RAZA = `
resources:
   room_raza = raza.roo
   raza_desc = "A town, 100% sleepy. // not a comment"
classvars:
   prRoom = room_raza
   piRoom_num = RID_RAZA
   viTerrain_type = TERRAIN_CITY | TERRAIN_ROAD
messages:
   CreateStandardExits()
   {
      plExits = $;
      plExits = Cons([ 16, 60, ROOM_LOCKED_DOOR, raza_locked_farm ],plExits); // Farmhouse
      plExits = Cons([ 7, 26, RID_RAZA_INN, 8, 6, ROTATE_NONE ],plExits); // RID_RAZA_INN (Inn)
      //plExits = Cons([ 3, 37, RID_FAROL_WEST, 43, 41, ROTATE_NONE ],plExits);
      plEdge_Exits = Cons([LEAVE_NORTH, RID_RAZA_FOREST, 43, 41, ROTATE_NONE], plEdge_exits);
   }
`;

// No exits of its own: the inn is linked back from Raza
const INN = `
resources:
   room_razainn = RazaInn.roo
classvars:
   piRoom_num = RID_RAZA_INN
`;

const FOREST = `
resources:
   room_razaforest = razaforest.roo
classvars:
   piRoom_num = RID_RAZA_FOREST
   viTerrain_type = TERRAIN_FOREST | \
                    TERRAIN_HILLS
   /* plExits = Cons([ 1, 1, RID_RAZA_INN ],plExits); */
messages:
   CreateStandardExits()
   {
      plEdge_Exits = Cons([LEAVE_SOUTH, RID_RAZA, 2, 38, ROTATE_NONE], plEdge_exits);
      plEdge_Exits = Cons([LEAVE_NORTH, RID_FAROL_WEST, 48, 24, ROTATE_NONE], plEdge_exits);
   }
`;

describe("room links", () => {
  it("reads RID constants", () => {
    expect(parseRids(KHD).get("RID_RAZA_FOREST")).toBe(330);
  });

  it("links rooms both ways through door and edge exits, skipping comments and unknown rooms", () => {
    const links = buildRoomLinks(
      [
        { path: "raza.kod", text: RAZA },
        { path: "razainn.kod", text: INN },
        { path: "razaforest.kod", text: FOREST },
      ],
      KHD,
    );
    expect(links).toEqual({
      "raza.roo": ["razaforest.roo", "razainn.roo"],
      "razaforest.roo": ["raza.roo"],
      "razainn.roo": ["raza.roo"],
    });
  });

  it("lists door squares, locked ones too, and the sides that lead out", () => {
    const exits = buildRoomExits(
      [
        { path: "raza.kod", text: RAZA },
        { path: "razainn.kod", text: INN },
        { path: "razaforest.kod", text: FOREST },
      ],
      KHD,
    );
    expect(exits["raza.roo"]).toEqual({
      doors: [
        [16, 60, null],
        [7, 26, "razainn.roo"],
      ],
      edges: [{ side: "N", to: "razaforest.roo" }],
      // The forest's south edge puts you here
      arrivals: [[2, 38]],
    });
    // Farol West has no room class here: the side still leads out
    expect(exits["razaforest.roo"]).toEqual({
      doors: [],
      edges: [
        { side: "S", to: "raza.roo" },
        { side: "N", to: null },
      ],
      arrivals: [[43, 41]],
    });
    // No exits of its own, but Raza's door puts you on (8, 6)
    expect(exits["razainn.roo"]).toEqual({ doors: [], edges: [], arrivals: [[8, 6]] });
  });

  it("reads each room's terrain, over continued lines too", () => {
    const terrain = buildRoomTerrain(
      [
        { path: "raza.kod", text: RAZA },
        { path: "razainn.kod", text: INN },
        { path: "razaforest.kod", text: FOREST },
      ],
      KHD,
    );
    expect(terrain).toEqual({ "raza.roo": ["CITY", "ROAD"], "razaforest.roo": ["FOREST", "HILLS"] });
  });
});
