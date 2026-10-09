import { describe, expect, it } from "vitest";
import { sortMoves } from "./inventoryOrder.ts";

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
});
