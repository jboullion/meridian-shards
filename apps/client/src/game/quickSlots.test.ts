import { describe, expect, it } from "vitest";
import type { ObjectInfo, Spell } from "@shards/protocol";
import { ALL_QUICK_SLOTS, loadLastSlot, loadQuickSlots, saveLastSlot, saveQuickSlots, slotFor, slotItem, slotSpell, type QuickSlot } from "./quickSlots.ts";

const obj = (id: number, nameRes: number, iconRes = 500 + nameRes): ObjectInfo =>
  ({ id, nameRes, iconRes, amount: 1, flags: 0, translation: 0, overlays: [], animation: { type: 0, group: 1 } }) as unknown as ObjectInfo;

const names: Record<number, string> = { 1: "Healing potion", 2: "Mace", 3: "Touch of Flame", 4: "Blink", 9: "healing POTION" };
const name = (id: number) => names[id] ?? "";

class MapStore {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe("quick slots", () => {
  it("saves and loads ten slots per server and character", () => {
    const store = new MapStore();
    const slots = loadQuickSlots(store, "ws://a", "Bob");
    expect(slots).toHaveLength(ALL_QUICK_SLOTS);
    expect(slots.every((s) => s === null)).toBe(true);
    slots[2] = slotFor("spell", obj(10, 3), "Touch of Flame");
    saveQuickSlots(store, "ws://a", "Bob", slots);
    expect(loadQuickSlots(store, "ws://a", "bob")[2]).toEqual({ kind: "spell", nameRes: 3, name: "Touch of Flame", icon: 503 });
    expect(loadQuickSlots(store, "ws://a", "Alice")[2]).toBeNull();
    expect(loadQuickSlots(store, "ws://b", "Bob")[2]).toBeNull();
  });

  it("loads a save with fewer slots, the rest empty", () => {
    const store = new MapStore();
    const eight = Array.from({ length: 8 }, () => null) as (QuickSlot | null)[];
    eight[7] = { kind: "item", nameRes: 1, name: "Healing potion", icon: 501 };
    store.setItem("shards.quickslots.ws://a.bob", JSON.stringify(eight));
    const slots = loadQuickSlots(store, "ws://a", "Bob");
    expect(slots).toHaveLength(ALL_QUICK_SLOTS);
    expect(slots[7]?.name).toBe("Healing potion");
    // The rest of the first row and the whole second row (saves from before it) come empty
    expect(slots.slice(8)).toEqual(Array.from({ length: ALL_QUICK_SLOTS - 8 }, () => null));
  });

  it("keeps the last slot used per character", () => {
    const store = new MapStore();
    expect(loadLastSlot(store, "ws://a", "Bob")).toBeNull();
    saveLastSlot(store, "ws://a", "Bob", 9);
    expect(loadLastSlot(store, "ws://a", "bob")).toBe(9);
    expect(loadLastSlot(store, "ws://a", "Alice")).toBeNull();
    // The second row's slots count (11-20); past them, nothing
    store.setItem("shards.quickslots.last.ws://a.bob", "12");
    expect(loadLastSlot(store, "ws://a", "Bob")).toBe(12);
    store.setItem("shards.quickslots.last.ws://a.bob", "20");
    expect(loadLastSlot(store, "ws://a", "Bob")).toBeNull();
  });

  it("ignores broken saved slots", () => {
    const store = new MapStore();
    store.setItem("shards.quickslots.ws://a.bob", JSON.stringify([{ kind: "nonsense" }, null, { kind: "item", nameRes: 1, name: "x", icon: 2 }]));
    const slots = loadQuickSlots(store, "ws://a", "Bob");
    expect(slots[0]).toBeNull();
    expect(slots[2]?.kind).toBe("item");
    store.setItem("shards.quickslots.ws://a.bob", "{not json");
    expect(loadQuickSlots(store, "ws://a", "Bob")).toHaveLength(ALL_QUICK_SLOTS);
  });

  it("finds a spell by name resource, then by name", () => {
    const spells: Spell[] = [{ object: obj(20, 4), numTargets: 0, school: 0 }, { object: obj(21, 3), numTargets: 1, school: 0 }];
    expect(slotSpell(slotFor("spell", obj(99, 3), "Touch of Flame"), spells, name)?.object.id).toBe(21);
    // Resources renumbered by a rebuild: the name still matches
    const renamed: QuickSlot = { kind: "spell", nameRes: 77, name: "blink", icon: 0 };
    expect(slotSpell(renamed, spells, name)?.object.id).toBe(20);
    expect(slotSpell({ kind: "spell", nameRes: 78, name: "Mana Bomb", icon: 0 }, spells, name)).toBeUndefined();
  });

  it("takes the item in use first, else the first carried, whatever its id", () => {
    const slot = slotFor("item", obj(5, 1), "Healing potion");
    const potions = [obj(30, 1), obj(31, 9), obj(32, 2)];
    expect(slotItem(slot, potions, new Set<number>(), name)?.id).toBe(30);
    expect(slotItem(slot, potions, new Set([31]), name)?.id).toBe(31);
    expect(slotItem(slot, [obj(32, 2)], new Set<number>(), name)).toBeUndefined();
  });
});
