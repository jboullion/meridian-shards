// Ours: the numbers that shape ambient life, tunable live in development from the admin
// dashboard (apps/client/admin.html, which sends them to the game tab), and saved back here by
// its "Save as defaults", which rewrites each entry's `value:`. Keep every entry on one line,
// `key: { value: <number>, ... },`, so the save finds it.
//
// Each module reads its values at use (`tune("crowdScale")`), so a change shows at once, or,
// for what's worked out once per room (the crowd, critters), when the room starts over.

/** One tunable number: its value, the range and step the dashboard's slider offers, and where it goes */
export interface Tunable {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  group: string;
}

export type Tunables = Record<string, Tunable>;

export const AMBIENT_TUNING = {
  crowdScale: { value: 1, min: 0, max: 4, step: 0.1, label: "Crowd size (times each room's count)", group: "Crowd" },
  paceMin: { value: 1, min: 0.2, max: 4, step: 0.05, label: "Slowest walking pace (fine units/ms)", group: "Crowd" },
  paceMax: { value: 1.6, min: 0.2, max: 4, step: 0.05, label: "Fastest walking pace (fine units/ms)", group: "Crowd" },
  fleePace: { value: 2.4, min: 1, max: 5, step: 0.1, label: "Running from spells (times their pace)", group: "Crowd" },
  wetPace: { value: 1.3, min: 1, max: 3, step: 0.05, label: "Hurrying in rain and snow (times their pace)", group: "Crowd" },
  errandChance: { value: 0.3, min: 0, max: 1, step: 0.05, label: "Townsfolk who run an errand first", group: "Crowd" },
  torchBearers: { value: 0.8, min: 0, max: 1, step: 0.05, label: "Townsfolk with a torch after dark", group: "Crowd" },
  nearPlayer: { value: 18, min: 4, max: 40, step: 1, label: "Big rooms: those who stay keep within (squares)", group: "Crowd" },
  waveRange: { value: 6, min: 1, max: 15, step: 0.5, label: "Waved at from up to (squares)", group: "Crowd" },
  sayMs: { value: 3200, min: 500, max: 10000, step: 100, label: "A line of speech stays up (ms, plus 40 a letter)", group: "Speech" },
  speakRange: { value: 10, min: 2, max: 30, step: 1, label: "Speech only within (squares of the player)", group: "Speech" },
  maxSpeaking: { value: 2, min: 0, max: 8, step: 1, label: "Most speaking at once", group: "Speech" },
  critterDensity: { value: 0.5, min: 0, max: 3, step: 0.05, label: "Critters (times the habitats' counts)", group: "Critters" },
  critterSpawnNear: { value: 4, min: 1, max: 15, step: 0.5, label: "Turn up at least this far off (squares)", group: "Critters" },
  critterSpawnFar: { value: 12, min: 2, max: 25, step: 0.5, label: "Turn up at most this far off (squares)", group: "Critters" },
  critterGone: { value: 18, min: 4, max: 40, step: 0.5, label: "Gone past (squares)", group: "Critters" },
  corpseMs: { value: 6000, min: 0, max: 30000, step: 500, label: "A squished critter lies (ms)", group: "Critters" },
} satisfies Tunables;

export type AmbientTunable = keyof typeof AMBIENT_TUNING;

/** A tunable's value now */
export const tune = (key: AmbientTunable): number => AMBIENT_TUNING[key].value;
