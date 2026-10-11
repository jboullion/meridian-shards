// .rsb resource bundles (upstream util/rscload.c, util/rscmerge.c): string resources keyed by id.
//   "RSC\x01" | i32 version (4) | i32 count | count x (i32 id, NUL-terminated bytes)
// Strings are kept as Latin-1 (one char per byte) so redbook/protocol use stays byte-exact.
// Version 4 is the original game's (and the Shards server's); Server 104's version 5 added a
// language per string, which we no longer read (ADR 0005).

const MAGIC = [0x52, 0x53, 0x43, 0x01];
const VERSION = 4;

export interface RsbBundle {
  /** id -> string */
  entries: Map<number, string>;
  /** loadrsc.c LookupRsc: the string for an id, undefined if there's none */
  get(id: number): string | undefined;
}

export function parseRsb(data: Uint8Array): RsbBundle {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < 4; i++) if (data[i] !== MAGIC[i]) throw new Error("not an .rsb file (bad magic)");
  const version = dv.getInt32(4, true);
  if (version !== VERSION) throw new Error(`unsupported .rsb version ${version} (expected ${VERSION})`);
  const count = dv.getInt32(8, true);
  const entries = new Map<number, string>();
  let pos = 12;
  for (let n = 0; n < count; n++) {
    const id = dv.getInt32(pos, true);
    pos += 4;
    let end = pos;
    while (end < data.length && data[end] !== 0) end++;
    let s = "";
    for (let i = pos; i < end; i += 0x8000) s += String.fromCharCode(...data.subarray(i, Math.min(end, i + 0x8000)));
    pos = end + 1;
    entries.set(id, s);
  }
  return { entries, get: (id) => entries.get(id) };
}
