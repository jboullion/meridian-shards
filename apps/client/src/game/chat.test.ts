import { describe, expect, test } from "vitest";
import { SAY } from "@shards/protocol";
import { parseActionCommand, parseChatCommand } from "./GameView.tsx";
import { PRESETS, actionsFor, isHeld } from "./settings.ts";

describe("chat commands", () => {
  test("plain text says; verbs and : pick the kind", () => {
    expect(parseChatCommand("hello")).toEqual({ kind: SAY.NORMAL, text: "hello" });
    expect(parseChatCommand("yell help!")).toEqual({ kind: SAY.YELL, text: "help!" });
    expect(parseChatCommand("/emote waves")).toEqual({ kind: SAY.EMOTE, text: "waves" });
    expect(parseChatCommand(":bows")).toEqual({ kind: SAY.EMOTE, text: "bows" });
    expect(parseChatCommand("broadcast hi all")).toEqual({ kind: SAY.EVERYONE, text: "hi all" });
    expect(parseChatCommand("   ")).toBeNull();
  });

  test("bank commands: with an amount it's money, without it opens the vault", () => {
    expect(parseActionCommand("deposit 100")).toEqual({ action: "deposit", amount: 100 });
    expect(parseActionCommand("/withdraw")).toEqual({ action: "withdraw", amount: 0 });
    expect(parseActionCommand("balance")).toEqual({ action: "balance", amount: 0 });
    expect(parseActionCommand("deposit my sword please")).toBeNull();
    expect(parseActionCommand("say rest")).toBeNull();
  });
});

describe("key bindings", () => {
  test("original preset: Alt+arrow slides, a plain arrow turns (merintr.c interface_key_table)", () => {
    const k = PRESETS.original;
    expect(actionsFor(k, "ArrowLeft", false)).toEqual(["turnLeft"]);
    expect(actionsFor(k, "ArrowLeft", true)).toEqual(["strafeLeft"]);
    // Alt held but the key has no Alt binding: it still works (Alt+Up walks forward)
    expect(actionsFor(k, "ArrowUp", true)).toEqual(["forward"]);
    expect(isHeld(k, "turnLeft", new Set(["ArrowLeft"]), true)).toBe(false);
    expect(isHeld(k, "strafeLeft", new Set(["ArrowLeft"]), true)).toBe(true);
  });

  test("modern preset: WASD and the arrows", () => {
    const k = PRESETS.modern;
    expect(actionsFor(k, "KeyW", false)).toEqual(["forward"]);
    expect(actionsFor(k, "KeyA", false)).toEqual(["strafeLeft"]);
    expect(actionsFor(k, "Space", false)).toEqual(["go"]);
    expect(isHeld(k, "forward", new Set(["ArrowUp", "KeyD"]), false)).toBe(true);
  });
});

describe("character creator", () => {
  test("names: trimmed, 3 to 30 legal characters (charname.c VerifyCharName)", async () => {
    const { verifyCharName } = await import("./CharacterCreator.tsx");
    expect(verifyCharName("  Shardmage ")).toBe("Shardmage");
    expect(verifyCharName("Al")).toBeNull();
    expect(verifyCharName("Bad#Name")).toBeNull();
    expect(verifyCharName("Sir [Lance] O'Lot!")).toBe("Sir [Lance] O'Lot!");
    expect(verifyCharName("x".repeat(31))).toBeNull();
  });

  test("combat keys: E attacks in the modern preset, Ctrl in the original", () => {
    expect(actionsFor(PRESETS.modern, "KeyE", false)).toEqual(["attack"]);
    expect(actionsFor(PRESETS.original, "ControlLeft", false)).toEqual(["attack"]);
    expect(actionsFor(PRESETS.original, "BracketRight", false)).toEqual(["targetNext"]);
  });
});
