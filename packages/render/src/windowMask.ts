// Ours (docs/adr/0018-seasons-water-windows.md): where a wall texture's glass is, as a mask the
// room shader lights at night (lighting.ts). The openings come from windows.json (meridian-unreal
// data/environment/facades.json), in the picture's own pixels (x right, y down); a grid texture is
// stored transposed (its stored column is the picture's row), so the mask is made the stored way
// round, to be sampled with the texture's own uv. The outlines are facades.py opening_outline's.

/** A window (or clock face) as windows.json gives it */
export interface WindowOpening {
  shape: "rect" | "round" | "pointed" | "circle" | "gable";
  /** Left and right, top (the apex) and bottom, in the picture's pixels */
  x: [number, number];
  y: [number, number];
  /** Where an arch starts (round and pointed), or a gable's slopes (ours: straight up to the apex, at the middle) */
  spring?: number;
}

export interface WindowTexture {
  name?: string;
  /** How bright its glass glows, times the automatic gain (0: it doesn't glow; none: 1) */
  gain?: number;
  openings: WindowOpening[];
}

type Point = [number, number];

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, segments: number): Point[] =>
  Array.from({ length: segments + 1 }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / segments), cy + r * Math.sin(a0 + ((a1 - a0) * i) / segments)]);

/** An opening's outline in the picture's pixels (facades.py opening_outline) */
export function openingOutline(op: WindowOpening, segments = 8): Point[] {
  const [xl, xr] = op.x,
    [ya, yb] = op.y;
  if (op.shape === "circle") {
    const cx = (xl + xr) / 2,
      cy = (ya + yb) / 2,
      rx = (xr - xl) / 2,
      ry = (yb - ya) / 2;
    const n = segments * 3;
    return Array.from({ length: n }, (_, i) => [cx + rx * Math.sin((2 * Math.PI * i) / n), cy + ry * Math.cos((2 * Math.PI * i) / n)]);
  }
  if (op.shape === "rect" || op.spring === undefined) return [[xl, yb], [xr, yb], [xr, ya], [xl, ya]];
  const ys = op.spring;
  if (op.shape === "gable") return [[xl, yb], [xr, yb], [xr, ys], [(xl + xr) / 2, ya], [xl, ys]];
  const a = (xr - xl) / 2,
    h = ys - ya,
    xm = (xl + xr) / 2;
  const pts: Point[] = [[xl, yb], [xr, yb], [xr, ys]];
  if (op.shape === "round" || h <= 0 || Math.abs(h - a) < 1e-6) {
    const r = h > 0 ? (a * a + h * h) / (2 * h) : a;
    const cy = ya + r;
    const start = Math.atan2(ys - cy, xr - xm);
    let end = Math.atan2(ys - cy, xl - xm);
    if (end > start) end -= 2 * Math.PI;
    pts.push(...arc(xm, cy, r, start, end, segments * 2).slice(1, -1));
  } else {
    const r = (a * a + h * h) / (2 * a);
    const cxr = xr - r;
    pts.push(...arc(cxr, ys, r, 0, Math.atan2(ya - ys, xm - cxr), segments).slice(1));
    const cxl = xl + r;
    pts.push(...arc(cxl, ys, r, Math.atan2(ya - ys, xm - cxl), -Math.PI, segments).slice(1, -1));
  }
  pts.push([xl, ys]);
  return pts;
}

/** Whether a point is inside a polygon (even-odd) */
function inside(poly: Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The glass mask of a stored bitmap `width` x `height` (its rows as stored): 255 on glass, 0
 * elsewhere, softened by a one-pixel blur. The picture is the transpose: picture (x, y) is stored
 * (column y, row x).
 */
export function windowMask(openings: readonly WindowOpening[], width: number, height: number): Uint8Array {
  const polys = openings.map((o) => openingOutline(o));
  const hard = new Uint8Array(width * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const px = row + 0.5,
        py = col + 0.5;
      if (polys.some((p) => inside(p, px, py))) hard[row * width + col] = 255;
    }
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      let sum = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy,
            c = col + dx;
          if (r < 0 || c < 0 || r >= height || c >= width) continue;
          sum += hard[r * width + c];
          n++;
        }
      out[row * width + col] = Math.round(sum / n);
    }
  return out;
}

/**
 * How brightly a texture's glass glows (make_placeholders.py's): dark glass more, so every window
 * reads alike: 0.04 over the glass's mean linear luminance, between 1 and 4, times the texture's
 * own gain. `pixels` are the stored bitmap's palette indices, `palette` 256 RGB triples (0..255).
 */
export function windowGain(mask: Uint8Array, pixels: Uint8Array, palette: Uint8Array, gain = 1): number {
  let sum = 0,
    n = 0;
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] <= 127 || pixels[i] === 254) continue;
    const p = pixels[i] * 3;
    sum += 0.2126 * lin(palette[p]) + 0.7152 * lin(palette[p + 1]) + 0.0722 * lin(palette[p + 2]);
    n++;
  }
  if (!n) return 0;
  return Math.max(1, Math.min(4, 0.04 / Math.max(sum / n, 1e-4))) * gain;
}
