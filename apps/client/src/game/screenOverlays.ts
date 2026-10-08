// What the D3D client draws over the 3D view in screen space:
//   - player overlays (d3drender.c D3DRenderPlayerOverlaysDraw): the weapon and shield
//     hands, placed at a screen hotspot (corner, edge or centre) and lit like the player;
//   - full-screen effects (effect.c, d3drender.c D3DRenderOverlaysDraw): blindness, the
//     colour flash (EFFECT_FLASHXLAT), the whiteout and the red pain flash (always last).
// Drawn on a 2D canvas laid over the WebGL canvas.

import { TRANSPARENT_INDEX, type Bgf } from "@shards/formats";
import { HOTSPOT } from "@shards/protocol";
import { compositeSprite, type SpritePart, type XlatTable } from "@shards/render";
import type { Effects, PlayerOverlayState } from "@shards/world";

/**
 * D3DComputePlayerOverlayArea: the D3D client renders to a fixed 800 x 600 back buffer
 * stretched over the view (d3ddriver.c gScreenWidth/Height), and draws an overlay pixel
 * 1.75 back-buffer pixels wide and 2.25 tall. So a pixel is 1.75/800 of the view's width
 * and 2.25/600 of its height, whatever the window size.
 */
const OVERLAY_SX = 1.75 / 800;
const OVERLAY_SY = 2.25 / 600;

/** d3drender.c: the colour and opacity of each flash xlat (others flash black). */
function flashColor(xlat: number): [number, number, number, number] {
  const red: Record<number, number> = {
    0x41: 25, 0x42: 50, 0x43: 75, 0x51: 75, 0x44: 100, 0x45: 125, 0x46: 150, 0x47: 175, 0x48: 200, 0x57: 200, 0x49: 225, 0x4a: 255,
  };
  if (red[xlat] !== undefined) return [255, 0, 0, red[xlat]];
  if (xlat >= 0x70 && xlat <= 0x79) return [255, 255, 255, xlat === 0x79 ? 255 : (xlat - 0x6f) * 25];
  if (xlat === 0x39) return [255, 255, 255, 255]; // XLAT_BLEND25YELLOW, as the D3D code has it
  const green: Record<number, number> = { 0x53: 64, 0x56: 128, 0x59: 192 };
  if (green[xlat] !== undefined) return [0, 255, 0, green[xlat]];
  const blue: Record<number, number> = { 0x52: 64, 0x55: 128, 0x58: 192 };
  if (blue[xlat] !== undefined) return [0, 0, 255, blue[xlat]];
  return [0, 0, 0, 255];
}

interface Cached {
  key: string;
  canvas: HTMLCanvasElement | null;
  originX: number;
  originY: number;
  baseW: number;
  baseH: number;
  xOffset: number;
  yOffset: number;
}

export class ScreenOverlays {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache: Cached[] = [];
  private readonly rgb: Uint8Array;
  private readonly xlats: XlatTable;
  private readonly getBgf: (resource: number) => Bgf | null | undefined;

