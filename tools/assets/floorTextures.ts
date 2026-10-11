// What each floor texture is, for Ground Detail (ours): grass tufts on grassy floors, dry tufts and
// pebbles on earth and sand, pebbles and stones on rocky ground. Told by the texture's average
// colour (through the palette): green is grass, warm tan is earth, pale and a little warm is rock.
// Grey without a tint (paving, tiles), deep reds and browns (wood, brick), blues (water) and
// very dark floors are left alone.
// A cobbled road can average the colour of rocky ground, so a texture with deep dark lines through
// it (mortar between stones) and strong contrast is marked cobbled: no rocks strewn on it.
// Output: floortextures.json, { "<texture number>": [kind, r, g, b, cobbled 0 or 1] }.

export type FloorKind = "grass" | "earth" | "rocky";

/** A floor's kind from its average colour (0..255 each), or null to leave it bare */
export function classifyFloor(r: number, g: number, b: number): FloorKind | null {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  const lum = (r + g + b) / 3;
  if (lum < 40) return null; // too dark to tell (mud, shadowed stone)
  if (g >= r + 8 && g >= b + 8 && sat >= 0.25) return "grass";
  if (b > r) return null; // water, ice
  if (r > g && g > b && sat >= 0.3 && sat <= 0.7 && lum >= 60) return "earth";
  if (sat >= 0.05 && sat < 0.3 && lum >= 70 && lum <= 200 && r >= b) return "rocky";
  return null;
}

/** A texture's average colour over its first bitmap (palette indices; 254 is see-through) */
export function averageColor(pixels: Uint8Array, palette: Uint8Array): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const i of pixels) {
    if (i === 254) continue;
    r += palette[i * 3];
    g += palette[i * 3 + 1];
    b += palette[i * 3 + 2];
    n++;
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

/**
 * Whether a texture is cobbled or flagged (stones set in mortar): its darkest tenth well under
 * half its average brightness again, and strong contrast. Raza's road (grd09603) is; natural rock
 * and earth aren't.
 */
export function isCobbled(pixels: Uint8Array, palette: Uint8Array): boolean {
  const n = pixels.length;
  const lum = new Float32Array(n);
  let mean = 0;
  for (let k = 0; k < n; k++) {
    const i = pixels[k];
    lum[k] = 0.3 * palette[i * 3] + 0.59 * palette[i * 3 + 1] + 0.11 * palette[i * 3 + 2];
    mean += lum[k];
  }
  mean /= n || 1;
  let sd = 0;
  for (const v of lum) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / (n || 1));
  const darkest = [...lum].sort((a, b) => a - b)[Math.floor(n * 0.1)] ?? mean;
  return darkest / (mean || 1) < 0.55 && sd > 30;
}
