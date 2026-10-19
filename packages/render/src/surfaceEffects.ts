// Ours (docs/adr/0018-seasons-water-windows.md): what the room shader (lighting.ts) does to a
// surface beyond the original's lighting, each under its own option:
//   - Seasons: foliage walls' and grass floors' green pixels take the season (the UE remaster's
//     SEASON_HLSL, meridian-unreal tools/ue/environment_materials.py): fresher in spring, golden
//     to red in fall, pale in winter. Summer is the original. Only the mainland's rooms
//     (apps/client/src/game/seasonZone.ts).
//   - Snow: while it snows (and a while after), open floors facing up whiten.
//   - Enhanced Water: water floors ripple (two layers of moving waves), waver, reflect the sky
//     at a grazing look (fresnel), glint with the sun or moon, and darken a little where deep.
//   - Windows: a wall texture's glass (windowMask.ts) glows warm at night, and lets daylight in
//     indoors, by the mood.
// The uniforms are shared by every room material, so a frame sets them once.

/** Per-surface flags, in the aFx attribute (RoomView.build) */
export const FX = {
  /** x: takes the season (a foliage wall or a grass floor); w: it's grass (fall goes golden, not red) */
  SEASONAL: 0,
  /** y: a water floor; z: its sector's depth, 0..1 */
  WATER: 1,
} as const;

export const effectUniforms = {
  /** Seconds, for the water's waves */
  uTime: { value: 0 },
  /** Seasons: on in a seasonal room (1), the season (0 spring .. 3 winter) and how strong */
  uSeasonOn: { value: 0 },
  uSeason: { value: 1 },
  uSeasonStrength: { value: 1 },
  /** How much snow lies on open floors, 0..1 */
  uSnow: { value: 0 },
  /** Enhanced Water on (1); the sky it reflects, and the sun's (or moon's) glint colour and direction (client axes) */
  uWaterOn: { value: 0 },
  uWaterSky: { value: [0.55, 0.62, 0.7] as [number, number, number] },
  uWaterGlint: { value: [0, 0, 0] as [number, number, number] },
  uWaterSunDir: { value: [0, 0, 1] as [number, number, number] },
  /** How much sky it mirrors, how strongly its waves shade it, and how much they waver it (RENDER_TUNING water*) */
  uWaterTune: { value: [0.32, 0.4, 0.002] as [number, number, number] },
  /** Windows: how strongly glass glows outside at night, and how much daylight it lets in indoors */
  uWindowGlow: { value: 0 },
  uWindowDaylight: { value: 0 },
};

/** The warm light of a lit window at night (moods.json WindowGlowColor), and daylight's blue through glass indoors */
export const WINDOW_GLOW_COLOR = [1, 0.62, 0.3] as const;
export const WINDOW_DAY_COLOR = [0.85, 0.92, 1] as const;

