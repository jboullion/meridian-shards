import { describe, expect, it } from "vitest";
import { SAY } from "@shards/protocol";
import type { ChatLine } from "@shards/world";
import { ignoredLine } from "./Game.tsx";
import { parseTell } from "./GameView.tsx";
import { ACTIONS, ACTION_TABS, PRESETS, actionsFor, expandCommandAlias, migrate, mouseCode, updateSettings, DEFAULT_SETTINGS } from "./settings.ts";

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
    expect(s.version).toBe(4);
    expect(s.mouseXScale).toBe(30);
    expect(s.mouseYScale).toBe(30);
    expect(s.keys.examine).toEqual([{ code: "Mouse1" }]);
    expect(s.musicVolume).toBe(40);
    expect(s.haloColor).toBe("red");
    expect("mouseSpeed" in s).toBe(false);
    expect("rightClickLooks" in s).toBe(false);
  });

  it("migrates version 3 settings: the right button examines, unless it does something else", () => {
    const v3 = { version: 3, preset: "modern" as const, keys: { ...PRESETS.modern, examine: [] } };
    expect(migrate(v3).keys.examine).toEqual([{ code: "Mouse1" }]);
    const taken = migrate({ ...v3, keys: { ...v3.keys, attack: [{ code: "Mouse1" }] } });
    expect(taken.keys.examine).toEqual([]);
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

  it("expands a command alias's first word", () => {
    const aliases = { laugh: "emote laughs", hi: "say hello" };
    expect(expandCommandAlias(aliases, "laugh")).toBe("emote laughs");
    expect(expandCommandAlias(aliases, "hi there")).toBe("say hello there");
    expect(expandCommandAlias(aliases, "Laugh")).toBe("emote laughs");
    expect(expandCommandAlias(aliases, "hello")).toBe("hello");
  });
});

describe("tell", () => {
  const players = [
    { id: 1, name: "Shardbot" },
    { id: 2, name: "Shardkit" },
    { id: 3, name: "Old Tom" },
  ];
  it("finds the player by whole name, quoted name or unique prefix", () => {
    expect(parseTell("tell Shardbot hello there", players)).toEqual({ id: 1, name: "Shardbot", text: "hello there" });
    expect(parseTell("tell old tom hi", players)).toEqual({ id: 3, name: "Old Tom", text: "hi" });
    expect(parseTell('tell "Old Tom" hi', players)).toEqual({ id: 3, name: "Old Tom", text: "hi" });
    expect(parseTell("t shardk yo", players)).toEqual({ id: 2, name: "Shardkit", text: "yo" });
  });
  it("explains what went wrong", () => {
    expect(parseTell("tell shard hi", players)).toHaveProperty("error");
    expect(parseTell("tell nobody hi", players)).toHaveProperty("error");
    expect(parseTell("tell Shardbot", players)).toHaveProperty("error");
    expect(parseTell("hello", players)).toBeNull();
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
