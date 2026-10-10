import { describe, expect, it } from "vitest";
import { SAY } from "@shards/protocol";
import type { ChatLine } from "@shards/world";
import { ignoredLine } from "./Game.tsx";
import { interpretLine, resolveTell } from "./commands.ts";
import { ACTIONS, ACTION_TABS, PRESETS, actionsFor, migrate, mouseCode, updateSettings, DEFAULT_SETTINGS } from "./settings.ts";

describe("settings", () => {
  it("binds every action in both presets, each in one Bind Editor tab", () => {
    const tabbed = Object.values(ACTION_TABS).flat();
    expect(new Set(tabbed).size).toBe(tabbed.length);
    for (const a of ACTIONS) {
      expect(PRESETS.modern[a]).toBeDefined();
      expect(PRESETS.original[a]).toBeDefined();
    }
  });

  it("migrates version 2 settings: one mouse speed, right click looks", () => {
    const s = migrate({ version: 2, preset: "modern", mouseSpeed: 2, rightClickLooks: true, musicVolume: 40 } as never);
    expect(s.version).toBe(8);
    expect(s.mouseXScale).toBe(30);
    expect(s.mouseYScale).toBe(30);
    expect(s.keys.examine).toEqual([{ code: "Mouse1" }]);
    expect(s.musicVolume).toBe(40);
    expect(s.haloColor).toBe("red");
    expect("mouseSpeed" in s).toBe(false);
    expect("rightClickLooks" in s).toBe(false);
  });

  it("Enhanced Lighting on by default; the test builds' graphics options are dropped", () => {
    const s = migrate({ version: 7, preset: "modern", graphics: "classic", surfaceRelief: false, mipMaps: true } as never);
    expect("mipMaps" in s).toBe(false);
    expect("smoothTextures" in s).toBe(false);
    expect(s.enhanced).toBe(true);
    expect("graphics" in s).toBe(false);
    expect("surfaceRelief" in s).toBe(false);
    expect(migrate({ version: 7, preset: "modern", enhanced: false }).enhanced).toBe(false);
  });

  it("migrates version 7 settings: everyone on the Modern interface once, and a later Classic kept", () => {
    expect(migrate({ version: 7, preset: "modern", interfaceStyle: "classic" }).interfaceStyle).toBe("modern");
    expect(migrate({ version: 8, preset: "modern", interfaceStyle: "classic" }).interfaceStyle).toBe("classic");
  });

  it("migrates version 3 settings: the right button examines, unless it does something else", () => {
    const v3 = { version: 3, preset: "modern" as const, keys: { ...PRESETS.modern, examine: [] } };
    expect(migrate(v3).keys.examine).toEqual([{ code: "Mouse1" }]);
    const taken = migrate({ ...v3, keys: { ...v3.keys, attack: [{ code: "Mouse1" }] } });
    expect(taken.keys.examine).toEqual([]);
  });

  it("migrates version 4 settings: Touch Controls back to Auto, a look speed added", () => {
    const s = migrate({ version: 4, preset: "modern", touchControls: "off", dynamicLighting: false });
    expect(s.touchControls).toBe("auto");
    expect(s.touchLookScale).toBe(15);
    expect(s.dynamicLighting).toBe(false);
    expect(migrate({ version: 5, touchControls: "on" }).touchControls).toBe("on");
  });

  it("adds the numpad's digits to the quick slots in the modern preset, unless they're bound already", () => {
    const keys = { ...PRESETS.modern, quickSlot1: [{ code: "Digit1" }], quickSlot2: [{ code: "Digit2" }], lookUp: [{ code: "Numpad2" }] };
    const s = migrate({ version: 6, preset: "modern", keys });
    expect(s.keys.quickSlot1.map((b) => b.code)).toEqual(["Digit1", "Numpad1"]);
    expect(s.keys.quickSlot2.map((b) => b.code)).toEqual(["Digit2"]);
    expect(migrate({ version: 6, preset: "original" }).keys.quickSlot1).toEqual([]);
    expect(PRESETS.modern.quickSlot10.map((b) => b.code)).toEqual(["Digit0", "Numpad0"]);
  });

  it("gives new players the Modern interface, and everyone else too as of version 8", () => {
    expect(DEFAULT_SETTINGS.interfaceStyle).toBe("modern");
    expect(migrate({ version: 5 }).interfaceStyle).toBe("modern");
    expect(migrate({ version: 6, interfaceStyle: "classic" }).interfaceStyle).toBe("modern");
    expect(migrate({ version: 8, interfaceStyle: "classic" }).interfaceStyle).toBe("classic");
  });

  it("matches modifiers exactly, with plain keys still working under an unbound modifier", () => {
    const keys = { ...PRESETS.modern, who: [{ code: "KeyW", ctrl: true }] };
    expect(actionsFor(keys, "KeyW", { alt: false, ctrl: true })).toEqual(["who"]);
    expect(actionsFor(keys, "KeyW", { alt: false, ctrl: false })).toContain("forward");
    // Ctrl+S isn't bound: S still walks back while Ctrl is held
    expect(actionsFor(keys, "KeyS", { alt: false, ctrl: true })).toContain("backward");
    expect(actionsFor(PRESETS.modern, "ArrowLeft", { alt: true, ctrl: false })).toEqual(["strafeLeft"]);
  });

  it("numbers mouse buttons the way config.ini does", () => {
    expect(mouseCode(0)).toBe("Mouse0");
    expect(mouseCode(2)).toBe("Mouse1");
    expect(mouseCode(1)).toBe("Mouse2");
    expect(actionsFor(PRESETS.modern, "Mouse0", false)).toEqual(["selectTarget"]);
    expect(actionsFor(PRESETS.original, "Mouse1", false)).toEqual(["examine"]);
  });

  it("expands a command alias by its whole verb (alias.c ParseVerbAlias)", () => {
    const aliases = { laugh: "emote laughs", hi: "say hello ~~" };
    expect(interpretLine("laugh", aliases, false)).toEqual({ kind: "alias", line: "emote laughs" });
    expect(interpretLine("hi there", aliases, false)).toEqual({ kind: "alias", line: "say hello there" });
    expect(interpretLine("Laugh", aliases, false)).toEqual({ kind: "alias", line: "emote laughs" });
    expect(interpretLine("hello", aliases, false)).toEqual({ kind: "say", text: "hello" });
  });
});

