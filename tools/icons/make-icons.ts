// Makes every icon from the emblem, tools/icons/emblem.png, our logo: five red roses with the yellow
// shard standing among them (an AI painting after the original client's icon, cut out of its
// background by cutout-emblem.py; concepts/README.md says how it was made):
//   - apps/desktop/build/icon.png (1024 x 1024): the emblem on a rounded square of stone with a gold
//     edge; electron-builder makes the .ico and .icns from it
//   - the Android launcher icons in apps/android/android/app/src/main/res/mipmap-*: ic_launcher
//     (the desktop's rounded square) and ic_launcher_round for old launchers, and the adaptive
//     icon's ic_launcher_background (the stone, full bleed) and ic_launcher_foreground (the emblem,
//     also the Android 12+ splash icon), and drawable-*/ic_notification (the shard alone, white)
//   - the Android splash, drawable-*/splash.png: the emblem on plain stone
//   - the browser's favicons in apps/client/src/icons (index.html): favicon.ico (16, 32, 48),
//     apple-touch-icon.png (on stone: iOS fills transparency with black), and icon-192.png and
//     icon-512.png (transparent, for the website and a web manifest)
//
//   node tools/icons/make-icons.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RES = join(ROOT, "apps", "android", "android", "app", "src", "main", "res");
const FAVICONS = join(ROOT, "apps", "client", "src", "icons");

// Backgrounds are drawn in design units: the desktop icon's 1024 x 1024
const N = 1024;
const SS = 4; // samples per pixel side
type Rgba = readonly [number, number, number, number];
/** A picture in design units: a colour, or undefined where it's transparent. */
type Paint = (x: number, y: number) => Rgba | undefined;

/** An RGBA picture, premultiplied: colour 0-255 times alpha, alpha 0-1. */
interface Img {
  w: number;
  h: number;
  px: Float32Array;
}
const blank = (w: number, h: number): Img => ({ w, h, px: new Float32Array(w * h * 4) });

// ---- the emblem

