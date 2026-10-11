// Ours: ids and art for ambient life (townsfolk and the like), which only this client sees.
//
// Ambient objects never go in WorldState (its maps ignore an id's top 4 bits, the number tag)
// and never reach the server: everything that acts on an object looks it up in WorldState first.
// Their ids start above any 28-bit Kod object id; negative ids are projectiles'.
//
// The renderer loads art by resource number (the server's rsc0000.rsb), so ambient art gets
// numbers of its own, from LOCAL_RES_BASE up, that name the file directly.

export const AMBIENT_ID_BASE = 0x40000000;
const AMBIENT_ID_END = 0x7f000000;
export const LOCAL_RES_BASE = 0x7f000000;

let nextId = AMBIENT_ID_BASE;

/** A fresh id for an ambient object */
export function ambientId(): number {
  const id = nextId++;
  if (nextId >= AMBIENT_ID_END) nextId = AMBIENT_ID_BASE;
  return id;
}

export function isAmbientId(id: number): boolean {
  return id >= AMBIENT_ID_BASE && id < AMBIENT_ID_END;
}

const files: string[] = [];
const byFile = new Map<string, number>();

/** The local resource number for an art file (lower-case name, like "bta.bgf") */
export function localRes(file: string): number {
  const name = file.toLowerCase();
  let res = byFile.get(name);
  if (res === undefined) {
    res = LOCAL_RES_BASE + files.length;
    files.push(name);
    byFile.set(name, res);
  }
  return res;
}

/** The file a local resource number names, or undefined for any other number */
export function localResName(res: number): string | undefined {
  return res >= LOCAL_RES_BASE ? files[res - LOCAL_RES_BASE] : undefined;
}
