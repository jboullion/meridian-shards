// The inventory's order. The server keeps it (user.kod UserMoveInventoryItem): an item dropped on
// another takes that one's place (BP_REQ_INVENTORY_MOVE, inventry.c InventoryMoveCurrentItem), and
// WorldState.moveInventoryItem does the same here. Sorting is a run of those moves (ours, the Modern
// interface's Sort).

import type { ObjectInfo } from "@shards/protocol";
import { isNumberItem } from "@shards/world";

/** object.c CompareObjectNameAndNumber: number items first, then by name. */
export function sortByNameAndNumber(items: ObjectInfo[], name: (res: number) => string): ObjectInfo[] {
  return [...items].sort(
    (a, b) => Number(isNumberItem(b.id)) - Number(isNumberItem(a.id)) || name(a.nameRes).toLowerCase().localeCompare(name(b.nameRes).toLowerCase()),
  );
}

/**
 * The moves that put `current` (item ids, in order) in the order of `wanted`: each is [the item,
 * the item whose place it takes]. Every move takes an item from further down to an earlier place,
 * where the server and moveInventoryItem both put it just before the other item.
 */
export function sortMoves(current: readonly number[], wanted: readonly number[]): [number, number][] {
  const list = [...current];
  const moves: [number, number][] = [];
  for (let i = 0; i < wanted.length && i < list.length; i++) {
    if (list[i] === wanted[i]) continue;
    const j = list.indexOf(wanted[i]);
    if (j < 0) continue;
    moves.push([wanted[i], list[i]]);
    list.splice(j, 1);
    list.splice(i, 0, wanted[i]);
  }
  return moves;
}
