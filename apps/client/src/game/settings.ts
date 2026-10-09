// Player settings, kept per browser in localStorage (missing storage is fine). They follow
// the original client's three places for options:
//   Preferences    client.rc IDD_SETTINGS / config.c (Web Browser left out). Some options
//                  aren't implemented yet; they're kept so they work once they are
//                  (docs/missing-features.md). The Game Options and "Can attack innocent
//                  players" live on the server instead (CF_* via UC_SEND_PREFERENCES).
//   Configuration  the Bind Editor (m59bind.exe, config.ini [config] and [keys]) without
//                  Classic Key Binding or Software Renderer.
//   Actions        Who (ignore lists), groups (groups.c), hotkey and command aliases (alias.c).
//
// Two key presets: modern (WASD plus mouselook, our default) and original, the original
// client's table (module/merintr/merintr.c interface_key_table: arrows move and turn,
// Alt+arrows strafe, PgUp/PgDn/Home/End look, Space goes, Enter looks).

/** Bind Editor actions, by tab, in its order (m59bind.exe; config.ini [keys]). */
export const ACTION_TABS = {
  Movement: ["forward", "backward", "turnLeft", "turnRight", "strafeLeft", "strafeRight", "run", "lookUp", "lookDown", "lookStraight", "flip", "mouselookToggle"],
  Communication: ["say", "chat", "tell", "yell", "broadcast", "who", "emote"],
  Interaction: ["go", "interact", "lookAt", "examine", "offer", "buy", "deposit", "withdraw", "attack"],
  Targeting: ["targetNext", "targetPrevious", "targetClear", "targetSelf", "tabForward", "tabBackward", "selectTarget"],
  Map: ["map", "mapZoomIn", "mapZoomOut"],
  // Ours: keys for our own panels and menus, and the quick slots (quickSlots.ts)
  Interface: [
    "inventory", "settings", "configuration", "actions",
    "quickSlot1", "quickSlot2", "quickSlot3", "quickSlot4", "quickSlot5", "quickSlot6", "quickSlot7", "quickSlot8", "quickSlot9",
    "quickSlot10",
  ],
} as const;

export type ActionTab = keyof typeof ACTION_TABS;
export type Action = (typeof ACTION_TABS)[ActionTab][number];
export const ACTIONS: readonly Action[] = Object.values(ACTION_TABS).flat();

/** The Bind Editor's labels (ours for the Interface tab). */
export const ACTION_LABELS: Record<Action, string> = {
  forward: "Forward",
  backward: "Backward",
  turnLeft: "Turn Left",
  turnRight: "Turn Right",
  strafeLeft: "Slide Left",
  strafeRight: "Slide Right",
  run: "Run/Walk",
  lookUp: "Look Up",
  lookDown: "Look Down",
  lookStraight: "Look Straight",
  flip: "Flip",
  mouselookToggle: "Mouselook Toggle",
  say: "Say",
  chat: "Chat",
  tell: "Tell",
  yell: "Yell",
  broadcast: "Broadcast",
  who: "Who",
  emote: "Emote",
  go: "Open",
  interact: "Pick Up",
  lookAt: "Look",
  examine: "Examine",
  offer: "Offer",
  buy: "Buy",
  deposit: "Deposit",
  withdraw: "Withdraw",
  attack: "Attack",
  targetNext: "Target Next",
  targetPrevious: "Target Previous",
  targetClear: "Target Clear",
  targetSelf: "Target Self",
  tabForward: "Tab Forward",
  tabBackward: "Tab Backward",
  selectTarget: "Select Target",
  map: "Map",
  mapZoomIn: "Map Zoom In",
  mapZoomOut: "Map Zoom Out",
  inventory: "Inventory",
  settings: "Preferences",
  configuration: "Configuration",
  actions: "Actions",
  quickSlot1: "Quick Slot 1",
  quickSlot2: "Quick Slot 2",
  quickSlot3: "Quick Slot 3",
  quickSlot4: "Quick Slot 4",
  quickSlot5: "Quick Slot 5",
  quickSlot6: "Quick Slot 6",
  quickSlot7: "Quick Slot 7",
  quickSlot8: "Quick Slot 8",
  quickSlot9: "Quick Slot 9",
  quickSlot10: "Quick Slot 10",
};

/**
 * A key (KeyboardEvent.code) or mouse button ("Mouse0" left, "Mouse1" right, "Mouse2"
 * middle, as config.ini numbers them), optionally only with Alt or Ctrl held.
 */
