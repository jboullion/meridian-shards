import { describe, expect, it } from "vitest";
import { movePoint, nearestAngle, readHistoricLinks, readPoints, readRids, strayLines, withLinks } from "./travelPoints.ts";

const KOD = [
  "messages:",
  "",
  "   GetPoints()",
  "   \"Every travel point.\"",
  "   {",
  "      return [",
  "         [ 1, travel_name_tos, NET_MAIN, RID_TOS, 48, 29, 46, 29, ANGLE_NORTH ],",
  "         [ TP_MUSEUM, travel_name_museum, NET_HISTORIC, RID_COR_MUSEUM, 17, 1, 17, 3, ANGLE_EAST ]",
  "      ];",
  "   }",
  "",
  "   GetPoint(id = $)",
  "   {",
  "      return [ 1, 2 ];",
  "   }",
].join("\r\n");

const RIDS = readRids("   RID_TOS = 50\r\n   RID_COR_MUSEUM      = 158\r\n");

describe("the fast travel table", () => {
  it("reads every point with its room's number", () => {
    const points = readPoints(KOD, RIDS);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ id: "1", ridName: "RID_TOS", rid: 50, row: 48, col: 29, arrivalRow: 46, arrivalCol: 29, angle: "ANGLE_NORTH" });
    expect(points[1]).toMatchObject({ id: "TP_MUSEUM", rid: 158 });
  });

  it("moves the portal and leaves the rest of the file as it was", () => {
    const out = movePoint(KOD, "1", { portal: { row: 40, col: 31 } });
    expect(out).toBe(KOD.replace("RID_TOS, 48, 29,", "RID_TOS, 40, 31,"));
  });

  it("moves the arrival and its facing", () => {
    const out = movePoint(KOD, "TP_MUSEUM", { arrival: { row: 18, col: 4, angle: "ANGLE_SOUTH" } });
    expect(out).toBe(KOD.replace("17, 1, 17, 3, ANGLE_EAST", "17, 1, 18, 4, ANGLE_SOUTH"));
  });

  it("reads a portal's fine position, keeps it for an arrival move and drops it for a portal move", () => {
    const fine = KOD.replace("17, 1, 17, 3, ANGLE_EAST ]", "17, 1, 17, 3, ANGLE_EAST, 16, 48 ]");
    expect(readPoints(fine, RIDS)[1]).toMatchObject({ row: 17, fineRow: 16, fineCol: 48 });
    expect(readPoints(KOD, RIDS)[1]).toMatchObject({ fineRow: null, fineCol: null });
    expect(movePoint(fine, "TP_MUSEUM", { arrival: { row: 18, col: 3, angle: "ANGLE_EAST" } })).toContain("17, 1, 18, 3, ANGLE_EAST, 16, 48 ]");
    expect(movePoint(fine, "TP_MUSEUM", { portal: { row: 15, col: 2 } })).toContain("15, 2, 17, 3, ANGLE_EAST ]");
  });

  it("names where historic portals lead", () => {
    const kod = `${KOD}\r\n   GetHistoricLinks()\r\n   {\r\n      return [\r\n         [ TP_MUSEUM, 1, travel_desc_x ]\r\n      ];\r\n   }\r\n`;
    const links = readHistoricLinks(kod);
    expect(links).toEqual([["TP_MUSEUM", "1"]]);
    const points = withLinks(readPoints(kod, RIDS), links);
    expect(points[0]!.leadsTo).toBe("travel_name_museum");
    expect(points[1]!.leadsTo).toBe("travel_name_tos");
  });

  it("finds lines in the table that aren't points", () => {
    expect(strayLines(KOD)).toEqual([]);
    const pasted = KOD.replace("ANGLE_NORTH ],", "ANGLE_NORTH ],\r\n         #new_row=21,#new_col=35");
    expect(strayLines(pasted)).toEqual(["#new_row=21,#new_col=35"]);
  });

  it("refuses a point that isn't there", () => {
    expect(() => movePoint(KOD, "7", { portal: { row: 1, col: 1 } })).toThrow(/No travel point 7/);
  });

  it("snaps a Kod angle to the nearest compass point", () => {
    expect(nearestAngle(0)).toBe("ANGLE_EAST");
    expect(nearestAngle(1024)).toBe("ANGLE_SOUTH");
    expect(nearestAngle(3072 + 200)).toBe("ANGLE_NORTH");
    expect(nearestAngle(4000)).toBe("ANGLE_EAST");
    expect(nearestAngle(2300)).toBe("ANGLE_WEST");
  });
});
