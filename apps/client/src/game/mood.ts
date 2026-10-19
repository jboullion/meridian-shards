// Ours: Enhanced Lighting's moods, worked out each frame (docs/adr/0017-lighting-moods.md). Which
// cycle the room follows (moodZone.ts), the game hour with its fraction (sunPath.ts GameClock),
// the cycle's mood at that hour, a storm over it, a short fade when the room changes, and the
// dashboard's knobs (RENDER_TUNING "Moods"); then where the sun or moon is and how strongly it
// shines. GameScene hands the result to the room's shader (moodUniforms), the sprites, the sky
// and PostFx.

import type { Room } from "@shards/formats";
import {
  GameClock, MOOD_CYCLES, NEUTRAL_MOOD, STORM_OVERLAYS, blendMoods, moodAt, renderTune, skyDirection, sunAt, withStorm,
  type ColourGrade, type Mood, type MoodCycleName, type Rgb,
} from "@shards/render";
import { zoneKind } from "./moodZone.ts";

/** Where the sun is too low to shine, and how far below the horizon the moon takes over (sin of the elevation) */
const SUN_FADE = 0.1;
const MOON_AFTER = -0.1;
/** When the moon is down, its light comes from high in the south */
const MOON_FALLBACK = skyDirection(1024, 700);
/** How fast a storm comes on and goes (ms to most of the way) */
const STORM_MS = 8000;
/** How long the sun's shadows take to appear once their map is baked (ms) */
const SHADOW_FADE_MS = 1000;

export interface MoodInput {
  room: Room;
  /** The room's file, lower case */
  file: string;
  terrain: readonly string[] | undefined;
  /** The server's hour (hourFromSun), or null before the sun is sent */
  serverHour: number | null;
  /** The dev tools' hour instead (gameScene.ambientHour), or null */
  pinnedHour: number | null;
  /** The moon's overlay, if it's sent */
  moon: { angle: number; height: number } | null;
  raining: boolean;
  snowing: boolean;
  /** Whether the room has its sun map ready (RoomView.sunShadows) */
  sunMapReady: boolean;
  nowMs: number;
  dtMs: number;
}

export interface MoodFrame {
  mood: Mood;
  kind: MoodCycleName;
  /** The game hour, with its fraction */
  hour: number;
  /** Toward the light (sun or moon), client axes; its colour times its strength, with the knobs */
  sunDir: [number, number, number];
  sunColor: Rgb;
  /** How dark the sun's shadows are now (0 until the map is baked, fading in) */
  shadow: number;
  /** The light's tint, with the knob */
  ambientColor: Rgb;
  hazeDensity: number;
  grade: ColourGrade;
}

const towardWhite = (c: Rgb, k: number): Rgb => [1 + (c[0] - 1) * k, 1 + (c[1] - 1) * k, 1 + (c[2] - 1) * k];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class MoodDirector {
  private readonly clock = new GameClock();
  private file = "";
  private kind: MoodCycleName = "interior";
  /** Whether the room has open sky at all (an interior with a courtyard still gets the sun there) */
  private sky = false;
  /** The mood being faded from on a room change, and when the fade began */
  private from: Mood | null = null;
  private fadeAt = 0;
  private last: Mood = NEUTRAL_MOOD;
  private storm = 0;
  private stormKind: "rain" | "snow" = "rain";
  private shadowFade = 0;
  /** The last frame's result (for the dev tools) */
  current: MoodFrame | null = null;

  frame(i: MoodInput): MoodFrame {
    if (i.file !== this.file) {
      this.file = i.file;
      this.kind = zoneKind(i.room, i.file, i.terrain);
      this.sky = i.room.sectors.some((s) => s.ceilingType === 0);
      this.from = this.current ? this.last : null;
      this.fadeAt = i.nowMs;
      this.shadowFade = 0;
    }
    const hour = i.pinnedHour ?? (i.serverHour === null ? 12 : this.clock.hourNow(i.serverHour, i.nowMs));
    let mood = moodAt(MOOD_CYCLES[this.kind], hour);
    // A roofed room's open courtyards get the day's sun
    if (this.kind !== "outdoor" && this.sky) {
      const out = moodAt(MOOD_CYCLES.outdoor, hour);
      mood = { ...mood, sunColor: out.sunColor, sunStrength: out.sunStrength, ambientScale: out.ambientScale };
    }
    // Storms are outdoors (moods.json storm_rain, storm_snow)
    const stormy = this.kind === "outdoor" && (i.raining || i.snowing);
    if (i.raining) this.stormKind = "rain";
    else if (i.snowing) this.stormKind = "snow";
    this.storm += ((stormy ? 1 : 0) - this.storm) * Math.min(1, i.dtMs / STORM_MS);
    mood = withStorm(mood, STORM_OVERLAYS[this.stormKind], this.storm);
    const fadeMs = renderTune("moodFadeS") * 1000;
    if (this.from && fadeMs > 0 && i.nowMs - this.fadeAt < fadeMs) mood = blendMoods(this.from, mood, smooth(0, 1, (i.nowMs - this.fadeAt) / fadeMs));
    else this.from = null;
    this.last = mood;

    // The sun by day; the moon (or its glow, from high in the south) once the sun is well down
    const sun = sunAt(hour).dir;
    let dir: [number, number, number] = sun;
    let strength = smooth(0, SUN_FADE, sun[2]);
    if (sun[2] <= 0) {
      const moonUp = i.moon && i.moon.height < 0x8000 && i.moon.height > 0;
      dir = moonUp ? skyDirection(i.moon!.angle, i.moon!.height) : MOON_FALLBACK;
      strength = smooth(0, MOON_AFTER, sun[2]) * (moonUp ? smooth(0, SUN_FADE, dir[2]) : 1);
    }
    const k = mood.sunStrength * strength * renderTune("moodSun");
    this.shadowFade = i.sunMapReady ? Math.min(1, this.shadowFade + i.dtMs / SHADOW_FADE_MS) : 0;
    const g = renderTune("moodGrade");
    const frame: MoodFrame = {
      mood,
      kind: this.kind,
      hour,
      sunDir: dir,
      sunColor: [mood.sunColor[0] * k, mood.sunColor[1] * k, mood.sunColor[2] * k],
      // Only the sun casts shadows (the moon's are too faint to be worth a map)
      shadow: sun[2] > 0 ? renderTune("moodShadow") * this.shadowFade * strength : 0,
      ambientColor: towardWhite(mood.ambientColor, renderTune("moodTint")),
      hazeDensity: mood.hazeDensity * renderTune("moodHaze"),
      grade: {
        exposure: lerp(1, mood.exposure, g),
        saturation: lerp(1, mood.saturation, g),
        contrast: lerp(1, mood.contrast, g),
        shadowGain: towardWhite(mood.shadowGain, g),
        highlightGain: towardWhite(mood.highlightGain, g),
      },
    };
    this.current = frame;
    return frame;
  }
}
