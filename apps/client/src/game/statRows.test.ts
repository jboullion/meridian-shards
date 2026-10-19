import { describe, expect, it } from "vitest";
import type { Statistic } from "@shards/protocol";
import { STAT_NUM, statRows } from "./statRows.ts";

const stat = (num: number, nameRes = 1000 + num): Statistic => ({ num, nameRes, type: 1, numeric: { tag: 1, value: 10, min: 0, max: 50, currentMax: 10 } });
const shape = (rows: ReturnType<typeof statRows>) => rows.map((r) => (r.kind === "divider" ? "-" : r.stat.num));

describe("the Stats tab's rows", () => {
  it("puts training points first, a divider, the attributes to Aim, a divider, then the rest", () => {
    // as the server sends them: unbound, training, the attributes, karma, bulk, weight, offense...
    const sent = [27, 8, 1, 2, 3, 4, 5, 6, 7, 10, 9, 11, 12, 13, 14].map((n) => stat(n));
    expect(shape(statRows(sent))).toEqual([8, "-", 1, 2, 3, 4, 5, 6, "-", 11, 12, 13, 14]);
    expect(statRows(sent)[0]).toMatchObject({ kind: "stat", training: true });
  });

  it("hides karma, unbound energy, weight and bulk by English name too", () => {
    const names: Record<number, string> = { 2001: "Karma", 2002: "Bulk Carried" };
    const rows = statRows([stat(1), stat(30, 2001), stat(31, 2002), stat(11)], (res) => names[res]);
    expect(shape(rows)).toEqual([1, "-", 11]);
  });

  it("has no divider with nothing after Aim", () => {
    expect(shape(statRows([stat(STAT_NUM.TRAINING), stat(1), stat(6)]))).toEqual([8, "-", 1, 6]);
    expect(shape(statRows([stat(STAT_NUM.TRAINING)]))).toEqual([8]);
  });
});
