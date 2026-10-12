// Ours: the Help window's keyboard (HelpDialog.tsx Controls): a US layout by KeyboardEvent.code,
// and what each key does with the player's bindings (settings.ts keys) and hotkey aliases.

import { ACTION_LABELS, ACTION_TABS, type Action, type ActionTab, type HotkeyAlias, type KeyMap } from "../settings.ts";

/** A key: its code, the cap's text, and its width in key units (1 = a letter key) */
export interface KeyCap {
  code: string;
  cap: string;
  w?: number;
}
/** A gap in a row, key units */
export interface KeyGap {
  gap: number;
}
export type KeyRow = (KeyCap | KeyGap)[];

const letters = (s: string): KeyCap[] => [...s].map((c) => ({ code: `Key${c}`, cap: c }));
const digits = (s: string): KeyCap[] => [...s].map((c) => ({ code: `Digit${c}`, cap: c }));
const fkeys = (from: number, to: number): KeyCap[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ code: `F${from + i}`, cap: `F${from + i}` }));

/** The main block, 15 units wide */
export const MAIN_ROWS: KeyRow[] = [
  [{ code: "Escape", cap: "Esc" }, { gap: 1 }, ...fkeys(1, 4), { gap: 0.5 }, ...fkeys(5, 8), { gap: 0.5 }, ...fkeys(9, 12)],
  [{ code: "Backquote", cap: "`" }, ...digits("1234567890"), { code: "Minus", cap: "-" }, { code: "Equal", cap: "=" }, { code: "Backspace", cap: "Backspace", w: 2 }],
  [{ code: "Tab", cap: "Tab", w: 1.5 }, ...letters("QWERTYUIOP"), { code: "BracketLeft", cap: "[" }, { code: "BracketRight", cap: "]" }, { code: "Backslash", cap: "\\", w: 1.5 }],
  [{ code: "CapsLock", cap: "Caps", w: 1.75 }, ...letters("ASDFGHJKL"), { code: "Semicolon", cap: ";" }, { code: "Quote", cap: "'" }, { code: "Enter", cap: "Enter", w: 2.25 }],
  [{ code: "ShiftLeft", cap: "Shift", w: 2.25 }, ...letters("ZXCVBNM"), { code: "Comma", cap: "," }, { code: "Period", cap: "." }, { code: "Slash", cap: "/" }, { code: "ShiftRight", cap: "Shift", w: 2.75 }],
  [
    { code: "ControlLeft", cap: "Ctrl", w: 1.5 }, { code: "MetaLeft", cap: "Win", w: 1.25 }, { code: "AltLeft", cap: "Alt", w: 1.25 },
    { code: "Space", cap: "Space", w: 6.25 },
    { code: "AltRight", cap: "Alt", w: 1.25 }, { code: "ContextMenu", cap: "Menu", w: 1.25 }, { code: "ControlRight", cap: "Ctrl", w: 2.25 },
  ],
];

/** The block between the main keys and the numpad, 3 units wide, rows as MAIN_ROWS */
export const NAV_ROWS: KeyRow[] = [
  [{ code: "PrintScreen", cap: "PrtSc" }, { code: "ScrollLock", cap: "ScrLk" }, { code: "Pause", cap: "Pause" }],
  [{ code: "Insert", cap: "Ins" }, { code: "Home", cap: "Home" }, { code: "PageUp", cap: "PgUp" }],
  [{ code: "Delete", cap: "Del" }, { code: "End", cap: "End" }, { code: "PageDown", cap: "PgDn" }],
  [],
  [{ gap: 1 }, { code: "ArrowUp", cap: "↑" }],
  [{ code: "ArrowLeft", cap: "←" }, { code: "ArrowDown", cap: "↓" }, { code: "ArrowRight", cap: "→" }],
];

/** The numpad, 4 units wide; Enter and + are drawn one key tall (ours: simpler than the real shape) */
export const NUMPAD_ROWS: KeyRow[] = [
  [],
  [{ code: "NumLock", cap: "Num" }, { code: "NumpadDivide", cap: "/" }, { code: "NumpadMultiply", cap: "*" }, { code: "NumpadSubtract", cap: "-" }],
  [{ code: "Numpad7", cap: "7" }, { code: "Numpad8", cap: "8" }, { code: "Numpad9", cap: "9" }, { code: "NumpadAdd", cap: "+" }],
  [{ code: "Numpad4", cap: "4" }, { code: "Numpad5", cap: "5" }, { code: "Numpad6", cap: "6" }, { code: "NumpadEnter", cap: "Enter" }],
  [{ code: "Numpad1", cap: "1" }, { code: "Numpad2", cap: "2" }, { code: "Numpad3", cap: "3" }],
  [{ code: "Numpad0", cap: "0", w: 2 }, { code: "NumpadDecimal", cap: "." }],
];