export const surfaceEffectsGlsl = /* glsl */ `
uniform float uTime;
uniform float uSeasonOn;
uniform float uSeason;
uniform float uSeasonStrength;
uniform float uSnow;
uniform float uWaterOn;
uniform vec3 uWaterSky;
uniform vec3 uWaterGlint;
uniform vec3 uWaterSunDir;
uniform vec3 uWaterTune;
uniform float uWindowGlow;
uniform float uWindowDaylight;

float fxHash(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The season on a colour (display RGB), its world place (client fine units) and whether it's grass:
// SEASON_HLSL, worked in linear light as the remaster's is. Only greens and yellow-greens change.
vec3 seasonTint(vec3 c, vec2 wp, float grass) {
  vec3 l = pow(c, vec3(2.2));
  float g = max(l.g, 1e-4);
  float plant = clamp((l.g - l.b) / g * 2.0 - 0.3, 0.0, 1.0) * clamp(1.0 - (l.r - l.g) / g * 3.0, 0.0, 1.0) * uSeasonStrength;
  float lum = dot(l, vec3(0.3, 0.59, 0.11));
  // 450 cm in the remaster: about four squares
  float n = fxNoise(wp / 4096.0);
  float t = clamp(n * 1.3 - 0.15 + (lum - 0.1) * 2.0, 0.0, 1.0);
  vec3 o = l;
  if (uSeason < 0.5) {
    o = mix(l, l * vec3(0.94, 1.1, 0.88), plant);
  } else if (uSeason > 1.5 && uSeason < 2.5) {
    vec3 fall = mix(vec3(0.62, 0.17, 0.04), mix(vec3(1.0, 0.42, 0.07), vec3(1.0, 0.75, 0.16), clamp(t * 2.0 - 1.0, 0.0, 1.0)), clamp(t * 2.0, 0.0, 1.0));
    vec3 autumn = mix(fall * lum * 2.3, mix(l, vec3(0.95, 0.78, 0.4) * lum * 1.9, 0.6), grass);
    o = mix(l, autumn, plant);
  } else if (uSeason > 2.5) {
    vec3 winter = mix(vec3(lum), vec3(1.12, 0.98, 0.74) * lum, 0.7) * 0.85;
    o = mix(l, winter, plant);
  }
  return pow(max(o, vec3(0.0)), vec3(1.0 / 2.2));
}

// How much snow lies here (a floor facing up, under the sky), broken up a little
float snowCover(vec3 n, vec2 wp) {
  if (uSnow <= 0.0) return 0.0;
  float up = clamp((n.z - 0.55) * 4.0, 0.0, 1.0);
  return up * clamp(uSnow * 1.5, 0.0, 1.0) * mix(0.55, 1.0, fxNoise(wp / 900.0)) * 0.95;
}

// The water's slope at a place (client fine units): two layers of waves moving across, as the
// remaster's two panned ripple layers (260 and 138 cm repeats)
vec2 waterSlope(vec2 wp) {
  vec2 p = wp / 1024.0;
  float t = uTime;
  vec2 s = vec2(0.0);
  // (direction, wavenumber per square, speed, height)
  vec4 w[6] = vec4[6](
    vec4(normalize(vec2(1.0, 0.4)), 3.1, 1.3),
    vec4(normalize(vec2(-0.6, 1.0)), 4.7, 1.7),
    vec4(normalize(vec2(0.2, -1.0)), 6.3, 2.1),
    vec4(normalize(vec2(-1.0, -0.3)), 9.1, 2.6),
    vec4(normalize(vec2(0.8, 0.9)), 12.7, 3.3),
    vec4(normalize(vec2(-0.3, 0.7)), 17.3, 4.1)
  );
  for (int i = 0; i < 6; i++) {
    float phase = dot(w[i].xy, p) * w[i].z + t * w[i].w + float(i) * 1.7;
    s += w[i].xy * cos(phase) / w[i].z;
  }
  return s * 0.9;
}
`;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const hash = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** The shader's fxNoise, for the tufts (groundCover.ts) and tests */
export function fxNoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const ux = smooth(x - ix),
    uy = smooth(y - iy);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}

/** The shader's seasonTint, for the tufts (groundCover.ts) and tests: a display RGB colour (0..1) */
export function seasonTint(c: readonly [number, number, number], season: number, wx: number, wy: number, grass: boolean, strength = 1): [number, number, number] {
  const l = c.map((v) => Math.pow(v, 2.2)) as [number, number, number];
  const g = Math.max(l[1], 1e-4);
  const plant = clamp01(((l[1] - l[2]) / g) * 2 - 0.3) * clamp01(1 - ((l[0] - l[1]) / g) * 3) * strength;
  const lum = l[0] * 0.3 + l[1] * 0.59 + l[2] * 0.11;
  const t = clamp01(fxNoise(wx / 4096, wy / 4096) * 1.3 - 0.15 + (lum - 0.1) * 2);
  const mix3 = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
  let o: number[] = l;
  if (season === 0) o = mix3(l, [l[0] * 0.94, l[1] * 1.1, l[2] * 0.88], plant);
  else if (season === 2) {
    const fall = mix3([0.62, 0.17, 0.04], mix3([1, 0.42, 0.07], [1, 0.75, 0.16], clamp01(t * 2 - 1)), clamp01(t * 2));
    const autumn = mix3(fall.map((v) => v * lum * 2.3), mix3(l, [0.95, 0.78, 0.4].map((v) => v * lum * 1.9), 0.6), grass ? 1 : 0);
    o = mix3(l, autumn, plant);
  } else if (season === 3) {
    const winter = mix3([lum, lum, lum], [1.12 * lum, 0.98 * lum, 0.74 * lum], 0.7).map((v) => v * 0.85);
    o = mix3(l, winter, plant);
  }
  return o.map((v) => Math.pow(Math.max(0, v), 1 / 2.2)) as [number, number, number];
}
