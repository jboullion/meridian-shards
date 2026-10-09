// Draws the app icon, a gold shard on dark stone (our own drawing, not original art), for every app:
//   - apps/desktop/build/icon.png (1024 x 1024); electron-builder makes the .ico and .icns from it
//   - the Android launcher icons in apps/android/android/app/src/main/res/mipmap-*: ic_launcher
//     (the desktop's rounded square) and ic_launcher_round for old launchers, and the adaptive
//     icon's ic_launcher_background (the stone, full bleed) and ic_launcher_foreground (the shard,
//     also the themed icon and the Android 12+ splash icon), and drawable-*/ic_notification
//   - the Android splash, drawable-*/splash.png: the shard on plain stone
//
//   node tools/icons/make-icons.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RES = join(ROOT, "apps", "android", "android", "app", "src", "main", "res");

// The drawing is in design units: the desktop icon's 1024 x 1024
const N = 1024;
const SS = 4; // samples per pixel side
type P = readonly [number, number];
type Rgba = readonly [number, number, number, number];
/** A picture in design units: a colour, or undefined where it's transparent. */
type Paint = (x: number, y: number) => Rgba | undefined;

// The shard: a kite split into four facets around an off-centre ridge point
const top: P = [512, 120], right: P = [748, 452], bottom: P = [512, 912], left: P = [292, 470], ridge: P = [548, 438];
const facets: [P, P, P, Rgba][] = [
  [top, right, ridge, [255, 222, 120, 255]],
  [top, ridge, left, [236, 182, 58, 255]],
  [left, ridge, bottom, [176, 116, 26, 255]],
  [ridge, right, bottom, [128, 80, 14, 255]],
];
// Two small splinters beside it
const splinters: [P, P, P, Rgba][] = [
  [[790, 610], [858, 560], [826, 700], [214, 158, 44, 255]],
  [[214, 660], [250, 590], [276, 730], [150, 98, 22, 255]],
];
const tris = [...facets, ...splinters];

const side = (a: P, b: P, x: number, y: number) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
function inTri(a: P, b: P, c: P, x: number, y: number): boolean {
  const d1 = side(a, b, x, y), d2 = side(b, c, x, y), d3 = side(c, a, x, y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const shard: Paint = (x, y) => tris.find(([p, q, s]) => inTri(p, q, s, x, y))?.[3];

const WHITE: Rgba = [255, 255, 255, 255];
const EDGE: Rgba = [96, 78, 40, 255];
/** The stone's radial gradient, light just above the middle. */
function stone(x: number, y: number): Rgba {
  const t = Math.min(1, Math.hypot(x - 512, y - 470) / 640);
  return [Math.round(70 - 46 * t), Math.round(64 - 44 * t), Math.round(58 - 42 * t), 255];
}

/** The desktop icon's rounded square of stone, with a gold edge. */
const roundedStone: Paint = (x, y) => {
  const r = 190, m = 24;
  const cx = Math.min(Math.max(x, m + r), N - m - r), cy = Math.min(Math.max(y, m + r), N - m - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return undefined;
  const edge = Math.hypot(x - cx, y - cy) > r - 14 || x < m + 14 || x > N - m - 14 || y < m + 14 || y > N - m - 14;
  return edge ? EDGE : stone(x, y);
};

/** A round icon's disc of stone, with the same gold edge. */
const roundStone: Paint = (x, y) => {
  const d = Math.hypot(x - 512, y - 512);
  return d > 512 - 24 ? undefined : d > 512 - 24 - 14 ? EDGE : stone(x, y);
};

const over = (...layers: Paint[]): Paint => (x, y) => {
  for (const paint of layers) {
    const c = paint(x, y);
    if (c) return c;
  }
  return undefined;
};

/**
 * Renders `paint` into a w x h PNG, pixel (px, py) showing design point
 * (ox + px / scale, oy + py / scale). `sharp` says where to supersample (default everywhere).
 */
function png(w: number, h: number, scale: number, ox: number, oy: number, paint: Paint, sharp = (_x: number, _y: number) => true, alpha = true): Buffer {
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const ss = sharp(ox + (x + 0.5) / scale, oy + (y + 0.5) / scale) ? SS : 1;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = paint(ox + (x + (sx + 0.5) / ss) / scale, oy + (y + (sy + 0.5) / ss) / scale) ?? [0, 0, 0, 0];
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      const o = y * (w * bpp + 1) + 1 + x * bpp;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      if (alpha) raw[o + 3] = Math.round(a / (ss * ss));
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
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8); // 8-bit RGBA or RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${path.slice(ROOT.length + 1).replaceAll("\\", "/")}: ${data.length} bytes`);
}

// The desktop icon
write(join(ROOT, "apps", "desktop", "build", "icon.png"), png(N, N, 1, 0, 0, over(shard, roundedStone)));

// Android launcher icons, per density: the legacy icon's side in pixels (48 dp)
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 } as const;
for (const [density, side] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);
  write(join(dir, "ic_launcher.png"), png(side, side, side / N, 0, 0, over(shard, roundedStone)));
  write(join(dir, "ic_launcher_round.png"), png(side, side, side / N, 0, 0, over(shard, roundStone)));
  // Adaptive layers are 108 dp, of which the launcher's mask shows about the middle 72 dp: that's
  // the desktop icon's square, so the shard sits where it does there (inside the 66 dp safe zone)
  const full = (side * 108) / 48, scale = (side * 72) / 48 / N, o = 512 - full / 2 / scale;
  write(join(dir, "ic_launcher_foreground.png"), png(full, full, scale, o, o, shard));
  write(join(dir, "ic_launcher_background.png"), png(full, full, scale, o, o, stone));
  // The notification icon (24 dp): only its alpha counts, so a white shard 22 dp high
  const nside = side / 2, nscale = (side * 22) / 48 / (bottom[1] - top[1]);
  const white: Paint = (x, y) => (shard(x, y) ? WHITE : undefined);
  write(join(RES, `drawable-${density}`, "ic_notification.png"), png(nside, nside, nscale, 536 - nside / 2 / nscale, 516 - nside / 2 / nscale, white));
}

// The splash (shown while the app starts, before Android 12): the shard on plain stone, a third of
// the short side high. SPLASH in values/colors.xml is the same stone for Android 12's splash.
const SPLASH: Rgba = [31, 27, 22, 255];
const SPLASHES: [string, number, number][] = [
  ["drawable", 480, 320],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
];
const nearShard = (x: number, y: number) => x > 200 && x < 872 && y > 106 && y < 926;
for (const [dir, w, h] of SPLASHES) {
  const scale = Math.min(w, h) / 3 / (bottom[1] - top[1]);
  const ox = 536 - w / 2 / scale, oy = 516 - h / 2 / scale;
  write(join(RES, dir, "splash.png"), png(w, h, scale, ox, oy, over(shard, () => SPLASH), nearShard, false));
}
