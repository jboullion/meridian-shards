// The client's title face, Heidelb1.ttf (font.c FONT_TITLES), is an old TrueType file whose
// cmap subtables carry a non-zero language id. Windows doesn't mind; browsers' font sanitiser
// (OTS) rejects the whole font for it. Zero those fields on a copy before handing it over.

/** A copy of the TrueType font `bytes` with every cmap subtable's language set to 0. */
export function fixCmapLanguages(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const numTables = dv.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(out[rec], out[rec + 1], out[rec + 2], out[rec + 3]) === "cmap") cmap = dv.getUint32(rec + 8);
  }
  if (cmap < 0) return out;
  const subtables = dv.getUint16(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const sub = cmap + dv.getUint32(cmap + 4 + i * 8 + 4);
    const format = dv.getUint16(sub);
    // formats 0, 2, 4 and 6: format, length, language (16-bit each); 8, 10, 12 and 13: 32-bit after a reserved word
    if (format <= 6) dv.setUint16(sub + 4, 0);
    else if (format >= 8 && format <= 13) dv.setUint32(sub + 8, 0);
  }
  return out;
}
