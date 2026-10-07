// Player settings: sound and music (clientd3d/config.c: play_music, play_sound,
// music_volume, sound_volume, play_loop_sounds, play_random_sounds) and key bindings.
//
// Two key presets:
//   modern   - WASD to move and strafe, arrows to turn, mouselook (our default)
//   original - the original client's table (module/merintr/merintr.c interface_key_table):
//              arrows move and turn, Alt+arrows strafe, PgUp/PgDn/Home/End look,
//              Space goes, Enter looks, and typing a letter starts a chat line.
//
// Settings are a per-browser convenience, kept in localStorage (missing storage is fine).

export const ACTIONS = [
  "forward", "backward", "strafeLeft", "strafeRight", "turnLeft", "turnRight", "run",
  "lookUp", "lookDown", "lookStraight", "flip",
  "go", "interact", "lookAt", "chat", "inventory", "mapZoomIn", "mapZoomOut", "settings",
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: "Move forward",
  backward: "Move back",
  strafeLeft: "Strafe left",
  strafeRight: "Strafe right",
  turnLeft: "Turn left",
  turnRight: "Turn right",
  run: "Run (hold)",
  lookUp: "Look up",
  lookDown: "Look down",
  lookStraight: "Look straight",
  flip: "Turn around",
  go: "Open door / use exit",
  interact: "Pick up / activate",
  lookAt: "Look at target",
  chat: "Chat",
  inventory: "Inventory tab",
  mapZoomIn: "Map zoom in",
  mapZoomOut: "Map zoom out",
  settings: "Settings",
};

/** A key (KeyboardEvent.code), optionally only with Alt held (the original's slide keys). */
export interface KeyBinding {
  code: string;
  alt?: boolean;
}
export type KeyMap = Record<Action, KeyBinding[]>;
export type PresetName = "modern" | "original";

const k = (...codes: string[]): KeyBinding[] => codes.map((code) => ({ code }));
const alt = (...codes: string[]): KeyBinding[] => codes.map((code) => ({ code, alt: true }));

export const PRESETS: Record<PresetName, KeyMap> = {
  modern: {
    forward: k("KeyW", "ArrowUp"),
    backward: k("KeyS", "ArrowDown"),
    strafeLeft: [...k("KeyA"), ...alt("ArrowLeft")],
    strafeRight: [...k("KeyD"), ...alt("ArrowRight")],
    turnLeft: k("ArrowLeft"),
    turnRight: k("ArrowRight"),
    run: k("ShiftLeft", "ShiftRight"),
    lookUp: k("PageUp"),
    lookDown: k("PageDown"),
    lookStraight: k("Home"),
    flip: k("End"),
    go: k("Space", "KeyE"),
    interact: k("KeyF"),
    lookAt: k("KeyR"),
    chat: k("Enter", "NumpadEnter"),
    inventory: k("KeyI"),
    mapZoomIn: k("NumpadAdd", "Equal"),
    mapZoomOut: k("NumpadSubtract", "Minus"),
    settings: k("KeyO", "F10"),
  },
  original: {
    forward: k("ArrowUp", "Numpad8"),
    backward: k("ArrowDown", "Numpad2"),
    strafeLeft: alt("ArrowLeft", "Numpad4"),
    strafeRight: alt("ArrowRight", "Numpad6"),
    turnLeft: k("ArrowLeft", "Numpad4"),
    turnRight: k("ArrowRight", "Numpad6"),
    run: k("ShiftLeft", "ShiftRight"),
    lookUp: k("PageUp", "Numpad9"),
    lookDown: k("PageDown", "Numpad3"),
    lookStraight: k("Home", "Numpad5"),
    flip: k("End", "Numpad1"),
    go: k("Space"),
    interact: [],
    lookAt: k("Enter", "NumpadEnter"),
    chat: k("Quote"),
    inventory: [],
    mapZoomIn: k("NumpadAdd"),
    mapZoomOut: k("NumpadSubtract"),
    settings: k("F10"),
  },
};

export interface Settings {
  preset: PresetName;
  /** The preset's keys with the player's changes. */
  keys: KeyMap;
  /** Typing a letter starts a chat line (the original's A_TEXTINSERT keys). */
  typeToChat: boolean;
  music: boolean;
  /** 0..100 */
  musicVolume: number;
  sound: boolean;
  soundVolume: number;
  loopSounds: boolean;
  randomSounds: boolean;
  /** Mouselook speed multiplier */
  mouseSpeed: number;
  invertMouse: boolean;
  /** Minimap zoom (map.c zoom: 0.5 .. 8) */
  mapZoom: number;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: "modern",
  keys: PRESETS.modern,
  typeToChat: false,
  music: true,
  musicVolume: 100,
  sound: true,
  soundVolume: 100,
  loopSounds: true,
  randomSounds: true,
  mouseSpeed: 1,
  invertMouse: false,
  mapZoom: 1,
};

const STORAGE_KEY = "shards.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    const preset: PresetName = s.preset === "original" ? "original" : "modern";
    // Keep any actions added since the settings were saved.
    const keys = { ...PRESETS[preset], ...(s.keys ?? {}) };
    return { ...DEFAULT_SETTINGS, ...s, preset, keys };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage unavailable: keep it for this session
  }
  for (const fn of listeners) fn(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Switch presets; the original preset also turns on type-to-chat. */
export function applyPreset(preset: PresetName): void {
  updateSettings({ preset, keys: PRESETS[preset], typeToChat: preset === "original" });
}

/**
 * Actions bound to a key event. A binding with `alt` needs Alt held; when Alt is held,
 * a key that has an Alt binding only triggers that one (Alt+Left slides, Left turns).
 */
export function actionsFor(keys: KeyMap, code: string, altKey: boolean): Action[] {
  const altBound = altKey && ACTIONS.some((a) => keys[a].some((b) => b.code === code && b.alt));
  return ACTIONS.filter((a) => keys[a].some((b) => b.code === code && (altBound ? b.alt : !b.alt)));
}

/** Whether a held action is active given the keys down now. */
export function isHeld(keys: KeyMap, action: Action, down: ReadonlySet<string>, altKey: boolean): boolean {
  for (const code of down) if (actionsFor(keys, code, altKey).includes(action)) return true;
  return false;
}

/** "Alt+ArrowLeft" -> "Alt+←" for the settings screen. */
export function bindingLabel(b: KeyBinding): string {
  const names: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Quote: "'",
    Equal: "=", Minus: "-", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadEnter: "Num Enter",
    ShiftLeft: "Shift", ShiftRight: "Right Shift",
  };
  const name = names[b.code] ?? b.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return (b.alt ? "Alt+" : "") + name;
}
