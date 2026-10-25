// Ours (the spell revamp's phase 9, V4; shards-server's design page): room enchantments you
// can see. Each enchantment on the room (by its icon, as the server sends it in
// BP_ADD_ENCHANTMENT) fades in a look: a colour grade over the mood's, Heat's shimmer,
// Freezing's flakes, Winds' blowing streaks, Silence's muffled sound. Enhanced Visuals only.

import type { ColourGrade } from "./postFx.ts";

export type RoomEnchantKind = "heat" | "freezing" | "winds" | "sandstorm" | "darkness" | "light" | "silence" | "killing" | "martyrs" | "forces";

/** The room enchantments' icons (shards-server kod/object/passive/spell/roomench) */
export const ROOM_ENCHANT_ICONS: Readonly<Record<string, RoomEnchantKind>> = {
  "iheat.bgf": "heat",
  "iicenova.bgf": "freezing",
  "iwinds.bgf": "winds",
  "isandsto.bgf": "sandstorm",
  "idarknes.bgf": "darkness",
  "isunlite.bgf": "light",
  "isilence.bgf": "silence",
  "ikillfel.bgf": "killing",
  "imartyrs.bgf": "martyrs",
  "ifrclite.bgf": "forces",
};

/** What one enchantment does to the grade, at full strength (1 is no change) */
interface GradeShift {
  exposure?: number;
  saturation?: number;
  contrast?: number;
  shadowGain?: readonly [number, number, number];
  highlightGain?: readonly [number, number, number];
}

/** Kept faint: they colour the room, they don't repaint it */
const SHIFTS: Readonly<Record<RoomEnchantKind, GradeShift>> = {
  heat: { exposure: 1.04, saturation: 1.1, shadowGain: [1.06, 1.0, 0.9], highlightGain: [1.1, 1.0, 0.82] },
  freezing: { exposure: 1.03, saturation: 0.8, shadowGain: [0.9, 0.97, 1.1], highlightGain: [0.94, 1.0, 1.12] },
  winds: { saturation: 0.95 },
  sandstorm: { saturation: 0.8, contrast: 0.9, shadowGain: [1.05, 0.98, 0.85], highlightGain: [1.08, 0.98, 0.8] },
  darkness: { exposure: 0.95, saturation: 0.85, contrast: 1.05, shadowGain: [0.92, 0.9, 1.0] },
  light: { exposure: 1.03, highlightGain: [1.05, 1.04, 0.98] },
  silence: { saturation: 0.75, contrast: 0.95 },
  killing: { saturation: 1.05, shadowGain: [1.1, 0.9, 0.9], highlightGain: [1.06, 0.95, 0.95] },
  martyrs: { shadowGain: [1.04, 1.0, 0.94], highlightGain: [1.08, 1.04, 0.92] },
  forces: { exposure: 1.06, shadowGain: [1.02, 1.02, 1.04], highlightGain: [1.08, 1.06, 0.96] },
};

/** How long a look takes to come and to go, ms */
const FADE_IN_MS = 1500;
const FADE_OUT_MS = 2000;

const KINDS = Object.keys(SHIFTS) as RoomEnchantKind[];
const mix = (a: number, b: number, w: number): number => a + (b - a) * w;

export class RoomEnchantLooks {
  /** Each look's strength now, 0..1 */
  private readonly weights = new Map<RoomEnchantKind, number>();

  /** The kinds among these icon names (the room enchantments' iconRes, resolved) */
  static kinds(icons: Iterable<string | undefined>): Set<RoomEnchantKind> {
    const out = new Set<RoomEnchantKind>();
    for (const icon of icons) {
      const k = icon ? ROOM_ENCHANT_ICONS[icon.toLowerCase()] : undefined;
      if (k) out.add(k);
    }
    return out;
  }

  /** Fade toward what's on the room now; `snap` (a new room) jumps there */
  update(on: ReadonlySet<RoomEnchantKind>, dtMs: number, snap = false): void {
    for (const k of KINDS) {
      const w = this.weights.get(k) ?? 0;
      const want = on.has(k) ? 1 : 0;
      const next = snap ? want : want > w ? Math.min(1, w + dtMs / FADE_IN_MS) : Math.max(0, w - dtMs / FADE_OUT_MS);
      if (next > 0) this.weights.set(k, next);
      else this.weights.delete(k);
    }
  }

  /** A look's strength now, 0..1 */
  weight(k: RoomEnchantKind): number {
    return this.weights.get(k) ?? 0;
  }

  /** Whether any look shows */
  get active(): boolean {
    return this.weights.size > 0;
  }

  /** The mood's grade with the looks' shifts on it */
  grade(base: ColourGrade): ColourGrade {
    if (!this.active) return base;
    let { exposure, saturation, contrast } = base;
    const sg: [number, number, number] = [...base.shadowGain];
    const hg: [number, number, number] = [...base.highlightGain];
    for (const [k, w] of this.weights) {
      const s = SHIFTS[k];
      exposure *= mix(1, s.exposure ?? 1, w);
      saturation *= mix(1, s.saturation ?? 1, w);
      contrast *= mix(1, s.contrast ?? 1, w);
      for (let i = 0; i < 3; i++) {
        sg[i] *= mix(1, s.shadowGain?.[i] ?? 1, w);
        hg[i] *= mix(1, s.highlightGain?.[i] ?? 1, w);
      }
    }
    return { exposure, saturation, contrast, shadowGain: sg, highlightGain: hg };
  }

  clear(): void {
    this.weights.clear();
  }
}
