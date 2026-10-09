// The Modern interface's paper doll (ours; ui/CharacterWindow.tsx): which used item shows on
// which slot around the figure. The server only says an item is in use, so where it's worn comes
// from itemslots.json (the asset build reads each item class's use type from Kod: itemSlots.ts),
// by the item's picture. Used items with no slot (a lute, a second shield) stay in the bag.

import type { ObjectInfo } from "@shards/protocol";
import type { WorldState } from "@shards/world";

/** itemslots.json's values (tools/assets/itemSlots.ts ItemSlot) */
export type WornSlot = "weapon" | "shield" | "head" | "neck" | "body" | "shirt" | "hands" | "legs" | "finger" | "quiver";

/** The doll's boxes: two rings, and no quiver (arrows stay in the bag, with their count) */
export type EquipKey = "head" | "neck" | "shirt" | "body" | "legs" | "hands" | "ring1" | "ring2" | "shield" | "weapon";

/** The left and right columns, top to bottom, with their names */
export const EQUIP_COLUMNS: { key: EquipKey; label: string }[][] = [
  [
    { key: "head", label: "Head" },
    { key: "neck", label: "Neck" },
    { key: "shirt", label: "Shirt" },
    { key: "body", label: "Body" },
    { key: "legs", label: "Legs" },
  ],
  [
    { key: "hands", label: "Hands" },
    { key: "ring1", label: "Ring" },
    { key: "ring2", label: "Ring" },
    { key: "shield", label: "Off hand" },
    { key: "weapon", label: "Weapon" },
  ],
];

/** Where an item is worn, by its picture's file name (lower case); null if not in the table. */
export function wornSlot(o: ObjectInfo, table: Readonly<Record<string, string>>, resource: (id: number) => string | undefined): WornSlot | null {
  const name = o.iconRes ? resource(o.iconRes)?.toLowerCase() : undefined;
  return name ? ((table[name] as WornSlot | undefined) ?? null) : null;
}

export interface EquipmentLayout {
  slots: Partial<Record<EquipKey, ObjectInfo>>;
  /** The ids on the doll, which the bag leaves out */
  placed: Set<number>;
}

/**
 * The used items (in inventory order) on the doll's boxes: each in its slot, the first come
 * first, a second ring on Ring 2. The wielded weapon goes on Weapon even if the table doesn't
 * know its picture. Whatever doesn't fit stays in the bag.
 */
export function layoutEquipment(inUse: readonly ObjectInfo[], slotOf: (o: ObjectInfo) => WornSlot | null, wielded?: ObjectInfo): EquipmentLayout {
  const slots: Partial<Record<EquipKey, ObjectInfo>> = {};
  const placed = new Set<number>();
  const put = (key: EquipKey, o: ObjectInfo) => {
    if (slots[key] || placed.has(o.id)) return false;
    slots[key] = o;
    placed.add(o.id);
    return true;
  };
  if (wielded) put("weapon", wielded);
  for (const o of inUse) {
    const s = slotOf(o);
    if (!s || s === "quiver") continue;
    if (s === "finger") {
      if (!put("ring1", o)) put("ring2", o);
    } else put(s, o);
  }
  return { slots, placed };
}

/**
 * The weapon we wield: the right hand's overlay carries its name (player.kod AddWindowOverlay:
 * PWO_RIGHT_HAND, @GetName); the bare hand's has none. The inventory item in use with that name.
 */
export function wieldedWeapon(world: WorldState): ObjectInfo | undefined {
  const hand = world.playerOverlays[1];
  if (!hand?.info.nameRes) return undefined;
  for (const o of world.inventory.values()) if (o.nameRes === hand.info.nameRes && world.inUse.has(o.id)) return o;
  return undefined;
}
