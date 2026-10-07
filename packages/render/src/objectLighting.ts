// CPU side of the D3D client's lighting for objects and the light-source list
// (clientd3d/draw3d.c GetLightPaletteIndex, d3dlighting.c D3DObjectLightingCalc,
// D3DLMapsStaticGet, D3DLightingXYCalc, D3DLightingColorCalc).

const COLOR_AMBIENT = 239;
const LIGHT_NEUTRAL = 192;
export const MAX_LIGHTS = 32;

/** GetLightPaletteIndex at distance FINENESS (the D3D path; distance falloff is fog). */
export function lightIndex(sectorLight: number, viewerLight: number, ambient: number, scale = 1024): number {
  let idx: number;
  if (sectorLight > 127) {
    const row = Math.min(255, 8 * viewerLight + ambient);
    idx = Math.trunc(((row + sectorLight - LIGHT_NEUTRAL) * 64) / 256);
    if (scale !== 1024) idx = Math.floor((scale * idx) / 1024);
  } else {
    idx = Math.floor((Math.min(255, 16 * viewerLight) * 64) / 256) + Math.floor(sectorLight / 2);
  }
  return Math.max(0, Math.min(63, idx));
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
}

/** d3dlighting.h DLIGHT_SCALE */
export const dlightScale = (intensity: number): number => (intensity * 14000) / 255 + 4000;

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
  const grey = Math.floor((lightIndex(sectorLight, viewerLight, ambient) * COLOR_AMBIENT) / 64);
  if (!nearest) {
    const v = Math.min(COLOR_AMBIENT, grey + add) / 255;
    return [v, v, v];
  }
  const ch = (c: number) => Math.min(COLOR_AMBIENT, Math.min(COLOR_AMBIENT, grey) + (add * c) / COLOR_AMBIENT) / 255;
  return [ch(nearest.r), ch(nearest.g), ch(nearest.b)];
}