export interface KeyBinding {
  code: string;
  alt?: boolean;
  ctrl?: boolean;
}
export type KeyMap = Record<Action, KeyBinding[]>;
export type PresetName = "modern" | "original";

const k = (...codes: string[]): KeyBinding[] => codes.map((code) => ({ code }));
const alt = (...codes: string[]): KeyBinding[] => codes.map((code) => ({ code, alt: true }));

export const PRESETS: Record<PresetName, KeyMap> = {
  modern: {
    forward: k("KeyW", "ArrowUp"),
    backward: k("KeyS", "ArrowDown"),
    turnLeft: k("ArrowLeft"),
    turnRight: k("ArrowRight"),
    strafeLeft: [...k("KeyA"), ...alt("ArrowLeft")],
    strafeRight: [...k("KeyD"), ...alt("ArrowRight")],
    run: k("ShiftLeft", "ShiftRight"),
    lookUp: k("PageUp"),
    lookDown: k("PageDown"),
    lookStraight: k("Home"),
    flip: k("End"),
    mouselookToggle: k("KeyC"),
    say: [],
    chat: k("Enter", "NumpadEnter"),
    tell: k("KeyT"),
    yell: k("KeyY"),
    broadcast: k("KeyB"),
    // Ctrl+W, the original's, closes a browser tab
    who: [],
    emote: k("Semicolon"),
    go: k("Space"),
    interact: k("KeyF"),
    lookAt: k("KeyR"),
    // right click examines, as in the original (merintr.c VK_RBUTTON A_LOOKMOUSE)
    examine: k("Mouse1"),
    offer: [],
    buy: [],
    deposit: [],
    withdraw: [],
    attack: k("KeyE"),
    targetNext: k("BracketRight", "Tab"),
    targetPrevious: k("BracketLeft"),
    targetClear: k("Escape"),
    targetSelf: k("Backslash"),
    tabForward: [],
    tabBackward: [],
    selectTarget: k("Mouse0"),
    map: [],
    mapZoomIn: k("NumpadAdd", "Equal"),
    mapZoomOut: k("NumpadSubtract", "Minus"),
    inventory: k("KeyI"),
    settings: k("KeyO", "F10"),
    configuration: [],
    actions: [],
    quickSlot1: k("Digit1"),
    quickSlot2: k("Digit2"),
    quickSlot3: k("Digit3"),
    quickSlot4: k("Digit4"),
    quickSlot5: k("Digit5"),
    quickSlot6: k("Digit6"),
    quickSlot7: k("Digit7"),
    quickSlot8: k("Digit8"),
    quickSlot9: k("Digit9"),
    quickSlot10: k("Digit0"),
  },
  original: {
    forward: k("ArrowUp", "Numpad8"),
    backward: k("ArrowDown", "Numpad2"),
    turnLeft: k("ArrowLeft", "Numpad4"),
    turnRight: k("ArrowRight", "Numpad6"),
    strafeLeft: alt("ArrowLeft", "Numpad4"),
    strafeRight: alt("ArrowRight", "Numpad6"),
    run: k("ShiftLeft", "ShiftRight"),
    lookUp: k("PageUp", "Numpad9"),
    lookDown: k("PageDown", "Numpad3"),
    lookStraight: k("Home", "Numpad5"),
    flip: k("End", "Numpad1"),
    mouselookToggle: [],
    say: [],
    chat: k("Quote"),
    tell: [],
    yell: [],
    broadcast: [],
    who: [],
    emote: [],
    go: k("Space"),
    interact: [],
    lookAt: k("Enter", "NumpadEnter"),
    // the original: right click examines an object
    examine: k("Mouse1"),
    offer: [],
    buy: [],
    deposit: [],
    withdraw: [],
    // merintr.c: VK_CONTROL attacks the target or the closest attackable; [ ] \ Esc target
    attack: k("ControlLeft", "ControlRight"),
    targetNext: k("BracketRight"),
    targetPrevious: k("BracketLeft"),
    targetClear: k("Escape"),
    targetSelf: k("Backslash"),
    tabForward: [{ code: "Tab" }],
    tabBackward: [],
    selectTarget: k("Mouse0"),
    map: [],
    mapZoomIn: k("NumpadAdd"),
    mapZoomOut: k("NumpadSubtract"),
    inventory: [],
    settings: k("F10"),
    configuration: [],
    actions: [],
    // Typing starts a chat line in the original preset, digits too: no keys unless the player adds them
    quickSlot1: [],
    quickSlot2: [],
    quickSlot3: [],
    quickSlot4: [],
    quickSlot5: [],
    quickSlot6: [],
    quickSlot7: [],
    quickSlot8: [],
    quickSlot9: [],
    quickSlot10: [],
  },
};

