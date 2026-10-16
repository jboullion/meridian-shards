// Every live-tunable number (development: the admin dashboard, admin.html), by the table and
// the source file it's declared in. The dashboard lists them from here, the game tab applies
// what the dashboard sends (devBridge.ts), and "Save as defaults" rewrites each file's values
// (tools/dev/adminApi.ts).

import { AMBIENT_TUNING, type Tunable } from "@shards/world";
import { RENDER_TUNING } from "@shards/render";
import { SCENE_TUNING } from "./sceneTuning.ts";

export interface TuningTable {
  id: string;
  /** Where it's declared, from the repo's root */
  file: string;
  table: Record<string, Tunable>;
}

export const TUNING_TABLES: readonly TuningTable[] = [
  { id: "ambient", file: "packages/world/src/ambient/tuning.ts", table: AMBIENT_TUNING },
  { id: "scene", file: "apps/client/src/game/sceneTuning.ts", table: SCENE_TUNING },
  { id: "render", file: "packages/render/src/tuning.ts", table: RENDER_TUNING },
];

/** Values by table id, then key */
export type TuningValues = Record<string, Record<string, number>>;

/** Each table's values as the source has them (before anything was changed live) */
export const TUNING_DEFAULTS: TuningValues = Object.fromEntries(
  TUNING_TABLES.map((t) => [t.id, Object.fromEntries(Object.entries(t.table).map(([k, v]) => [k, v.value]))]),
);

/** Sets the values given (clamped to each one's range); returns whether any changed */
export function applyTuning(values: TuningValues): boolean {
  let changed = false;
  for (const t of TUNING_TABLES) {
    for (const [key, v] of Object.entries(values[t.id] ?? {})) {
      const entry = t.table[key];
      if (!entry || typeof v !== "number" || !Number.isFinite(v)) continue;
      const next = Math.min(entry.max, Math.max(entry.min, v));
      if (next !== entry.value) {
        entry.value = next;
        changed = true;
      }
    }
  }
  return changed;
}

/** The values that differ from the source's */
export function tuningChanges(): TuningValues {
  const out: TuningValues = {};
  for (const t of TUNING_TABLES) {
    for (const [key, entry] of Object.entries(t.table)) {
      if (entry.value !== TUNING_DEFAULTS[t.id]?.[key]) (out[t.id] ??= {})[key] = entry.value;
    }
  }
  return out;
}
