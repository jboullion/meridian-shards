// Ours: lighting moods for Enhanced Lighting (docs/adr/0017-lighting-moods.md). The idea is the UE
// remaster's (meridian-unreal data/environment/moods.json, UMREnvironmentSubsystem): a mood is a
// set of lighting numbers, a cycle is [game hour, mood] keys blended by the hour, and a storm is
// an overlay of multipliers blended in by how stormy it is. The numbers are ours, for a palette
// renderer that keeps the original's sector light and adds a sun, tints, haze and grading on top;
// the colours and the shape of the day follow moods.json (and Godot's conversions of it).

export type Rgb = readonly [number, number, number];

export interface Mood {
  /** The sun's (or by night the moon's) colour, and how much it adds to a surface facing it */
  sunColor: Rgb;
  sunStrength: number;
  /** Tints the original's light (sector light, the server's ambient, flames' base) */
  ambientColor: Rgb;
  /** The original's light on surfaces under open sky is scaled by this, so the sun has room */
  ambientScale: number;
  /** Outdoors: distance haze toward hazeColor, 1 - exp(-density * (depth - start)), fine units */
  hazeColor: Rgb;
  hazeDensity: number;
  hazeStart: number;
  /** What the original's distance fog fades to (black, as the original, indoors) */
  fogColor: Rgb;
  /** The skybox's colour multiplier */
  skyTint: Rgb;
  skyBrightness: number;
  /** Light maps (flames, light spells) are scaled by this */
  flameScale: number;
  /** Grading (postFx.ts) */
  exposure: number;
  saturation: number;
  contrast: number;
  shadowGain: Rgb;
  highlightGain: Rgb;
  bloom: number;
  vignette: number;
  /** Windows' glass (windowMask.ts): how warmly it glows outside at night, and the daylight it lets in indoors */
  windowGlow: number;
  windowDaylight: number;
}

export type MoodKey = keyof Mood;

/** A table entry: what it changes from the mood it inherits */
export type MoodEntry = Partial<Mood> & { inherit?: string };

/** A storm's change to a mood: each field multiplied (mul) and then added to (add) */
export type MoodOverlay = Partial<Record<MoodKey, { mul?: number | Rgb; add?: number | Rgb }>>;

