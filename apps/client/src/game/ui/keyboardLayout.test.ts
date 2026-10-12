import { describe, expect, it } from "vitest";
import { DEFAULT_HOTKEY_ALIASES, PRESETS } from "../settings.ts";
import { MAIN_ROWS, NAV_ROWS, keyUses, numpadNeeded } from "./keyboardLayout.ts";

describe("the Help window's keyboard", () => {
  const uses = keyUses(PRESETS.modern, DEFAULT_HOTKEY_ALIASES);

  it("shows each key's actions, Alt bindings after the plain ones", () => {
    expect(uses.get("KeyW")?.map((u) => u.label)).toEqual(["Forward"]);
    expect(uses.get("ArrowLeft")?.map((u) => [u.mods, u.label])).toEqual([
      ["", "Turn Left"],
      ["Alt", "Slide Left"],
    ]);
    expect(uses.get("Digit1")?.[0].short).toBe("Slot 1");
  });

  it("puts the hotkey aliases on the F keys nothing else uses", () => {
    expect(uses.get("F1")?.[0]).toMatchObject({ group: "alias", short: "help" });
    // F10 opens Preferences in the modern preset, so its alias never runs
    expect(uses.get("F10")?.map((u) => u.label)).toEqual(["Preferences"]);
  });

  it("draws the numpad only when it does something no other key does", () => {
    expect(numpadNeeded(keyUses(PRESETS.modern, DEFAULT_HOTKEY_ALIASES, false))).toBe(false);
    expect(numpadNeeded(uses)).toBe(true);
  });

  it("lays every bound key of the modern preset out somewhere", () => {
    const drawn = new Set([...MAIN_ROWS, ...NAV_ROWS].flat().flatMap((k) => ("code" in k ? [k.code] : [])));
    const missing = [...uses.keys()].filter((c) => !drawn.has(c) && !c.startsWith("Numpad") && !c.startsWith("Mouse"));
    expect(missing).toEqual([]);
  });
});
