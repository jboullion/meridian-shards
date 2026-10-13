import { describe, expect, it } from "vitest";
import type { ObjectInfo } from "@shards/protocol";
import { sortByType, sortMoves } from "./inventoryOrder.ts";

/** A move as the server makes it (user.kod UserMoveInventoryItem): out, then in at the other's old place. */
function apply(list: number[], [what, where]: [number, number]): number[] {
  const out = [...list];
  const to = out.indexOf(where);
  out.splice(out.indexOf(what), 1);
  out.splice(to, 0, what);
  return out;
}

describe("inventory order", () => {
  it("sorts with moves the server makes the same way", () => {
    const current = [5, 3, 9, 1, 7, 2];
    const wanted = [1, 2, 3, 5, 7, 9];
    const moves = sortMoves(current, wanted);
    expect(moves.reduce(apply, current)).toEqual(wanted);
    // Each move takes an item up to an earlier place
    let list = current;
    for (const m of moves) {
      expect(list.indexOf(m[0])).toBeGreaterThan(list.indexOf(m[1]));
      list = apply(list, m);
    }
  });

  it("makes no moves when it's already in order", () => {
    expect(sortMoves([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("sorts by type, then by name, with shillings always last", () => {
    const item = (id: number, nameRes: number) => ({ id, nameRes }) as ObjectInfo;
    const names: Record<number, string> = { 1: "Shillings", 2: "Apple", 3: "Long sword", 4: "Herbs", 5: "Axe", 6: "Odd thing", 7: "Bread" };
    const types: Record<number, string> = { 1: "money", 2: "food", 3: "weapon", 4: "reagent", 5: "weapon", 7: "food" };
    const sorted = sortByType([1, 2, 3, 4, 5, 6, 7].map((n) => item(n, n)), (r) => names[r], (o) => types[o.id]);
    expect(sorted.map((o) => names[o.nameRes])).toEqual(["Axe", "Long sword", "Herbs", "Apple", "Bread", "Odd thing", "Shillings"]);
  });
});
