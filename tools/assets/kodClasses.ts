// The Kod's classes read with regexes: each class's parent, its `name = value` lines and its
// resources. For lists that only need names, pictures and parents (the admin dashboard's
// catalogue, the quest generator's checks), not a Kod compiler.

import type { KodFile } from "./roomLinks.ts";

export interface KodClassInfo {
  parent: string;
  props: Map<string, string>;
  rscs: Map<string, string>;
  /** The file it's in */
  path: string;
  /** Its source, comments taken out */
  src: string;
}

export type KodClasses = Map<string, KodClassInfo>;

/** Every class in these files: its parent, its `name = value` lines (lower-case names) and its resources */
export function readClasses(files: KodFile[]): KodClasses {
  const out: KodClasses = new Map();
  for (const file of files) {
    const text = file.text.replace(/\/\/[^\n]*/g, "");
    const head = /^\s*(\w+)\s+is\s+(\w+)/m.exec(text);
    if (!head) continue;
    const props = new Map<string, string>();
    const rscs = new Map<string, string>();
    for (const m of text.matchAll(/^\s*(\w+)\s*=\s*(.+?)\s*$/gm)) {
      const [, k, v] = m as unknown as [string, string, string];
      props.set(k.toLowerCase(), v);
      if (/^".*"$/.test(v)) rscs.set(k.toLowerCase(), v.slice(1, -1));
      else if (/^[\w-]+\.bgf$/i.test(v)) rscs.set(k.toLowerCase(), v.toLowerCase());
    }
    out.set(head[1]!, { parent: head[2]!, props, rscs, path: file.path, src: text });
  }
  // Kod ignores case: a parent written "jasperTown" is the class declared "JasperTown"
  const declared = new Map([...out.keys()].map((c) => [c.toLowerCase(), c]));
  for (const info of out.values()) info.parent = declared.get(info.parent.toLowerCase()) ?? info.parent;
  return out;
}

/** A property's own value through the class's parents (as written: a constant, a resource's name) */
export function rawLookup(classes: KodClasses, cls: string, prop: string): string | null {
  for (let c: string | undefined = cls, n = 0; c && n < 30; n++) {
    const info = classes.get(c);
    if (!info) return null;
    const v = info.props.get(prop);
    if (v !== undefined) return v;
    c = info.parent;
  }
  return null;
}

/** A property through the class's parents, and the resource it names */
export function lookup(classes: KodClasses, cls: string, prop: string): string | null {
  const v = rawLookup(classes, cls, prop);
  if (v === null) return null;
  for (let c: string | undefined = cls, n = 0; c && n < 30; n++) {
    const info = classes.get(c);
    if (!info) break;
    const r = info.rscs.get(v.toLowerCase());
    if (r !== undefined) return r;
    c = info.parent;
  }
  return findRsc(classes, v.toLowerCase());
}

export function findRsc(classes: KodClasses, rsc: string): string | null {
  for (const info of classes.values()) {
    const v = info.rscs.get(rsc);
    if (v !== undefined) return v;
  }
  return null;
}

/** Whether cls is root or one of its descendants */
export function isA(classes: KodClasses, cls: string, root: string): boolean {
  for (let x: string | undefined = cls, n = 0; x && n < 30; n++) {
    if (x === root) return true;
    x = classes.get(x)?.parent;
  }
  return false;
}

export function descendants(classes: KodClasses, root: string): string[] {
  return [...classes.keys()].filter((c) => c !== root && isA(classes, c, root));
}
