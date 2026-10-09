// Where each item goes on the Modern interface's paper doll (apps/client equipment.ts), read from
// the Kod source. The protocol never says where a used item is worn, but every item class says
// how it's used, and its picture:
//
//   Helm is Helmet
//   resources:  helm_icon_male_rsc = ornhelma.bgf
//               helm_icon_female_rsc = ornhelmb.bgf
//   classvars:  vrIcon = helm_icon_male_rsc
//               viUse_type = ITEM_USE_HEAD           (or inherited from a parent class)
//
// with ITEM_USE_* defined in kod/include/blakston.khd. A hand item is a weapon under Weapon and
// a shield (the off hand: shields, torches, mugs) under Shield; other hand items are left out.
// Output: { "ornhelma.bgf": "head", ... } by lower-case file name, for every picture a class
// shows (vrIcon and its other *icon* resources). A picture two slots claim is left out.

import type { KodFile } from "./roomLinks.ts";

export type ItemSlot = "weapon" | "shield" | "head" | "neck" | "body" | "shirt" | "hands" | "legs" | "finger" | "quiver";

interface ItemClass {
  name: string;
  parent: string | null;
  /** Its own viUse_type, if it sets one */
  useType: string | null;
  /** Resource names its pictures come from: vrIcon and resources with "icon" in their name */
  iconRefs: string[];
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** NAME = 0x0008 (or a decimal) lines from the .khd headers. */
export function parseConstants(khd: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of stripComments(khd).matchAll(/^\s*(\w+)\s*=\s*(0x[0-9a-f]+|\d+)\s*$/gim)) out.set(m[1], Number(m[2]));
  return out;
}

function parseClass(file: KodFile, resources: Map<string, string>): ItemClass | null {
  const src = stripComments(file.text);
  const head = /^\s*(\w+)\s+is\s+(\w+)\s*$/m.exec(src);
  if (!head) return null;
  const own: string[] = [];
  for (const m of src.matchAll(/^\s*(\w+)\s*=\s*([\w-]+\.bgf)\b/gim)) {
    resources.set(m[1], m[2].toLowerCase());
    if (/icon/i.test(m[1])) own.push(m[1]);
  }
  const vrIcon = /\bvrIcon\s*=\s*(\w+)/.exec(src)?.[1];
  const useType = /\bviUse_type\s*=\s*([^\r\n]+)/.exec(src)?.[1].trim() ?? null;
  return { name: head[1], parent: head[2], useType, iconRefs: vrIcon ? [vrIcon, ...own] : own };
}

/** viUse_type's value: constants or'd together (ITEM_USE_BODY | ITEM_USE_LEGS), 0 if unknown. */
function useBits(expr: string, consts: Map<string, number>): number {
  let bits = 0;
  for (const part of expr.split("|")) {
    const t = part.trim();
    bits |= /^\d+$/.test(t) ? Number(t) : (consts.get(t) ?? 0);
  }
  return bits;
}

/** The slot for an item class's use bits and ancestry, or null for one not worn in a slot. */
function slotFor(bits: number, ancestors: Set<string>, c: Map<string, number>): ItemSlot | null {
  const has = (name: string) => {
    const v = c.get(name);
    return v !== undefined && (bits & v) !== 0;
  };
  if (has("ITEM_USE_QUIVER")) return "quiver";
  if (has("ITEM_USE_HAND")) return ancestors.has("weapon") ? "weapon" : ancestors.has("shield") ? "shield" : null;
  // A robe is ITEM_USE_BODY | ITEM_USE_LEGS: it's body armour
  if (has("ITEM_USE_BODY")) return "body";
  if (has("ITEM_USE_HEAD") || has("ITEM_USE_FACE")) return "head";
  if (has("ITEM_USE_NECK")) return "neck";
  if (has("ITEM_USE_FINGER")) return "finger";
  if (has("ITEM_USE_GAUNTLET")) return "hands";
  if (has("ITEM_USE_LEGS")) return "legs";
  if (has("ITEM_USE_SHIRT")) return "shirt";
  return null;
}

/** Picture file -> the slot its item is worn in, sorted by file name. */
export function buildItemSlots(kodFiles: KodFile[], khd: string): Record<string, ItemSlot> {
  const consts = parseConstants(khd);
  // Kod resource names are global, so a class's vrIcon may name a parent's resource
  const resources = new Map<string, string>();
  const classes = new Map<string, ItemClass>();
  for (const f of kodFiles) {
    const c = parseClass(f, resources);
    if (c) classes.set(c.name.toLowerCase(), c);
  }
  const out = new Map<string, ItemSlot | null>();
  for (const c of classes.values()) {
    // Walk up for the use type and the ancestry (Kod class names ignore case)
    const ancestors = new Set<string>();
    let useType: string | null = null;
    for (let k: ItemClass | undefined = c; k && !ancestors.has(k.name.toLowerCase()); k = k.parent ? classes.get(k.parent.toLowerCase()) : undefined) {
      ancestors.add(k.name.toLowerCase());
      useType ??= k.useType;
    }
    if (!ancestors.has("item") || useType === null) continue;
    const slot = slotFor(useBits(useType, consts), ancestors, consts);
    if (!slot) continue;
    for (const ref of c.iconRefs) {
      const bgf = resources.get(ref);
      if (!bgf) continue;
      const had = out.get(bgf);
      out.set(bgf, had === undefined || had === slot ? slot : null);
    }
  }
  return Object.fromEntries(
    [...out.entries()].filter((e): e is [string, ItemSlot] => e[1] !== null).sort(([a], [b]) => a.localeCompare(b)),
  );
}