/** Reads an 8-bit RGBA, non-interlaced PNG (what cutout-emblem.py writes). */
function readPng(path: string): Img {
  const buf = readFileSync(path);
  let pos = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${path}: needs 8-bit RGBA, not interlaced`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, bytes = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? bytes[y * stride + x - 4] : 0;
      const b = y ? bytes[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y ? bytes[(y - 1) * stride + x - 4] : 0;
      let v = raw[line + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      bytes[y * stride + x] = v & 255;
    }
  }
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) {
    const al = bytes[i * 4 + 3] / 255;
    img.px.set([bytes[i * 4] * al, bytes[i * 4 + 1] * al, bytes[i * 4 + 2] * al, al], i * 4);
  }
  return img;
}

/** Shrinks (or grows) `src` to w x h, each pixel the area average of what it covers. */
function resize(src: Img, w: number, h: number): Img {
  const pass = (from: Img, toW: number, toH: number, horizontal: boolean): Img => {
    const out = blank(toW, toH);
    const n = horizontal ? toW : toH, len = horizontal ? from.w : from.h, k = len / n;
    for (let o = 0; o < n; o++) {
      const s0 = o * k, s1 = s0 + k;
      for (let s = Math.floor(s0); s < Math.min(len, Math.ceil(s1)); s++) {
        const wt = (Math.min(s1, s + 1) - Math.max(s0, s)) / k;
        if (wt <= 0) continue;
        const across = horizontal ? toH : toW;
        for (let t = 0; t < across; t++) {
          const si = horizontal ? (t * from.w + s) * 4 : (s * from.w + t) * 4;
          const oi = horizontal ? (t * toW + o) * 4 : (o * toW + t) * 4;
          for (let c = 0; c < 4; c++) out.px[oi + c] += from.px[si + c] * wt;
        }
      }
    }
    return out;
  };
  return pass(pass(src, w, src.h, true), w, h, false);
}

/** An unsharp mask (3 x 3), for small sizes, where the roses' edges would otherwise run together. */
function sharpen(img: Img, amount: number): Img {
  const out = blank(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
            sum += img.px[(yy * img.w + xx) * 4 + c];
            n++;
          }
        out.px[i + c] = img.px[i + c] + amount * (img.px[i + c] - sum / n);
      }
      const a = (out.px[i + 3] = Math.min(1, Math.max(0, out.px[i + 3])));
      for (let c = 0; c < 3; c++) out.px[i + c] = Math.min(255 * a, Math.max(0, out.px[i + c]));
    }
  return out;
}

const emblem = readPng(join(HERE, "emblem.png"));

/** The emblem at `side` pixels, sharpened a little at icon sizes. */
function emblemAt(side: number): Img {
  const img = resize(emblem, side, side);
  return side <= 64 ? sharpen(img, side <= 24 ? 0.6 : 0.4) : img;
}

/** The shard alone, white: Android's notification icon is only its alpha. */
const shard: Img = (() => {
  const n = emblem.w * emblem.h, yellow = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = emblem.px[i * 4 + 3];
    if (a < 0.5) continue;
    const r = emblem.px[i * 4] / a, g = emblem.px[i * 4 + 1] / a;
    // gold or yellow: green close to red; the roses are red, the leaves green
    if (r > 110 && g > 0.55 * r && r > 0.95 * g) yellow[i] = 1;
  }
  // Only the biggest yellow patch, the shard: the roses have a few yellowish highlights of their own
  const seen = new Uint8Array(n);
  let best: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!yellow[start] || seen[start]) continue;
    const patch = [start];
    seen[start] = 1;
    for (let k = 0; k < patch.length; k++) {
      const i = patch[k], x = i % emblem.w;
      for (const j of [x > 0 ? i - 1 : -1, x < emblem.w - 1 ? i + 1 : -1, i - emblem.w, i + emblem.w])
        if (j >= 0 && j < n && yellow[j] && !seen[j]) {
          seen[j] = 1;
          patch.push(j);
        }
    }
    if (patch.length > best.length) best = patch;
  }
  const out = blank(emblem.w, emblem.h);
  for (const i of best) out.px.set([255, 255, 255, 1], i * 4);
  return out;
})();

// ---- backgrounds, drawn as before

const EDGE: Rgba = [104, 86, 36, 255];
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

/** Renders `paint` at w x h, pixel (px, py) showing design point (ox + px / scale, oy + py / scale), supersampled. */
function render(w: number, h: number, scale: number, ox: number, oy: number, paint: Paint): Img {
  const img = blank(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = paint(ox + (x + (sx + 0.5) / SS) / scale, oy + (y + (sy + 0.5) / SS) / scale);
          if (!c) continue;
          const al = c[3] / 255;
          r += c[0] * al; g += c[1] * al; b += c[2] * al; a += al;
        }
      const n = SS * SS;
      img.px.set([r / n, g / n, b / n, a / n], (y * w + x) * 4);
    }
  return img;
}

const solid = (w: number, h: number, c: Rgba): Img => {
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) img.px.set([c[0], c[1], c[2], 1], i * 4);
  return img;
};

/** Draws `top` over `dst` with its corner at (x, y). */
function over(dst: Img, top: Img, x: number, y: number): Img {
  for (let ty = 0; ty < top.h; ty++)
    for (let tx = 0; tx < top.w; tx++) {
      const dx = x + tx, dy = y + ty;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const t = (ty * top.w + tx) * 4, d = (dy * dst.w + dx) * 4, k = 1 - top.px[t + 3];
      for (let c = 0; c < 4; c++) dst.px[d + c] = top.px[t + c] + dst.px[d + c] * k;
    }
  return dst;
}

/** `top` centred on `dst`, `side` pixels square (shifted down by `dy` of its side). */
const centred = (dst: Img, side: number, dy = 0, top = emblemAt(side)) =>
  over(dst, top, Math.round((dst.w - side) / 2), Math.round((dst.h - side) / 2 + dy * side));

// ---- files

function png(img: Img, alpha = true): Buffer {
  const bpp = alpha ? 4 : 3, raw = Buffer.alloc(img.h * (img.w * bpp + 1));
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4, a = img.px[i + 3], o = y * (img.w * bpp + 1) + 1 + x * bpp;
      for (let c = 0; c < 3; c++) raw[o + c] = a ? Math.round(Math.min(255, img.px[i + c] / a)) : 0;
      if (alpha) raw[o + 3] = Math.round(a * 255);
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
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8); // 8-bit RGBA or RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A .ico of PNG images (Windows Vista and every browser read those). */
function ico(images: Img[]): Buffer {
  const pngs = images.map((img) => png(img));
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((data, i) => {
    const e = 6 + 16 * i, side = images[i].w;
    head[e] = side >= 256 ? 0 : side;
    head[e + 1] = side >= 256 ? 0 : side;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs]);
}

function write(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${path.slice(ROOT.length + 1).replaceAll("\\", "/")}: ${data.length} bytes`);
}

