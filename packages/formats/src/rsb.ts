// .rsb resource bundles (util/rscload.c): string resources keyed by id.
//   "RSC\x01" | i32 version (5) | i32 count | count x (i32 id, i32 lang, NUL-terminated bytes)
// Strings are kept as Latin-1 (one char per byte) so redbook/protocol use stays byte-exact.

const MAGIC = [0x52, 0x53, 0x43, 0x01];
const VERSION = 5;

export interface RsbBundle {
  /** id -> (lang -> string) */
  entries: Map<number, Map<number, string>>;
  /** Look up an id, preferring `lang` (default 0, as the original client does). */
  get(id: number, lang?: number): string | undefined;
}

export function parseRsb(data: Uint8Array): RsbBundle {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < 4; i++) if (data[i] !== MAGIC[i]) throw new Error("not an .rsb file (bad magic)");
  const version = dv.getInt32(4, true);
  if (version !== VERSION) throw new Error(`unsupported .rsb version ${version}`);
  const count = dv.getInt32(8, true);
  const entries = new Map<number, Map<number, string>>();
  let pos = 12;
  for (let n = 0; n < count; n++) {
    const id = dv.getInt32(pos, true);
    const lang = dv.getInt32(pos + 4, true);
    pos += 8;
    let end = pos;
    while (end < data.length && data[end] !== 0) end++;
    let s = "";
    for (let i = pos; i < end; i += 0x8000) s += String.fromCharCode(...data.subarray(i, Math.min(end, i + 0x8000)));
    pos = end + 1;
    let langs = entries.get(id);
    if (!langs) entries.set(id, (langs = new Map()));
    langs.set(lang, s);
  }
  return {
    entries,
    get(id, lang = 0) {
      const langs = entries.get(id);
      if (!langs) return undefined;
      return langs.get(lang) ?? langs.values().next().value;
    },
  };
}
