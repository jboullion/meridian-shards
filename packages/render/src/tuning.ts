// Ours: the numbers that shape ground detail, puddles and lightning, tunable live in development
// from the admin dashboard (apps/client/admin.html) and saved back here by its "Save as
// defaults", which rewrites each entry's `value:`. Keep every entry on one line,
// `key: { value: <number>, ... },`, so the save finds it. The same shape as @shards/world's
// ambient/tuning.ts (this package doesn't depend on that one).

export interface RenderTunable {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  group: string;
}

export const RENDER_TUNING = {
  groundRadius: { value: 20, min: 5, max: 40, step: 1, label: "Ground detail out to (squares)", group: "Ground detail" },
  groundFadeFrom: { value: 15, min: 2, max: 39, step: 1, label: "Ground detail shrinks away past (squares)", group: "Ground detail" },
  rockSize: { value: 0.75, min: 0.1, max: 2, step: 0.05, label: "Rocks' size (times the ornament's, at most)", group: "Ground detail" },
  puddleRadius: { value: 18, min: 5, max: 40, step: 1, label: "Puddles out to (squares)", group: "Puddles" },
  puddleFadeFrom: { value: 13, min: 2, max: 39, step: 1, label: "Puddles fade away past (squares)", group: "Puddles" },
  puddlePaved: { value: 0.098, min: 0, max: 1, step: 0.005, label: "Chance of a puddle on a paved square", group: "Puddles" },
  puddleEarth: { value: 0.126, min: 0, max: 1, step: 0.005, label: "Chance of a puddle on an earth square", group: "Puddles" },
  puddleGrass: { value: 0.035, min: 0, max: 1, step: 0.005, label: "Chance of a puddle on a grass square", group: "Puddles" },
  lightningGapMin: { value: 5, min: 1, max: 60, step: 1, label: "Shortest wait between strikes (s)", group: "Storm" },
  lightningGapMax: { value: 18, min: 1, max: 120, step: 1, label: "Longest wait between strikes (s)", group: "Storm" },
  lightningNear: { value: 45, min: 10, max: 100, step: 1, label: "Strikes at least this far off (squares)", group: "Storm" },
  lightningFar: { value: 70, min: 10, max: 150, step: 1, label: "Strikes at most this far off (squares)", group: "Storm" },
} satisfies Record<string, RenderTunable>;

export type RenderTunableKey = keyof typeof RENDER_TUNING;

/** A render tunable's value now */
export const renderTune = (key: RenderTunableKey): number => RENDER_TUNING[key].value;