/** What a key does: an action (with Alt or Ctrl, if it needs one), or a hotkey alias's command */
export interface KeyUse {
  label: string;
  /** As short as fits on a key cap */
  short: string;
  /** The Bind Editor tab it's on, for its colour; "alias" for a hotkey alias */
  group: ActionTab | "alias";
  /** "Alt" or "Ctrl" (or "Ctrl+Alt") when the binding needs it */
  mods: string;
}

/** Names short enough for a key cap (the full ones show on hover); \u00ad is a soft hyphen, where a long word may break */
const SHORT: Partial<Record<Action, string>> = {
  backward: "Back", turnLeft: "Turn left", turnRight: "Turn right", strafeLeft: "Slide left", strafeRight: "Slide right", run: "Run", lookStraight: "Look level",
  flip: "Turn round", broadcast: "Broad\u00adcast", interact: "Pick up", targetNext: "Next target", targetPrevious: "Last target", targetClear: "Clear target",
  targetSelf: "Target me", tabForward: "Tab next", tabBackward: "Tab back", selectTarget: "Target", mapZoomIn: "Map +", mapZoomOut: "Map −",
  settings: "Prefs", configuration: "Config", cameraView: "Camera", hideInterface: "Hide HUD", quickEmotes: "Emotes", inventory: "Inven\u00adtory", deposit: "Deposit", withdraw: "Withdraw",
};
const shortLabel = (a: Action) => SHORT[a] ?? (a.startsWith("quickSlot") ? `Slot ${a.slice(9)}` : ACTION_LABELS[a]);

const GROUP_OF = new Map<Action, ActionTab>(
  (Object.entries(ACTION_TABS) as [ActionTab, readonly Action[]][]).flatMap(([tab, list]) => list.map((a) => [a, tab] as const)),
);

/**
 * Whether the numpad is worth drawing: a key on it does something no key elsewhere does (the
 * second row of quick slots), not only the same as another key (Num + as =)
 */
export function numpadNeeded(uses: Map<string, KeyUse[]>): boolean {
  const elsewhere = new Set<string>();
  for (const [code, list] of uses) if (!code.startsWith("Numpad")) for (const u of list) elsewhere.add(u.label);
  for (const [code, list] of uses) if (code.startsWith("Numpad") && list.some((u) => !elsewhere.has(u.label))) return true;
  return false;
}

/** Every key's uses, by code (mouse buttons too, as Mouse0..Mouse4) */
export function keyUses(keys: KeyMap, aliases: readonly HotkeyAlias[], second = true): Map<string, KeyUse[]> {
  const out = new Map<string, KeyUse[]>();
  const add = (code: string, use: KeyUse) => {
    const list = out.get(code) ?? [];
    if (!list.some((u) => u.label === use.label && u.mods === use.mods)) list.push(use);
    out.set(code, list);
  };
  for (const [action, tab] of GROUP_OF) {
    // The second row of quick slots works only with Second Hotbar on
    if (!second && /^quickSlot(1[1-9]|20)$/.test(action)) continue;
    for (const b of keys[action] ?? []) {
      const mods = [b.ctrl ? "Ctrl" : "", b.alt ? "Alt" : ""].filter(Boolean).join("+");
      add(b.code, { label: ACTION_LABELS[action], short: shortLabel(action), group: tab, mods });
    }
  }
  // GameView: an F key with no binding of its own sends its hotkey alias (alias.c)
  aliases.forEach((a, i) => {
    const code = `F${i + 1}`;
    if (a.command && !out.get(code)?.some((u) => !u.mods)) add(code, { label: a.enter ? `The command "${a.command}"` : `Types "${a.command}" in the chat line`, short: a.command, group: "alias", mods: "" });
  });
  for (const list of out.values()) list.sort((a, b) => (a.mods ? 1 : 0) - (b.mods ? 1 : 0));
  return out;
}
