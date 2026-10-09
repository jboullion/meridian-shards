import { describe, expect, it } from "vitest";
import type { ObjectInfo } from "@shards/protocol";
import { layoutEquipment, wornSlot } from "./equipment.ts";

const obj = (id: number, iconRes: number): ObjectInfo => ({ id, iconRes, nameRes: id, amount: 1, flags: 0, overlays: [] }) as unknown as ObjectInfo;

const files: Record<number, string> = { 1: "Helm.bgf", 2: "ring3.bgf", 3: "ring1.bgf", 4: "signet.bgf", 5: "mace.bgf", 6: "lute.bgf", 7: "arrow.bgf", 8: "helmb.bgf" };
const resource = (id: number) => files[id];
const TABLE = { "helm.bgf": "head", "helmb.bgf": "head", "ring3.bgf": "finger", "ring1.bgf": "finger", "signet.bgf": "finger", "mace.bgf": "weapon", "arrow.bgf": "quiver" };
const slotOf = (o: ObjectInfo) => wornSlot(o, TABLE, resource);

describe("equipment", () => {
  it("finds an item's slot by its picture's file name, ignoring case", () => {
    expect(slotOf(obj(10, 1))).toBe("head");
    expect(slotOf(obj(11, 6))).toBeNull();
    expect(slotOf(obj(12, 0))).toBeNull();
  });

  it("puts two rings on the two ring boxes and leaves extras, unknowns and arrows in the bag", () => {
    const items = [obj(10, 1), obj(11, 2), obj(12, 3), obj(13, 4), obj(14, 6), obj(15, 7), obj(16, 8)];
    const { slots, placed } = layoutEquipment(items, slotOf);
    expect(slots.head?.id).toBe(10);
    expect(slots.ring1?.id).toBe(11);
    expect(slots.ring2?.id).toBe(12);
    expect([...placed].sort()).toEqual([10, 11, 12]);
  });

  it("puts the wielded weapon on Weapon even when the table doesn't know it", () => {
    const sword = obj(20, 6);
    const { slots, placed } = layoutEquipment([sword, obj(21, 5)], slotOf, sword);
    expect(slots.weapon?.id).toBe(20);
    expect(placed.has(21)).toBe(false);
  });
});
