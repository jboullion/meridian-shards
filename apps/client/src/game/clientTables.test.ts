// The client's tables (apps/client/tables): loaded from the game's files as App loads them, and
// checked for what TypeScript can't see in JSON (commands this client has, categories that exist).

import { afterEach, describe, expect, test, vi } from "vitest";
import { AssetStore } from "../assets.ts";
import { SOURCE_TABLES } from "./testTables.ts";
import { applyClientTables, helpTable, loadClientTables, type HelpLayout } from "./clientTables.ts";
import { achievementCategories, achievementInfo, achievementList } from "./achievements.ts";
import { chatEmoji } from "./emoji.ts";
import { interpretLine, parseCommand } from "./commands.ts";

const LAYOUTS: HelpLayout[] = ["modern", "classic", "touch"];

afterEach(() => {
  vi.unstubAllGlobals();
  applyClientTables(SOURCE_TABLES);
});

describe("the client's tables", () => {
  test("load from the asset build's manifest, before anything uses them", async () => {
    const files: Record<string, unknown> = {};
    for (const [key, table] of Object.entries(SOURCE_TABLES)) files[`${key}.json`] = table;
    const manifest = { generated: "1", rsbHash: "r", files: Object.fromEntries(Object.keys(files).map((f) => [f, { size: 1, hash: "h" }])) };
    vi.stubGlobal("fetch", async (url: string) => {
      const name = url.replace(/^\/assets\//, "").replace(/\?.*$/, "");
      return new Response(JSON.stringify(name === "manifest.json" ? manifest : files[name]));
    });
    applyClientTables({ achievements: { categories: [], achievements: [] }, emoji: { groups: [] }, commands: { commands: [], shorthands: {}, takesWords: [] }, help: { touch: [], hud: { view: { title: "", text: "" }, parts: [] }, interface: [] } });
    expect(parseCommand("who")).toBeNull();
    const assets = new AssetStore("/assets/");
    await assets.init();
    await loadClientTables(assets);
    expect(parseCommand("wer")).toEqual({ id: "who", args: "" });
    expect(interpretLine("em waves", {}, false)).toEqual({ kind: "command", id: "emote", args: "waves" });
    expect(achievementInfo(82)?.name).toBe("Legend of the Realm");
    expect(chatEmoji()[0]).toBe("🙂");
    expect(helpTable().touch[0].term).toBe("Joystick (bottom left)");
  });

  test("an asset build without them leaves them as they were (empty on a new page), and says so", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ generated: "1", rsbHash: "r", files: {} })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const assets = new AssetStore("/assets/");
    await assets.init();
    applyClientTables({ ...SOURCE_TABLES, emoji: { groups: [] } });
    await loadClientTables(assets);
    expect(chatEmoji()).toEqual([]);
    expect(achievementList().length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith("No emoji.json in the game's files: run npm run assets");
    warn.mockRestore();
  });

  test("achievements: unique ids, each in a category the window has", () => {
    const ids = achievementList().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of achievementList()) expect(achievementCategories(), a.name).toContain(a.category);
  });

  test("emoji: none twice", () => {
    expect(new Set(chatEmoji()).size).toBe(chatEmoji().length);
  });

  test("commands: only commands this client has", () => {
    const bad = { ...SOURCE_TABLES.commands, commands: [...SOURCE_TABLES.commands.commands, ["fly", "fly"]] } as unknown as typeof SOURCE_TABLES.commands;
    expect(() => applyClientTables({ ...SOURCE_TABLES, commands: bad })).toThrow(/no such command: fly/);
  });

  test("help: every interface has the section notes, and items name real interfaces", () => {
    for (const s of helpTable().interface) {
      if (s.note) expect(Object.keys(s.note).sort()).toEqual([...LAYOUTS].sort());
      for (const i of s.items) for (const l of i.layouts ?? []) expect(LAYOUTS).toContain(l);
    }
    expect(helpTable().hud.parts.every((p) => p.sel.length > 0)).toBe(true);
  });
});
