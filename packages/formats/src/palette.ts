// The game palette (blakston.pal): 256 RGB entries. The asset build writes it as
// palette.bin (768 bytes, r g b per entry).

export interface Palette {
  /** 256 x [r, g, b], 0..255 */
  rgb: Uint8Array;
}

export function parsePaletteBin(data: Uint8Array): Palette {
  if (data.length < 768) throw new Error(`palette.bin is ${data.length} bytes, expected 768`);
  return { rgb: data.slice(0, 768) };
}

/** RGBA copy with index 254 (transparent) at alpha 0, for building a palette texture. */
export function paletteRgba(p: Palette): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = p.rgb[i * 3];
    out[i * 4 + 1] = p.rgb[i * 3 + 1];
    out[i * 4 + 2] = p.rgb[i * 3 + 2];
    out[i * 4 + 3] = i === 254 ? 0 : 255;
  }
  return out;
}