// The emblem fills this much of the desktop icon's square, inside the stone's gold edge
const ON_SQUARE = 0.84;
// ...and of a round icon's disc, whose corners are cut off
const ON_DISC = 0.76;

// The desktop icon
write(join(ROOT, "apps", "desktop", "build", "icon.png"), png(centred(render(N, N, 1, 0, 0, roundedStone), Math.round(N * ON_SQUARE))));

// Android launcher icons, per density: the legacy icon's side in pixels (48 dp)
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 } as const;
for (const [density, side] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);
  write(join(dir, "ic_launcher.png"), png(centred(render(side, side, side / N, 0, 0, roundedStone), Math.round(side * ON_SQUARE))));
  write(join(dir, "ic_launcher_round.png"), png(centred(render(side, side, side / N, 0, 0, roundStone), Math.round(side * ON_DISC))));
  // Adaptive layers are 108 dp, of which the launcher's mask shows about the middle 72 dp; the
  // emblem is 58 dp, inside the 66 dp circle every mask keeps
  const full = Math.round((side * 108) / 48), dp = side / 48;
  write(join(dir, "ic_launcher_foreground.png"), png(centred(blank(full, full), Math.round(58 * dp))));
  write(join(dir, "ic_launcher_background.png"), png(render(full, full, (side * 72) / 48 / N, 512 - (full / 2) * (N / ((side * 72) / 48)), 512 - (full / 2) * (N / ((side * 72) / 48)), stone)));
  // The notification icon (24 dp): only its alpha counts, so the shard alone, white, 22 dp high
  const nside = side / 2, shardSide = Math.round(22 * dp);
  write(join(RES, `drawable-${density}`, "ic_notification.png"), png(centred(blank(nside, nside), shardSide, 0, resize(shard, shardSide, shardSide))));
}

// The splash (shown while the app starts, before Android 12): the emblem on plain stone, 45% of
// the short side. SPLASH in values/colors.xml is the same stone for Android 12's splash.
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
for (const [dir, w, h] of SPLASHES) write(join(RES, dir, "splash.png"), png(centred(solid(w, h, SPLASH), Math.round(Math.min(w, h) * 0.45)), false));

// The browser's favicons: the emblem alone, filling the square (it has a 3% margin of its own)
write(join(FAVICONS, "favicon.ico"), ico([16, 32, 48].map((s) => emblemAt(s))));
for (const s of [192, 512]) write(join(FAVICONS, `icon-${s}.png`), png(emblemAt(s)));
// iOS rounds the corners itself and fills transparency with black, so this one is on stone
write(join(FAVICONS, "apple-touch-icon.png"), png(centred(render(180, 180, 180 / N, 0, 0, stone), 152), false));
