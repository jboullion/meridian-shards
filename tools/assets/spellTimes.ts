// How long each spell keeps us from casting again, for the quick slots' cooldowns (ours; apps/client
// cooldowns.ts), read from the Kod source. The server never sends it, but every spell class says it:
//
//   Blink is TeleportationSpell
//   resources:  blink_name_rsc = "blink"
//   classvars:  vrName = blink_name_rsc
//               viMana = 8
//               viPostCast_time = 1        (seconds, or inherited: spell.kod's default is 1)
//
// spell.kod CanPayCosts starts the caster's attack timer (player.kod IsOkayAttackTime) for
// viPostCast_time seconds when a cast goes ahead, and no spell or attack works until it runs out.
// Its reagents, for Study mode's count of casts left (apps/client study.ts), are its ResetReagents:
//
//   ResetReagents() { plReagents = $; plReagents = Cons([&Mushroom,2],plReagents); ... }
//
// named by each item class's English vrName ("mushroom"), as the inventory shows them, and its
// vrName_plural ("mushrooms"), which numbitem.kod GetName gives for a stack of more than one.
// Output: { "blink": { postCast: 1, mana: 8, reagents: [{ name: "emerald", amount: 1 }] }, ... }
// by the spell's English name in lower case.

import type { KodFile } from "./roomLinks.ts";

export interface SpellTimes {
  /** Seconds before another spell (or attack) can be cast */
  postCast: number;
  /** Its base mana cost (viMana), so a cast that went ahead can be told by our mana dropping */
  mana: number;
  /** What one cast uses up, by item name in lower case (empty: none) */
  reagents: { name: string; plural?: string; amount: number }[];
}

interface SpellClass {
  name: string;
  parent: string;
  nameRef: string | null;
  pluralRef: string | null;
  postCast: number | null;
  mana: number | null;
  /** [item class, amount] from its own ResetReagents, or null to inherit */
  reagents: [string, number][] | null;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function parseClass(file: KodFile, strings: Map<string, string>): SpellClass | null {
  const src = stripComments(file.text);
  const head = /^\s*(\w+)\s+is\s+(\w+)\s*$/m.exec(src);
  if (!head) return null;
  for (const m of src.matchAll(/^\s*(\w+)\s*=\s*"([^"\r\n]*)"/gm)) strings.set(m[1], m[2]);
  const int = (field: string) => {
    const v = new RegExp(`\\b${field}\\s*=\\s*(-?\\d+)`, "i").exec(src)?.[1];
    return v === undefined ? null : Number(v);
  };
  return {
    name: head[1],
    parent: head[2],
    nameRef: /\bvrName\s*=\s*(\w+)/.exec(src)?.[1] ?? null,
    pluralRef: /\bvrName_plural\s*=\s*(\w+)/.exec(src)?.[1] ?? null,
    postCast: int("viPostCast_time"),
    mana: int("viMana"),
    reagents: parseReagents(src),
  };
}

function parseReagents(src: string): [string, number][] | null {
  const head = /^\s*ResetReagents\s*\(\s*\)\s*\{/m.exec(src);
  if (!head) return null;
  // The message runs to its first closing brace: ResetReagents holds no blocks
  const start = head.index + head[0].length;
  const body = src.slice(start, src.indexOf("}", start));
  return [...body.matchAll(/\[\s*&(\w+)\s*,\s*(\d+)\s*\]/g)].map((m) => [m[1], Number(m[2])]);
}

/** Spell name (lower case) -> its post-cast delay, mana and reagents, sorted by name. */
export function buildSpellTimes(kodFiles: KodFile[]): Record<string, SpellTimes> {
  // Kod resource names are global: a class's vrName may name a parent's resource
  const strings = new Map<string, string>();
  const classes = new Map<string, SpellClass>();
  for (const f of kodFiles) {
    const c = parseClass(f, strings);
    if (c) classes.set(c.name.toLowerCase(), c);
  }
  const out = new Map<string, SpellTimes>();
  for (const c of classes.values()) {
    // Walk up for the inherited values; only classes under Spell count
    const seen = new Set<string>();
    let postCast: number | null = null,
      mana: number | null = null,
      nameRef: string | null = null,
      reagents: [string, number][] | null = null;
    for (let k: SpellClass | undefined = c; k && !seen.has(k.name.toLowerCase()); k = classes.get(k.parent.toLowerCase())) {
      seen.add(k.name.toLowerCase());
      postCast ??= k.postCast;
      mana ??= k.mana;
      nameRef ??= k.nameRef;
      reagents ??= k.reagents;
    }
    if (!seen.has("spell") || c.name.toLowerCase() === "spell") continue;
    const name = nameRef ? strings.get(nameRef) : undefined;
    // Abstract classes inherit a parent's name ("spell", "teleportation spell"): only a class's own counts
    if (!name || !c.nameRef) continue;
    out.set(name.toLowerCase(), {
      postCast: postCast ?? 1,
      mana: mana ?? 0,
      reagents: (reagents ?? []).flatMap(([cls, amount]) => {
        const name = itemName(classes, strings, cls, "nameRef");
        if (!name) return [];
        const plural = itemName(classes, strings, cls, "pluralRef");
        return [plural && plural.toLowerCase() !== name.toLowerCase() ? { name: name.toLowerCase(), plural: plural.toLowerCase(), amount } : { name: name.toLowerCase(), amount }];
      }),
    });
  }
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** An item class's English name (or plural), its own or inherited; `$` (none) ends the search. */
function itemName(classes: Map<string, SpellClass>, strings: Map<string, string>, cls: string, field: "nameRef" | "pluralRef"): string | undefined {
  const seen = new Set<string>();
  for (let k = classes.get(cls.toLowerCase()); k && !seen.has(k.name.toLowerCase()); k = classes.get(k.parent.toLowerCase())) {
    seen.add(k.name.toLowerCase());
    const ref = k[field];
    if (ref) return strings.get(ref);
  }
  return undefined;
}
