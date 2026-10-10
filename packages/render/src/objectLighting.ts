// CPU side of the D3D client's lighting for objects and the light-source list
// (clientd3d/draw3d.c GetLightPaletteIndex, d3dlighting.c D3DObjectLightingCalc,
// D3DLMapsStaticGet, D3DLightingXYCalc, D3DLightingColorCalc).

const COLOR_AMBIENT = 239;
const LIGHT_NEUTRAL = 192;
export const MAX_LIGHTS = 32;

/**
 * GetLightPaletteIndex at distance FINENESS (the D3D path; distance falloff is fog).
 * `offset` is the object's light adjustment (OF_FLASHING: animate.c lightAdjust).
 */
export function lightIndex(sectorLight: number, viewerLight: number, ambient: number, scale = 1024, offset = 0): number {
  let idx: number;
  if (sectorLight > 127) {
    const row = Math.min(255, 8 * viewerLight + ambient);
    idx = Math.trunc(((row + sectorLight - LIGHT_NEUTRAL) * 64) / 256);
    if (scale !== 1024) idx = Math.floor((scale * idx) / 1024);
  } else {
    idx = Math.floor((Math.min(255, 16 * viewerLight) * 64) / 256) + Math.floor(sectorLight / 2);
  }
  return Math.max(0, Math.min(63, idx + offset));
}

/** d3drender.c D3DRenderFogEndCalc, in fine units. */
export function fogEnd(sectorLight: number, viewerLight: number, ambient: number): number {
  return sectorLight <= 127
    ? 16384 + sectorLight * 1024 + viewerLight * 64
    : 32768 + Math.max(0, sectorLight - LIGHT_NEUTRAL) * 1024 + viewerLight * 64 + ambient * 1024;
}

export interface LightSource {
  /** client fine coordinates */
  x: number;
  y: number;
  z: number;
  /** DLIGHT_SCALE(intensity): the light's full width; it reaches scale / 2 */
  scale: number;
  /** 0..255 */
  r: number;
  g: number;
  b: number;
  /** The object it comes from (flicker seeds by it) */
  id?: number;
  /**
   * LIGHT_FLAG_HIGHLIGHT (signs, the targeting light): a tenth of the size (D3DLightingXYCalc)
   * and no falloff on floors (D3DRenderLMapPostFloorAdd)
   */
  highlight?: boolean;
  /** Ours: it moves (projectiles, the targeting light, objects in motion), so it isn't kept from shining through walls */
  moving?: boolean;
}

/** trig.h SIN: maketrig.c's table, 16 fractional bits, 4096 angle units */
const sinTable = (angle: number): number => Math.trunc(Math.sin(((angle & 4095) * 2 * Math.PI) / 4096) * 65536);
/** FIXED_TO_INT(fpMul(level, SIN(angle))): level * sin, as the client's 8-bit fixed point rounds it */
export const fixedSin = (level: number, angle: number): number => ((level * sinTable(angle) + 128) >> 8) >> 8;

/** animate.c TIME_FLASH, FLASH_LEVEL (LIGHT_LEVELS / 2) */
const TIME_FLASH = 1000;
const FLASH_LEVEL = 32;

/**
 * animate.c AnimateObject, OF_FLASHING: advance the flash clock by dt (at most 50 ms a
 * step) and return [new clock, light adjustment]. Kod flashes invisible things this way
 * for those who can see them (user.kod, detect invisible).
 */
export function flashStep(time: number, dt: number): [number, number] {
  let t = time + Math.min(dt, 50);
  if (t > TIME_FLASH) t -= TIME_FLASH;
  return [t, fixedSin(FLASH_LEVEL, Math.trunc((4096 * t) / TIME_FLASH))];
}

/** d3dlighting.h DLIGHT_SCALE */
export const dlightScale = (intensity: number): number => (intensity * 14000) / 255 + 4000;

/** include/proto.h LIGHT_FLAG_*: an object's light flags (BP_* light information) */
export const LIGHT_FLAG = { ON: 0x1, DYNAMIC: 0x2, WAVERING: 0x4, HIGHLIGHT: 0x8 } as const;

/**
 * Whether an object's light is a highlight light (signs: sign.kod). D3DLMapsStaticGet keeps
 * the flags only for dynamic lights: for a static one it writes them into the other cache
 * (gDLightCacheDynamic), so its own are never set and it's drawn full size.
 */
export const isHighlightLight = (flags: number): boolean => (flags & LIGHT_FLAG.HIGHLIGHT) !== 0 && (flags & LIGHT_FLAG.DYNAMIC) !== 0;

/** d3dlighting.c D3DLightingXYCalc: a highlight light's scale (LIGHT_FLAG_HIGHLIGHT) */
export const highlightScale = (intensity: number): number => dlightScale(intensity) * 0.1;

/** 15-bit 5:5:5 colour (D3DLightingColorCalc). */
export function lightColor(c: number): { r: number; g: number; b: number } {
  return {
    r: Math.trunc((((c >> 10) & 31) * 255) / 31),
    g: Math.trunc((((c >> 5) & 31) * 255) / 31),
    b: Math.trunc(((c & 31) * 255) / 31),
  };
}

/**
 * An object's colour multiplier (0..1 per channel), D3DObjectLightingCalc: its sector
 * light through GetLightPaletteIndex, plus the nearest light source.
 */
export function objectBrightness(
  pos: { x: number; y: number; z: number },
  sectorLight: number,
  viewerLight: number,
  ambient: number,
  lights: LightSource[],
  lightOffset = 0,
): [number, number, number] {
  let nearest: LightSource | null = null;
  let best = (255 * 14000) / 255 + 4000; // DLIGHT_SCALE(255), as in the C code
  for (const l of lights) {
    const d = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z) / (l.scale / 2);
    if (d < best) {
      best = d;
      nearest = l;
    }
  }
  const add = COLOR_AMBIENT * Math.max(0, 1 - best);
  const grey = Math.floor((lightIndex(sectorLight, viewerLight, ambient, 1024, lightOffset) * COLOR_AMBIENT) / 64);
  if (!nearest) {
    const v = Math.min(COLOR_AMBIENT, grey + add) / 255;
    return [v, v, v];
  }
  const ch = (c: number) => Math.min(COLOR_AMBIENT, Math.min(COLOR_AMBIENT, grey) + (add * c) / COLOR_AMBIENT) / 255;
  return [ch(nearest.r), ch(nearest.g), ch(nearest.b)];
}

/**
 * Ours (Enhanced lighting): whether a light's colour is a flame's, warm with red over green
 * over blue (LIGHT_FIRE is 255, 197, 49). Magic lights and white lamps burn steady.
 */
export const isFireColor = (r: number, g: number, b: number): boolean => r >= g && g >= b && r > 0 && r >= 1.5 * b + 40;

/**
 * Ours (Enhanced lighting): how bright a flame is at `tMs`, 0.85..1. A few sines at
 * unrelated rates (about 5 to 11 a second), shifted by the object's id so torches don't
 * flicker together. The same id and time always give the same value.
 */
export function flicker(id: number, tMs: number): number {
  const t = tMs / 1000;
  const seed = ((id * 2654435761) >>> 0) / 4294967296; // 0..1
  const p = seed * 2 * Math.PI;
  const v = Math.sin(t * 31.4 + p) * 0.5 + Math.sin(t * 47.1 + p * 3.1) * 0.3 + Math.sin(t * 69.7 + p * 5.3) * 0.2; // -1..1
  return 0.925 + 0.075 * v;
}