/** config.h TARGET_COLOR_*: the halo and targeting light colour. */
export const HALO_COLOR = { red: 0, blue: 1, green: 2 } as const;
export type HaloColor = keyof typeof HALO_COLOR;

/** One function key's alias (alias.c HotkeyAlias): its command, and whether it's sent at once. */
export interface HotkeyAlias {
  command: string;
  enter: boolean;
}

/** alias.c default_aliases (merintr.rc IDS_ALIAS_*): F1 help ... F12 quit, all sent at once. */
export const DEFAULT_HOTKEY_ALIASES: HotkeyAlias[] = [
  "help", "rest", "stand", "neutral", "happy", "sad", "wry", "wave", "point", "addgroup", "mail", "quit",
].map((command) => ({ command, enter: true }));

export interface Settings {
  /** Bumped when saved settings need migrating */
  version: number;
  preset: PresetName;
  /** The preset's keys with the player's changes. */
  keys: KeyMap;

  // ---- Preferences (IDD_SETTINGS, config.c defaults)
  haloColor: HaloColor;
  /** Show your pain when you get hurt (config.pain) */
  pain: boolean;
  drawPlayerNames: boolean;
  drawNpcNames: boolean;
  drawSignNames: boolean;
  /** Show amounts for inventory items (config.inventory_num) */
  inventoryNumbers: boolean;
  /** "Bounce" as you walk */
  bounce: boolean;
  /** Show targeting light effect (config.target_highlight) */
  targetLight: boolean;
  weather: boolean;
  /** Particle density %, 25..150 (CONFIG_MAX_PARTICLES) */
  particleDensity: number;
  music: boolean;
  /** 0..100 */
  musicVolume: number;
  sound: boolean;
  soundVolume: number;
  /** Steady sounds (play_loop_sounds) */
  loopSounds: boolean;
  /** Atmospheric sounds (play_random_sounds) */
  randomSounds: boolean;
  toolbar: boolean;
  tooltips: boolean;
  /** Lock text window in place when scrolling back */
  scrollLock: boolean;
  chatTimestamps: boolean;
  latencyMeter: boolean;
  /** Show dynamic map (config.drawmap): the minimap */
  dynamicMap: boolean;
  /** Show colored text (config.colorcodes) */
  coloredText: boolean;
  mapAnnotations: boolean;
  showFps: boolean;
  profanityFilter: boolean;
  /** Profanity Filter Settings (config.ignoreprofane): drop a message with profanity rather than obscure it */
  profanityIgnore: boolean;
  /** Logout timer (logoff.c, config.timeoutenabled): log off after this long idle */
  logoutTimer: boolean;
  /** config.language: the resource language strings are shown in (languages.ts; 0 English) */
  language: number;
  /** config.timeout: minutes idle before logging off */
  logoutMinutes: number;
  /** config.extraprofane: Extra search for suspected embedded profanity */
  profanityExtra: boolean;
  xpAsPercent: boolean;

  // ---- Configuration (the Bind Editor's Options and Mouse tab)
  /** Quick Chat: typing a letter starts a chat line (the original's A_TEXTINSERT keys) */
  typeToChat: boolean;
  /** Always Run: run unless the Run/Walk key is held */
  alwaysRun: boolean;
  /** Attack On Target: selecting a target attacks it */
  attackOnTarget: boolean;
  /** Dynamic Lighting: the light maps around torches and lamps */
  dynamicLighting: boolean;
  /** Damage Numbers (ours): the damage we deal floats up over what we hit */
  damageNumbers: boolean;
  /**
   * Touch Controls (ours, ADR 0003): the phone layout, with a joystick and buttons on the view.
   * Not in the Bind Editor any more (Auto is what everyone gets); set by hand for testing.
   * Auto: on a touch screen (a coarse pointer), as the Android app and phone browsers have
   */
  touchControls: TouchControls;
  /**
   * Original Command Typing: every typed line is a command, as in the original (commands.ts):
   * the start of a name will do, speech needs "say", anything else is "What?". Off, lines
   * are said unless they start with a command (or "/").
   */
  originalCommands: boolean;
  /** Ours: how fast a drag on the phone's view turns and looks, 1..30 (15 as it was) */
  touchLookScale: number;
  /** Mouselook X / Y scale, 1..30 (config.ini mouselookxscale / mouselookyscale) */
  mouseXScale: number;
  mouseYScale: number;
  invertMouse: boolean;

