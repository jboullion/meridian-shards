import { describe, expect, it } from "vitest";
import { ADMIN_CITIES, filterRooms } from "./AdminConsole.tsx";

const ROOMS = [
  { rid: 50, name: "The Streets of Tos", roo: "tos.roo" },
  { rid: 300, name: "Raza", roo: "raza.roo" },
  { rid: 301, name: "The Inn of Raza", roo: "razainn.roo" },
];

describe("the admin console's rooms", () => {
  it("finds rooms by name, file or the start of their number", () => {
    expect(filterRooms(ROOMS, "").length).toBe(3);
    expect(filterRooms(ROOMS, " raza ").map((r) => r.rid)).toEqual([300, 301]);
    expect(filterRooms(ROOMS, "TOS").map((r) => r.rid)).toEqual([50]);
    expect(filterRooms(ROOMS, "razainn").map((r) => r.rid)).toEqual([301]);
    expect(filterRooms(ROOMS, "30").map((r) => r.rid)).toEqual([300, 301]);
  });

  it("has each city once", () => {
    expect(new Set(ADMIN_CITIES.map((c) => c.rid)).size).toBe(ADMIN_CITIES.length);
  });
});
