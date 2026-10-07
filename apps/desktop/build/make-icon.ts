// Draws the app icon, build/icon.png (1024 x 1024): a gold shard on dark stone. Our own
// drawing, not original art. electron-builder makes the .ico and .icns from it.
//
//   node apps/desktop/build/make-icon.ts

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const N = 1024;
const SS = 4; // samples per pixel side
type P = readonly [number, number];
type Rgb = readonly [number, number, number];

// The shard: a kite split into four facets around an off-centre ridge point
const top: P = [512, 120], right: P = [748, 452], bottom: P = [512, 912], left: P = [292, 470], ridge: P = [548, 438];
const facets: [P, P, P, Rgb][] = [
  [top, right, ridge, [255, 222, 120]],
  [top, ridge, left, [236, 182, 58]],
  [left, ridge, bottom, [176, 116, 26]],
  [ridge, right, bottom, [128, 80, 14]],
];
// Two small splinters beside it
const splinters: [P, P, P, Rgb][] = [
  [[790, 610], [858, 560], [826, 700], [214, 158, 44]],
  [[214, 660], [250, 590], [276, 730], [150, 98, 22]],
];
const tris = [...facets, ...splinters];

const side = (a: P, b: P, x: number, y: number) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
function inTri(a: P, b: P, c: P, x: number, y: number): boolean {
  const d1 = side(a, b, x, y), d2 = side(b, c, x, y), d3 = side(c, a, x, y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Rounded-square stone: a radial gradient, with alpha outside the corners. */
function background(x: number, y: number): [number, number, number, number] {
  const r = 190, m = 24;
  const cx = Math.min(Math.max(x, m + r), N - m - r), cy = Math.min(Math.max(y, m + r), N - m - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  const t = Math.min(1, Math.hypot(x - 512, y - 470) / 640);
  const edge = Math.hypot(x - cx, y - cy) > r - 14 || x < m + 14 || x > N - m - 14 || y < m + 14 || y > N - m - 14;
  if (edge) return [96, 78, 40, 255];
  return [Math.round(70 - 46 * t), Math.round(64 - 44 * t), Math.round(58 - 42 * t), 255];
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        const hit = tris.find(([p, q, s]) => inTri(p, q, s, px, py));
        const c = hit ? [...hit[3], 255] : background(px, py);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round(a / (SS * SS));
  }
}

const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./icon.png", import.meta.url), png);
console.log(`icon.png: ${png.length} bytes`);