  // ---- Actions
  /** Players whose speech we don't show, lower case (msgfiltr.c ignore list) */
  ignored: string[];
  /** Ignore all broadcasts (config.no_broadcast) */
  ignoreBroadcasts: boolean;
  /** Ignore everyone (config.ignore_all) */
  ignoreEveryone: boolean;
  /** Player groups for group messages (groups.c): group name -> player names */
  groups: Record<string, string[]>;
  /** F1..F12 */
  hotkeyAliases: HotkeyAlias[];
  /** Command aliases: word -> full command ("laugh" -> "emote laughs") */
  commandAliases: Record<string, string>;

  /** Minimap zoom (map.c zoom: 0.5 .. 8) */
  mapZoom: number;
  /** The chat window: the tab shown, and its height in pixels (dragged by its top edge) */
  chatTab: ChatTab;
  chatHeight: number;
  /**
   * Ours: the desktop's layout. Classic is the original's (the view, the chat under it, the
   * interface column); Modern puts the view in the whole window with the HUD over it (ui/ModernHud.tsx).
   * The phone has its own (touchUi).
   */
  interfaceStyle: InterfaceStyle;
  /** The Modern layout's chat: its width in pixels, dragged by its right edge */
  chatWidth: number;
  /**
   * The Modern layout's character window: where its title was dragged to (left and top in the
   * view's pixels), or null for its place beside the map
   */
  characterWindowAt: [number, number] | null;
}

export type InterfaceStyle = "modern" | "classic";

/** The chat window's tabs: everything, or one channel (packages/world chatChannel.ts) */
export type ChatTab = "all" | "chat" | "combat" | "server";

export type TouchControls = "auto" | "on" | "off";

/** Whether the touch layout is on: Touch Controls, or on Auto a touch screen without a mouse. */
export function touchUi(s: Settings): boolean {
  if (s.touchControls !== "auto") return s.touchControls === "on";
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

const SETTINGS_VERSION = 6;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  preset: "modern",
  keys: PRESETS.modern,
  haloColor: "red",
  pain: true,
  drawPlayerNames: true,
  drawNpcNames: true,
  drawSignNames: true,
  inventoryNumbers: true,
  bounce: true,
  targetLight: true,
  weather: true,
  particleDensity: 100,
  music: true,
  musicVolume: 100,
  sound: true,
  soundVolume: 100,
  loopSounds: true,
  randomSounds: true,
  toolbar: true,
  tooltips: true,
  scrollLock: false,
  chatTimestamps: false,
  latencyMeter: true,
  dynamicMap: true,
  coloredText: true,
  mapAnnotations: true,
  showFps: false,
  profanityFilter: true,
  profanityIgnore: false,
  logoutTimer: false,
  language: 0,
  logoutMinutes: 1440,
  profanityExtra: false,
  xpAsPercent: false,
  typeToChat: false,
  alwaysRun: false,
  attackOnTarget: false,
  dynamicLighting: true,
  damageNumbers: true,
  touchControls: "auto",
  touchLookScale: 15,
  originalCommands: false,
  mouseXScale: 15,
  mouseYScale: 15,
  invertMouse: false,
  ignored: [],
  ignoreBroadcasts: false,
  ignoreEveryone: false,
  groups: {},
  hotkeyAliases: DEFAULT_HOTKEY_ALIASES,
  commandAliases: {},
  mapZoom: 1,
  chatTab: "all",
  chatHeight: 168,
  interfaceStyle: "modern",
  chatWidth: 340,
  characterWindowAt: null,
};

const STORAGE_KEY = "shards.settings";

/** Saved settings from older versions, with the fields they had then. */
type SavedSettings = Partial<Settings> & { mouseSpeed?: number; rightClickLooks?: boolean };