  constructor(parent: HTMLElement, rgb: Uint8Array, xlats: XlatTable, getBgf: (resource: number) => Bgf | null | undefined) {
    this.rgb = rgb;
    this.xlats = xlats;
    this.getBgf = getBgf;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "screen-overlays";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  /**
   * Redraw. `light` is the player's brightness (0..1, D3DObjectLightingCalc);
   * `alpha` the player's translucency (draw effects).
   */
  draw(overlays: (PlayerOverlayState | null)[], fx: Effects, light: [number, number, number], alpha: number): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    if (fx.blind) {
      // d3drender.c: blind draws no sky, world or objects
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }

    const sx = OVERLAY_SX * w,
      sy = OVERLAY_SY * h;
    overlays.forEach((ov, slot) => {
      if (!ov || ov.hotspot < 1 || ov.hotspot > HOTSPOT.CENTER) return;
      const c = this.picture(slot, ov, light);
      if (!c?.canvas) return;
      const bw = c.baseW * sx,
        bh = c.baseH * sy;
      const hs = ov.hotspot;
      let x = hs === HOTSPOT.NW || hs === HOTSPOT.W || hs === HOTSPOT.SW ? 0 : hs === HOTSPOT.NE || hs === HOTSPOT.E || hs === HOTSPOT.SE ? w - bw : (w - bw) / 2;
      let y = hs === HOTSPOT.NW || hs === HOTSPOT.N || hs === HOTSPOT.NE ? 0 : hs === HOTSPOT.SW || hs === HOTSPOT.S || hs === HOTSPOT.SE ? h - bh : (h - bh) / 2;
      x += c.xOffset * sx;
      y += c.yOffset * sy;
      ctx.globalAlpha = alpha;
      ctx.drawImage(c.canvas, x - c.originX * sx, y - c.originY * sy, c.canvas.width * sx, c.canvas.height * sy);
      ctx.globalAlpha = 1;
    });

    // Flash, the xlat override, whiteout, then pain on top (D3DPostOverlayEffects order)
    if (fx.flashXlat) {
      const [r, g, b, a] = flashColor(fx.flashXlat);
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(0, 0, w, h);
    }
    // EFFECT_XLATOVERRIDE (the phase spell's fading white): the same colours, until the server clears it
    if (fx.xlatOverride > 0) {
      const [r, g, b, a] = flashColor(fx.xlatOverride);
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.whiteout > 0) {
      const a = Math.max(200, (Math.min(fx.whiteout, 500) * 255) / 500);
      ctx.fillStyle = `rgba(255,255,255,${a / 255})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.pain > 0) {
      const a = (Math.min(fx.pain, 2000) * 204) / 2000;
      ctx.fillStyle = `rgba(255,0,0,${a / 255})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.canvas.style.filter = fx.invert > 0 ? "invert(1)" : "";
  }

  /** The overlay's picture with its own overlays and xlats, lit; cached until it changes. */
  private picture(slot: number, ov: PlayerOverlayState, light: [number, number, number]): Cached | null {
    const base = this.getBgf(ov.info.iconRes);
    if (!base) return null;
    const parts: SpritePart[] = [];
    for (const o of ov.look.overlays) {
      const b = this.getBgf(o.iconRes);
      if (b === undefined) return null;
      if (b) parts.push({ bgf: b, group: o.anim.group, translation: o.translation, hotspot: o.hotspot });
    }
    const q = light.map((v) => Math.round(v * 32) / 32);
    const key = [
      ov.info.iconRes, ov.look.anim.group, ov.look.translation, q.join(","),
      ...parts.map((p) => `${p.bgf.name}:${p.group}:${p.translation}:${p.hotspot}`),
    ].join("|");
    const cached = this.cache[slot];
    if (cached?.key === key) return cached;
    const comp = compositeSprite(
      { base: { bgf: base, group: ov.look.anim.group, translation: ov.look.translation, hotspot: 0 }, overlays: parts, viewAngle: 0 },
      this.xlats,
    );
    const g = base.groups[ov.look.anim.group];
    const bmp = g?.length ? base.bitmaps[g[0]] : undefined;
    let canvas: HTMLCanvasElement | null = null;
    if (comp && bmp) {
      canvas = document.createElement("canvas");
      canvas.width = comp.width;
      canvas.height = comp.height;
      const cx = canvas.getContext("2d")!;
      const img = cx.createImageData(comp.width, comp.height);
      for (let i = 0; i < comp.pixels.length; i++) {
        const v = comp.pixels[i];
        if (v === TRANSPARENT_INDEX) continue;
        img.data[i * 4] = Math.min(255, this.rgb[v * 3] * q[0]);
        img.data[i * 4 + 1] = Math.min(255, this.rgb[v * 3 + 1] * q[1]);
        img.data[i * 4 + 2] = Math.min(255, this.rgb[v * 3 + 2] * q[2]);
        img.data[i * 4 + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
    }
    const c: Cached = {
      key, canvas, originX: comp?.originX ?? 0, originY: comp?.originY ?? 0,
      baseW: bmp?.width ?? 0, baseH: bmp?.height ?? 0, xOffset: bmp?.xOffset ?? 0, yOffset: bmp?.yOffset ?? 0,
    };
    this.cache[slot] = c;
    return c;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
