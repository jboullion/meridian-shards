// Ours: how many birds, bats, butterflies, fireflies and leaves the scene asks for (at the Normal
// Ambient Life setting), and how fast the ground gets wet and dries. Tunable live in development
// from the admin dashboard (admin.html) and saved back here by its "Save as defaults", which
// rewrites each entry's `value:`. Keep every entry on one line, `key: { value: <number>, ... },`.
// The same shape as @shards/world's AMBIENT_TUNING and @shards/render's RENDER_TUNING.

import type { Tunable } from "@shards/world";

export const SCENE_TUNING = {
  flocks: { value: 2, min: 0, max: 10, step: 1, label: "Flocks of birds by day under open sky", group: "Sky" },
  batsCave: { value: 9, min: 0, max: 40, step: 1, label: "Bats in caves and dungeons", group: "Sky" },
  batsNight: { value: 3, min: 0, max: 20, step: 1, label: "Bats at night elsewhere they live", group: "Sky" },
  butterflies: { value: 8, min: 0, max: 40, step: 1, label: "Butterflies over green country by day", group: "Nature" },
  fireflies: { value: 25, min: 0, max: 100, step: 1, label: "Fireflies at night", group: "Nature" },
  leaves: { value: 12, min: 0, max: 60, step: 1, label: "Falling leaves in forests", group: "Nature" },
  wetUpS: { value: 45, min: 1, max: 600, step: 1, label: "Rain soaks the ground in (s)", group: "Storm" },
  wetDownS: { value: 150, min: 1, max: 1200, step: 1, label: "The ground dries in (s)", group: "Storm" },
} satisfies Record<string, Tunable>;

export type SceneTunable = keyof typeof SCENE_TUNING;

/** A scene tunable's value now */
export const sceneTune = (key: SceneTunable): number => SCENE_TUNING[key].value;
