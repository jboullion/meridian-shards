import { describe, expect, test } from "vitest";
import type { ObjectInfo } from "@shards/protocol";
import type { ChatLine } from "@shards/world";
import { reduceOffer } from "./ui/Dialogs.tsx";
import { appendChatLine } from "./GameView.tsx";
import { interpretLine } from "./commands.ts";
import { PRESETS, actionsFor, isHeld } from "./settings.ts";

describe("chat commands", () => {
  test("plain text says; verbs and : pick the kind", () => {
    expect(interpretLine("hello", {}, false)).toEqual({ kind: "say", text: "hello" });
    expect(interpretLine("yell help!", {}, false)).toEqual({ kind: "command", id: "yell", args: "help!" });
    expect(interpretLine("/emote waves", {}, false)).toEqual({ kind: "command", id: "emote", args: "waves" });
    expect(interpretLine(":bows", {}, false)).toEqual({ kind: "command", id: "emote", args: "bows" });
    expect(interpretLine("broadcast hi all", {}, false)).toEqual({ kind: "command", id: "broadcast", args: "hi all" });
    expect(interpretLine("   ", {}, false)).toBeNull();
  });

  test("bank commands take an amount, or open the vault without one", () => {
    expect(interpretLine("deposit 100", {}, false)).toEqual({ kind: "command", id: "deposit", args: "100" });
    expect(interpretLine("/withdraw", {}, false)).toEqual({ kind: "command", id: "withdraw", args: "" });
    expect(interpretLine("balance", {}, false)).toEqual({ kind: "command", id: "balance", args: "" });
    expect(interpretLine("balance my books", {}, false)).toEqual({ kind: "say", text: "balance my books" });
    expect(interpretLine("say rest", {}, false)).toEqual({ kind: "command", id: "say", args: "rest" });
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

describe("chat tabs keep their own history", () => {
  const line = (channel: ChatLine["channel"], time: number): ChatLine => ({ kind: "system", channel, spans: [], time });
  test("a full channel drops its own oldest line, not another channel's", () => {
    let lines: ChatLine[] = [line("chat", 1), line("combat", 2), line("combat", 3)];
    lines = appendChatLine(lines, line("combat", 4), 2);
    expect(lines.map((l) => l.time)).toEqual([1, 3, 4]);
    lines = appendChatLine(lines, line("chat", 5), 2);
    expect(lines.map((l) => l.time)).toEqual([1, 3, 4, 5]);
  });
});

describe("offers (offer.c)", () => {
  const item = (id: number) => ({ id }) as unknown as ObjectInfo;
  test("someone offers us items; our counteroffer shows once the server echoes it", () => {
    let s = reduceOffer(null, { type: "received", offerer: item(5), items: [item(1)] });
    expect(s).toEqual({ mine: [], theirs: [item(1)], from: item(5) });
    s = reduceOffer(s, { type: "counteroffered", items: [item(2)] });
    expect(s?.mine).toEqual([item(2)]);
    expect(reduceOffer(s, { type: "canceled" })).toBeNull();
  });
  test("a counteroffered echo without a Receive Offer dialog is dropped", () => {
    expect(reduceOffer(null, { type: "counteroffered", items: [item(2)] })).toBeNull();
    const ours = reduceOffer(null, { type: "offered", items: [item(3)] });
    expect(reduceOffer(ours, { type: "counteroffered", items: [item(2)] })).toBe(ours);
  });
});