describe("tell", () => {
  const players = [
    { id: 1, name: "Shardbot" },
    { id: 2, name: "Shardkit" },
    { id: 3, name: "Old Tom" },
  ];
  it("finds the player by whole name, quoted name or unique prefix", () => {
    expect(resolveTell("Shardbot hello there", players, {})).toEqual({ ids: [1], text: "hello there" });
    expect(resolveTell("old tom hi", players, {})).toEqual({ ids: [3], text: "hi" });
    expect(resolveTell('"Old Tom" hi', players, {})).toEqual({ ids: [3], text: "hi" });
    expect(resolveTell("shardk yo", players, {})).toEqual({ ids: [2], text: "yo" });
  });
  it("explains what went wrong", () => {
    expect(resolveTell("shard hi", players, {})).toHaveProperty("error");
    expect(resolveTell("nobody hi", players, {})).toHaveProperty("error");
    expect(resolveTell("Shardbot", players, {})).toBeNull();
  });
});

describe("ignoring players", () => {
  const line = (name: string, sayType: number = SAY.NORMAL): ChatLine => ({ kind: "say", channel: "chat", spans: [], time: 0, sender: { id: 9, name }, sayType });
  it("hides ignored players, broadcasts or everyone, never our own lines or system text", () => {
    updateSettings({ ...DEFAULT_SETTINGS, ignored: ["pest"] });
    expect(ignoredLine(line("Pest"), "Me")).toBe(true);
    expect(ignoredLine(line("Friend"), "Me")).toBe(false);
    updateSettings({ ignoreBroadcasts: true });
    expect(ignoredLine(line("Friend", SAY.EVERYONE), "Me")).toBe(true);
    updateSettings({ ignoreEveryone: true });
    expect(ignoredLine(line("Friend"), "Me")).toBe(true);
    expect(ignoredLine(line("Me"), "Me")).toBe(false);
    expect(ignoredLine({ kind: "system", channel: "server", spans: [], time: 0 }, "Me")).toBe(false);
    updateSettings(DEFAULT_SETTINGS);
  });
});
