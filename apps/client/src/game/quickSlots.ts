// Quick slots (ours; the original has none): spells or items to cast or use with one key or tap,
// in rows of ten. The desktop shows the first row as a hotbar along the bottom of the view (keys
// 1-9 and 0), and the Modern interface a second above it (the numpad's 1-9 and 0); the phone layout
// shows the first row as a wheel around its Cast button (ui/QuickSlots.tsx).
//
// A slot remembers a name, not an object id: every save renumbers objects, and a stack of
// potions is a new object once one is drunk. It keeps the name resource (which survives a
// language change) and the name (which survives a server rebuild renumbering resources),
// and the icon, to draw the slot when there's nothing it matches. Kept in the page's storage
// per server and character, like the mailbox.

import type { ObjectInfo, Spell } from "@shards/protocol";

/** Slots in a row (the hotbar's, the phone's wheel) */
export const QUICK_SLOTS = 10;
/** Rows kept per character: the second is the Modern interface's only */
export const QUICK_SLOT_ROWS = 2;
export const ALL_QUICK_SLOTS = QUICK_SLOTS * QUICK_SLOT_ROWS;

/** Drag data: an inventory item's id, a spell's object id, a quick slot's index (ui/QuickSlots.tsx) */
export const DRAG_ITEM = "application/x-shards-item";
export const DRAG_SPELL = "application/x-shards-spell";
export const DRAG_SLOT = "application/x-shards-slot";

export interface QuickSlot {
  kind: "spell" | "item";
  nameRes: number;
  name: string;
  /** The object's iconRes, for a slot that matches nothing now */
  icon: number;
}

export type QuickSlots = (QuickSlot | null)[];

/** Where slots are kept: localStorage-like (tests pass a Map). */
export interface SlotStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (server: string, character: string) => `shards.quickslots.${server}.${character.toLowerCase()}`;

export const emptySlots = (): QuickSlots => Array.from({ length: ALL_QUICK_SLOTS }, () => null);

function isSlot(s: unknown): s is QuickSlot {
  const q = s as QuickSlot | null;
  return !!q && (q.kind === "spell" || q.kind === "item") && typeof q.nameRes === "number" && typeof q.name === "string" && typeof q.icon === "number";
}

export function loadQuickSlots(store: SlotStore, server: string, character: string): QuickSlots {
  try {
    const raw = store.getItem(storageKey(server, character));
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (!Array.isArray(list)) return emptySlots();
    return emptySlots().map((_, i) => (isSlot(list[i]) ? list[i] : null));
  } catch {
    return emptySlots();
  }
}

export function saveQuickSlots(store: SlotStore, server: string, character: string, slots: QuickSlots): void {
  try {
    store.setItem(storageKey(server, character), JSON.stringify(slots));
  } catch {
    // storage unavailable: kept for this session
  }
}

const lastKey = (server: string, character: string) => `shards.quickslots.last.${server}.${character.toLowerCase()}`;

/** The slot used last (the phone's Cast button uses it again), or null. */
export function loadLastSlot(store: SlotStore, server: string, character: string): number | null {
  try {
    const raw = store.getItem(lastKey(server, character));
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n < ALL_QUICK_SLOTS ? n : null;
  } catch {
    return null;
  }
}

export function saveLastSlot(store: SlotStore, server: string, character: string, slot: number): void {
  try {
    store.setItem(lastKey(server, character), String(slot));
  } catch {
    // storage unavailable: kept for this session
  }
}

/** A slot for a spell or an inventory item, named with `name`. */
export function slotFor(kind: QuickSlot["kind"], o: ObjectInfo, name: string): QuickSlot {
  return { kind, nameRes: o.nameRes, name, icon: o.iconRes };
}

const sameName = (slot: QuickSlot, o: ObjectInfo, name: (id: number) => string) =>
  o.nameRes === slot.nameRes || name(o.nameRes).toLowerCase() === slot.name.toLowerCase();

/** The spell a slot names, among the ones we know. */
export function slotSpell(slot: QuickSlot, spells: readonly Spell[], name: (id: number) => string): Spell | undefined {
  return spells.find((s) => s.object.nameRes === slot.nameRes) ?? spells.find((s) => sameName(slot, s.object, name));
}

/**
 * The inventory item a slot names: one in use first (using the slot again puts a wielded
 * weapon away), else the first we carry.
 */
export function slotItem(
  slot: QuickSlot, inventory: Iterable<ObjectInfo>, inUse: { has(id: number): boolean }, name: (id: number) => string,
): ObjectInfo | undefined {
  const matches = [...inventory].filter((o) => sameName(slot, o, name));
  return matches.find((o) => inUse.has(o.id)) ?? matches[0];
}