/** Tanner Helland's fit of a black body's colour at `kelvin`, 0..1 (as Godot's make_scene.py kelvin_rgb) */
export function kelvinRgb(kelvin: number): Rgb {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

const mul3 = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
/** Daylight through the air is warmer than the black body (Godot's sun tint, gentler for us) */
const SUN_TINT: Rgb = [1, 0.93, 0.84];
const sun = (kelvin: number): Rgb => mul3(kelvinRgb(kelvin), SUN_TINT);

/** The neutral mood: what Enhanced Lighting looked like before moods (and the base of the table) */
export const NEUTRAL_MOOD: Mood = {
  sunColor: [1, 1, 1],
  sunStrength: 0,
  ambientColor: [1, 1, 1],
  ambientScale: 1,
  hazeColor: [0, 0, 0],
  hazeDensity: 0,
  hazeStart: 0,
  fogColor: [0, 0, 0],
  skyTint: [1, 1, 1],
  skyBrightness: 1,
  flameScale: 1,
  exposure: 1,
  saturation: 1,
  contrast: 1,
  shadowGain: [1, 1, 1],
  highlightGain: [1, 1, 1],
  bloom: 1.4,
  vignette: 0.28,
  windowGlow: 0,
  windowDaylight: 0,
};

export const MOODS: Record<string, MoodEntry> = {
  // moods.json raza_afternoon: a warm 4900 K sun, cool shade, light blue haze, a little punch
  outdoor_day: {
    sunColor: sun(4900),
    sunStrength: 0.75,
    ambientColor: [0.9, 0.96, 1.08],
    ambientScale: 0.6,
    hazeColor: [0.66, 0.71, 0.79],
    hazeDensity: 6e-6,
    hazeStart: 8192,
    fogColor: [0.66, 0.71, 0.79],
    flameScale: 0.8,
    exposure: 1.05,
    saturation: 1.08,
    contrast: 1.08,
    shadowGain: [0.95, 0.98, 1.05],
    highlightGain: [1.04, 1.01, 0.96],
  },
  // raza_morning: a paler 5600 K sun low in the east, ground mist
  outdoor_morning: {
    inherit: "outdoor_day",
    sunColor: sun(5600),
    sunStrength: 0.62,
    ambientScale: 0.66,
    hazeColor: [0.74, 0.77, 0.82],
    hazeDensity: 2.2e-5,
    hazeStart: 3072,
    fogColor: [0.74, 0.77, 0.82],
    saturation: 1.0,
    highlightGain: [1, 1, 1],
    skyBrightness: 0.95,
  },
  // raza_dusk: a low orange 2900 K sun (keyed an hour earlier than moods.json, as the server's dusk is 18 to 20), a violet shade, the lamps beginning to tell
  outdoor_dusk: {
    inherit: "outdoor_day",
    sunColor: sun(2900),
    sunStrength: 0.66,
    ambientColor: [0.9, 0.84, 0.96],
    ambientScale: 0.7,
    hazeColor: [0.52, 0.42, 0.44],
    hazeDensity: 1.3e-5,
    hazeStart: 4096,
    fogColor: [0.3, 0.24, 0.28],
    flameScale: 1.0,
    exposure: 0.96,
    saturation: 1.1,
    highlightGain: [1.08, 0.98, 0.88],
    skyTint: [1.05, 0.92, 0.86],
    bloom: 1.6,
    // moods.json raza_dusk WindowGlow 0.045, at its exposure
    windowGlow: 0.5,
  },
  // raza_night: an 8000 K moon, blue shade, dark blue haze, the flames and windows the warm spots
  outdoor_night: {
    inherit: "outdoor_day",
    sunColor: mul3(kelvinRgb(8000), [0.75, 0.85, 1]),
    sunStrength: 0.14,
    ambientColor: [0.72, 0.82, 1.08],
    ambientScale: 1,
    hazeColor: [0.04, 0.05, 0.09],
    hazeDensity: 1.5e-5,
    hazeStart: 4096,
    fogColor: [0.01, 0.015, 0.035],
    flameScale: 1.15,
    exposure: 1.05,
    saturation: 0.85,
    contrast: 1.06,
    shadowGain: [0.9, 0.95, 1.12],
    highlightGain: [1.06, 1.0, 0.9],
    skyTint: [0.85, 0.9, 1.05],
    bloom: 1.8,
    vignette: 0.35,
    // moods.json raza_night WindowGlow 0.08, at its exposure
    windowGlow: 1.0,
  },
  // raza_interior_day: the room's own light, untinted, no haze
  interior_day: {
    ambientColor: [1, 0.98, 0.95],
    // moods.json raza_interior_day WindowDaylight 0.5
    windowDaylight: 0.6,
    contrast: 1.02,
    vignette: 0.32,
  },
  interior_night: {
    inherit: "interior_day",
    windowDaylight: 0,
    ambientColor: [0.95, 0.9, 0.85],
    exposure: 0.95,
    flameScale: 1.1,
    saturation: 0.95,
  },
  // Godot's warm preset (the Raza inn): firelight and wood
  inn: {
    inherit: "interior_day",
    ambientColor: [1, 0.9, 0.76],
    saturation: 1.05,
    highlightGain: [1.05, 1.0, 0.92],
    flameScale: 1.15,
    bloom: 1.6,
  },
  inn_night: {
    inherit: "inn",
    windowDaylight: 0,
    ambientColor: [0.97, 0.85, 0.7],
    exposure: 0.95,
    flameScale: 1.25,
  },
  // raza_crypt: cold, desaturated, hard
  underground: {
    ambientColor: [0.86, 0.91, 1.02],
    windowDaylight: 0,
    flameScale: 1.1,
    saturation: 0.82,
    contrast: 1.12,
    shadowGain: [0.88, 0.95, 1.12],
    highlightGain: [1.06, 1.0, 0.92],
    bloom: 1.6,
    vignette: 0.4,
  },
  underworld: {
    inherit: "underground",
    ambientColor: [1.0, 0.92, 0.85],
    saturation: 0.9,
  },
};

/** [game hour, mood] keys, by hour (moods.json cycles) */
export type MoodCycle = readonly (readonly [number, string])[];

export const MOOD_CYCLES = {
  outdoor: [
    [0, "outdoor_night"],
    [4.5, "outdoor_night"],
    [6.5, "outdoor_morning"],
    [9.5, "outdoor_day"],
    [16.5, "outdoor_day"],
    [18.5, "outdoor_dusk"],
    [21, "outdoor_night"],
  ],
  interior: [
    [0, "interior_night"],
    [5.5, "interior_night"],
    [8, "interior_day"],
    [18, "interior_day"],
    [20.5, "interior_night"],
  ],
  inn: [
    [0, "inn_night"],
    [5.5, "inn_night"],
    [8, "inn"],
    [18, "inn"],
    [20.5, "inn_night"],
  ],
  underground: [[0, "underground"]],
  underworld: [[0, "underworld"]],
} satisfies Record<string, MoodCycle>;

export type MoodCycleName = keyof typeof MOOD_CYCLES;

/** Storms (moods.json storm_rain, storm_snow): the sun nearly gone, thick grey haze, flatter colour */
export const STORM_OVERLAYS = {
  rain: {
    sunStrength: { mul: 0.15 },
    ambientScale: { mul: 0.9 },
    hazeDensity: { mul: 3 },
    hazeStart: { mul: 0 },
    hazeColor: { mul: [0.75, 0.8, 0.9] },
    fogColor: { mul: [0.75, 0.8, 0.9] },
    skyBrightness: { mul: 0.6 },
    exposure: { mul: 0.9 },
    saturation: { mul: 0.8 },
    contrast: { mul: 0.95 },
    windowDaylight: { mul: 0.35 },
  },
  snow: {
    sunStrength: { mul: 0.25 },
    hazeDensity: { mul: 2.5 },
    hazeStart: { mul: 0.3 },
    hazeColor: { mul: [1.08, 1.1, 1.14] },
    fogColor: { mul: [1.08, 1.1, 1.14] },
    skyBrightness: { mul: 0.75 },
    exposure: { mul: 0.96 },
    saturation: { mul: 0.82 },
    contrast: { mul: 0.94 },
  },
} satisfies Record<string, MoodOverlay>;

/** A table mood with what it inherits filled in, over NEUTRAL_MOOD */
export function resolveMood(name: string, table: Record<string, MoodEntry> = MOODS): Mood {
  const chain: MoodEntry[] = [];
  const seen = new Set<string>();
  for (let n: string | undefined = name; n !== undefined && !seen.has(n); ) {
    seen.add(n);
    const e: MoodEntry | undefined = table[n];
    if (!e) break;
    chain.unshift(e);
    n = e.inherit;
  }
  const out = { ...NEUTRAL_MOOD } as Record<string, unknown>;
  for (const e of chain) {
    for (const [k, v] of Object.entries(e)) if (k !== "inherit" && v !== undefined) out[k] = v;
  }
  return out as unknown as Mood;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Every field from a to b by t (0..1) */
export function blendMoods(a: Mood, b: Mood, t: number): Mood {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {} as Record<string, number | Rgb>;
  for (const k of Object.keys(a) as MoodKey[]) {
    const x = a[k],
      y = b[k];
    out[k] = typeof x === "number" ? lerp(x, y as number, t) : ([lerp(x[0], (y as Rgb)[0], t), lerp(x[1], (y as Rgb)[1], t), lerp(x[2], (y as Rgb)[2], t)] as Rgb);
  }
  return out as unknown as Mood;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** The cycle's mood at `hour` (0..24, fractional): the keys either side, smoothstepped, wrapping over midnight */
export function moodAt(cycle: MoodCycle, hour: number, table: Record<string, MoodEntry> = MOODS): Mood {
  if (cycle.length === 0) return NEUTRAL_MOOD;
  if (cycle.length === 1) return resolveMood(cycle[0][1], table);
  const h = ((hour % 24) + 24) % 24;
  let i = cycle.length - 1;
  for (let k = 0; k < cycle.length; k++) if (cycle[k][0] <= h) i = k;
  const [h0, m0] = cycle[i];
  const [h1raw, m1] = cycle[(i + 1) % cycle.length];
  const h1 = h1raw <= h0 ? h1raw + 24 : h1raw;
  const at = h < h0 ? h + 24 : h;
  const t = h1 > h0 ? (at - h0) / (h1 - h0) : 0;
  if (m0 === m1) return resolveMood(m0, table);
  return blendMoods(resolveMood(m0, table), resolveMood(m1, table), smoothstep(Math.min(1, Math.max(0, t))));
}

/** The mood with the overlay applied, blended in by `amount` (0..1) */
export function withStorm(m: Mood, overlay: MoodOverlay, amount: number): Mood {
  if (amount <= 0) return m;
  const stormy = { ...m } as Record<string, number | Rgb>;
  for (const [k, op] of Object.entries(overlay) as [MoodKey, { mul?: number | Rgb; add?: number | Rgb }][]) {
    const v = m[k];
    const at = (o: number | Rgb | undefined, i: number, none: number) => (o === undefined ? none : typeof o === "number" ? o : o[i]);
    if (typeof v === "number") stormy[k] = v * at(op.mul, 0, 1) + at(op.add, 0, 0);
    else stormy[k] = [0, 1, 2].map((i) => v[i] * at(op.mul, i, 1) + at(op.add, i, 0)) as unknown as Rgb;
  }
  return blendMoods(m, stormy as unknown as Mood, Math.min(1, amount));
}