export function migrate(s: SavedSettings): Settings {
  const preset: PresetName = s.preset === "original" ? "original" : "modern";
  // Keep any actions added since the settings were saved.
  const keys = { ...PRESETS[preset], ...(s.keys ?? {}) } as KeyMap;
  const version = s.version ?? 1;
  // Version 2 (milestone 6): E attacks in the modern preset; it no longer opens doors
  if (version < 2 && preset === "modern") keys.go = keys.go.filter((b) => b.code !== "KeyE");
  const out: Settings = { ...DEFAULT_SETTINGS, ...s, version: SETTINGS_VERSION, preset, keys };
  if (version < 3) {
    // Version 3 (the Preferences and Configuration dialogs): one mouselook speed became
    // the X and Y scales, and "right click looks" became Examine on the right button
    const scale = Math.round(Math.max(1, Math.min(30, (s.mouseSpeed ?? 1) * 15)));
    out.mouseXScale = out.mouseYScale = scale;
    if (s.rightClickLooks && !keys.examine.some((b) => b.code === "Mouse1")) keys.examine = [...keys.examine, { code: "Mouse1" }];
  }
  if (version < 4 && preset === "modern") {
    // Version 4 (the description dialog): the right button examines in the modern preset too,
    // instead of opening our old actions menu, unless it was bound to something else
    const used = Object.values(keys).some((list) => list.some((b) => b.code === "Mouse1"));
    if (!used) keys.examine = [...keys.examine, { code: "Mouse1" }];
  }
  // Version 5: Touch Controls left the Bind Editor, so nothing could undo an On or Off saved before
  if (version < 5) out.touchControls = "auto";
  // Version 6 (the Modern interface): new players get it, players who had settings keep the layout they knew
  if (version < 6) out.interfaceStyle = "classic";
  delete (out as SavedSettings).mouseSpeed;
  delete (out as SavedSettings).rightClickLooks;
  if (!Array.isArray(out.hotkeyAliases) || out.hotkeyAliases.length !== 12) out.hotkeyAliases = DEFAULT_HOTKEY_ALIASES;
  return out;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw) as SavedSettings) : DEFAULT_SETTINGS;
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

/** The bindings and the input options that go with a preset (the original also starts chat by typing). */
export function presetSettings(preset: PresetName): Pick<Settings, "preset" | "keys" | "typeToChat" | "originalCommands"> {
  return { preset, keys: PRESETS[preset], typeToChat: preset === "original", originalCommands: preset === "original" };
}

/** Modifier keys held with a key press. */
export interface Mods {
  alt: boolean;
  ctrl: boolean;
}

const sameMods = (b: KeyBinding, m: Mods) => !!b.alt === m.alt && !!b.ctrl === m.ctrl;
const NO_MODS: Mods = { alt: false, ctrl: false };

/**
 * Actions bound to a key or mouse button. A binding with a modifier needs it held; when
 * a modifier is held, a key that has a binding with exactly those modifiers only triggers
 * those (Alt+Left slides, Left turns); otherwise its plain bindings still work.
 */
export function actionsFor(keys: KeyMap, code: string, mods: Mods | boolean): Action[] {
  const m: Mods = typeof mods === "boolean" ? { alt: mods, ctrl: false } : mods;
  const modBound = (m.alt || m.ctrl) && ACTIONS.some((a) => keys[a].some((b) => b.code === code && sameMods(b, m)));
  const want = modBound ? m : NO_MODS;
  return ACTIONS.filter((a) => keys[a].some((b) => b.code === code && sameMods(b, want)));
}

/** Whether a held action is active given the keys down now. */
export function isHeld(keys: KeyMap, action: Action, down: ReadonlySet<string>, mods: Mods | boolean): boolean {
  for (const code of down) if (actionsFor(keys, code, mods).includes(action)) return true;
  return false;
}

/** "Alt+ArrowLeft" -> "Alt+←" for the configuration screen. */
export function bindingLabel(b: KeyBinding): string {
  const names: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Quote: "'", Semicolon: ";",
    Equal: "=", Minus: "-", BracketLeft: "[", BracketRight: "]", Backslash: "\\", ControlLeft: "Ctrl", ControlRight: "Right Ctrl",
    NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadEnter: "Num Enter", ShiftLeft: "Shift", ShiftRight: "Right Shift",
    Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down", Mouse0: "Left click", Mouse1: "Right click", Mouse2: "Middle click",
    Mouse3: "Mouse 4", Mouse4: "Mouse 5",
  };
  const name = names[b.code] ?? b.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return (b.ctrl ? "Ctrl+" : "") + (b.alt ? "Alt+" : "") + name;
}

/** config.ini numbers mouse buttons left 0, right 1, middle 2; MouseEvent.button is left 0, middle 1, right 2. */
export function mouseCode(button: number): string {
  return `Mouse${button === 2 ? 1 : button === 1 ? 2 : button}`;
}

