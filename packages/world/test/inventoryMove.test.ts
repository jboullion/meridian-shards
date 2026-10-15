// BP_REQ_INVENTORY_MOVE as the 101 server takes it (module/merintr/inventry.c:1214-1234,
// user.kod UserMoveInventoryItem): 1-based places in its list, which is ours reversed.
import { describe, expect, test } from "vitest";
import type { ObjectInfo } from "@shards/protocol";
import { WorldState } from "../src/state.ts";

const item = (id: number) => ({ id }) as ObjectInfo;

function world(ids: number[]): WorldState {
  const w = new WorldState();
  for (const id of ids) w.inventory.set(id, item(id));
  return w;
}

describe("inventory moves", () => {
  test("down the list: the item goes before the place after the target", () => {
    // ours [A, B, C] is the server's [C, B, A]; A onto C: the server puts A (3) before C (1)
    const w = world([1, 2, 3]);
    expect(w.moveInventoryItem(1, 3)).toEqual({ payload: 3, target: 1 });
    expect([...w.inventory.keys()]).toEqual([2, 3, 1]);
  });

  test("up the list: the item goes before the target", () => {
    // ours [A, B, C], C onto A: the server's [C, B, A] becomes [B, A, C], C (1) before past A (4)
    const w = world([1, 2, 3]);
    expect(w.moveInventoryItem(3, 1)).toEqual({ payload: 1, target: 4 });
    expect([...w.inventory.keys()]).toEqual([3, 1, 2]);
  });

  test("nothing to move", () => {
    expect(world([1, 2]).moveInventoryItem(1, 1)).toBeNull();
    expect(world([1, 2]).moveInventoryItem(1, 9)).toBeNull();
  });
});
