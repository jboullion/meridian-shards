// Pictures into sprite frames (the Import dialog): background removed, cropped to what's solid,
// fitted to the frame's size and matched to the palette, like shards-server's tools/iconforge
// pixelize.py does for the AI art.

import { ALPHA_CUT, matte, rgbaToHairRamp, rgbaToIndices } from "@shards/formats";
import type { Frame } from "./model.ts";

export interface Rgba {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export async function readImage(file: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
}

/** The part of a picture with any solid pixels */
export function cropSolid(img: Rgba): Rgba {
  let x0 = img.w,
    y0 = img.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3]! >= ALPHA_CUT) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return img;
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4), y * w * 4);
  return { w, h, data };
}

/** A new size: nearest for pixel art, box (area average, alpha-weighted) for big pictures */
export function resample(img: Rgba, w: number, h: number, mode: "nearest" | "box"): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.w / w,
    sy = img.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (mode === "nearest" || (sx <= 1 && sy <= 1)) {
        const i = (Math.min(img.h - 1, Math.floor((y + 0.5) * sy)) * img.w + Math.min(img.w - 1, Math.floor((x + 0.5) * sx))) * 4;
        out.set(img.data.subarray(i, i + 4), o);
        continue;
      }
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(img.h, Math.ceil((y + 1) * sy)); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.min(img.w, Math.ceil((x + 1) * sx)); xx++) {
          const i = (yy * img.w + xx) * 4;
          const al = img.data[i + 3]!;
          r += img.data[i]! * al;
          g += img.data[i + 1]! * al;
          b += img.data[i + 2]! * al;
          a += al;
          n++;
        }
      if (a > 0) out.set([r / a, g / a, b / a, a / n], o);
    }
  return { w, h, data: out };
}

export interface ImportOptions {
  /** Remove a flat background (the picture's own alpha wins when it has any) */
  removeBackground: boolean;
  /** The background colour; null: the corners' colour */
  key: [number, number, number] | null;
  tolerance: number;
  /** Crop to the solid pixels before fitting */
  crop: boolean;
  /** The frame's size; the picture is fitted inside, keeping its shape, centred at the bottom */
  w: number;
  h: number;
  scaling: "nearest" | "box";
  /** "ramp": by brightness onto the hair ramp (hair.py to_ramp); "palette": the nearest allowed colour */
  colours: "ramp" | "palette";
}

/** The picture as a frame's pixels (w * h palette indices) */
export function toIndices(img: Rgba, palette: Uint8Array, opts: ImportOptions, allowed: Set<number> | null): Uint8Array {
  let pic: Rgba = opts.removeBackground ? { ...img, data: matte(img.data, img.w, img.h, opts.key ?? undefined, opts.tolerance) } : img;
  if (opts.crop) pic = cropSolid(pic);
  const k = Math.min(opts.w / pic.w, opts.h / pic.h);
  const fw = Math.max(1, Math.min(opts.w, Math.round(pic.w * k))),
    fh = Math.max(1, Math.min(opts.h, Math.round(pic.h * k)));
  const fitted = resample(pic, fw, fh, opts.scaling);
  const canvas = new Uint8ClampedArray(opts.w * opts.h * 4);
  const ox = Math.floor((opts.w - fw) / 2),
    oy = opts.h - fh;
  for (let y = 0; y < fh; y++) canvas.set(fitted.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * opts.w + ox) * 4);
  return opts.colours === "ramp" ? rgbaToHairRamp(canvas, palette) : rgbaToIndices(canvas, palette, { allowed: allowed ?? undefined });
}

export const frameWith = (f: Frame, px: Uint8Array): Frame => ({ ...f, hotspots: f.hotspots.map((h) => ({ ...h })), px });
