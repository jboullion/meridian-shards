import { describe, expect, test } from "vitest";
import {
  defineAlias, filterSayMessage, findSpell, groupAdd, groupDelete, groupNew, interpretLine, matchAlias, parseCommand, resolveTell, splitNames,
} from "./commands.ts";

describe("parse.c ParseCommand", () => {
  test("whole names, unique starts, and the first in the table on a tie", () => {
    expect(parseCommand("say hello there")).toEqual({ id: "say", args: "hello there" });
    expect(parseCommand("b hi all")).toEqual({ id: "broadcast", args: "hi all" });
    expect(parseCommand("s hi")).toEqual({ id: "say", args: "hi" }); // say comes before suicide
    expect(parseCommand("tel bob hi")?.id).toBe("tell");
    expect(parseCommand("HAPPY")).toEqual({ id: "happy", args: "" });
    expect(parseCommand("wer")?.id).toBe("who");
  });

  test("a longer word doesn't match a shorter name, and no match is null", () => {
    expect(parseCommand("hello")).toBeNull(); // not "hel"
    expect(parseCommand("xyzzy")).toBeNull();
    expect(parseCommand("suicide")?.id).toBe("suicide");
    expect(parseCommand("suicid")?.id).toBe("suicid");
  });

  test("two-word names (the arguments start after the first word)", () => {
    expect(parseCommand("safety off")).toEqual({ id: "safetyOff", args: "off" });
    expect(parseCommand("autoloot on")?.id).toBe("autolootOn");
    expect(parseCommand("safety")?.id).toBe("safetyOn"); // the first "safety ..." in the table
  });
});

describe("what a typed line means", () => {
  const none = {};
  test("our default: speech unless the first word is a command", () => {
    expect(interpretLine("hello there", none, false)).toEqual({ kind: "say", text: "hello there" });
    expect(interpretLine("a nice day", none, false)).toEqual({ kind: "say", text: "a nice day" });
    expect(interpretLine("who", none, false)).toEqual({ kind: "command", id: "who", args: "" });
    expect(interpretLine("drop it now!", none, false)).toEqual({ kind: "say", text: "drop it now!" });
    expect(interpretLine("drop", none, false)).toEqual({ kind: "command", id: "drop", args: "" });
    expect(interpretLine("yell help", none, false)).toEqual({ kind: "command", id: "yell", args: "help" });
    expect(interpretLine("cast heal", none, false)).toEqual({ kind: "command", id: "cast", args: "heal" });
    expect(interpretLine("safety off", none, false)).toEqual({ kind: "command", id: "safetyOff", args: "off" });
    expect(interpretLine(":waves", none, false)).toEqual({ kind: "command", id: "emote", args: "waves" });
    expect(interpretLine("bc hi", none, false)).toEqual({ kind: "command", id: "broadcast", args: "hi" });
  });

  test("a / or Original Command Typing parses like the original: starts of names, What? otherwise", () => {
    expect(interpretLine("/b hi", none, false)).toEqual({ kind: "command", id: "broadcast", args: "hi" });
    expect(interpretLine("/hello", none, false)).toEqual({ kind: "bad" });
    expect(interpretLine("a nice day", none, true)).toEqual({ kind: "command", id: "addgroup", args: "nice day" });
    expect(interpretLine("hello", none, true)).toEqual({ kind: "bad" });
  });

  test("command aliases come after the real commands; ~~ takes the rest of the line", () => {
    const aliases = { heal: "cast minor heal", gr: "say greetings ~~!" };
    expect(interpretLine("heal", aliases, false)).toEqual({ kind: "alias", line: "cast minor heal" });
    expect(interpretLine("gr Bob", aliases, false)).toEqual({ kind: "alias", line: "say greetings Bob!" });
    expect(interpretLine("he", aliases, false)).toEqual({ kind: "say", text: "he" }); // whole verbs only by default
    expect(interpretLine("/hea", aliases, false)).toEqual({ kind: "alias", line: "cast minor heal" });
    expect(matchAlias({ gone: "x", good: "y" }, "go", true)).toEqual({ kind: "ambiguousAlias" });
    expect(defineAlias({}, "go = say hi").aliases).toEqual({ go: "say hi" });
    expect(defineAlias({ go: "say hi" }, "go")).toEqual({ aliases: {}, message: "Command Alias removed." });
  });
});

describe("names, groups, tells and spells", () => {
  const players = [{ id: 1, name: "Bob" }, { id: 2, name: "Bobby" }, { id: 3, name: "Sir Gawain" }];
  test("names are quoted or single words, separated by spaces or commas", () => {
    expect(splitNames('friends Bob, "Sir Gawain" Ann')).toEqual(["friends", "Bob", "Sir Gawain", "Ann"]);
  });

  test("groups: new, add, delete names, delete", () => {
    let g: Record<string, string[]> = {};
    g = groupNew(g, "friends").groups!;
    expect(groupNew(g, "Friends").messages).toEqual(["There is already a group with that name."]);
    const added = groupAdd(g, "fr Bob Ann bob", () => false);
    expect(added.messages).toEqual(["Added 2 names to group."]);
    g = added.groups!;
    expect(g.friends).toEqual(["Bob", "Ann"]);
    expect(groupDelete(g, "friends ann").groups!.friends).toEqual(["Bob"]);
    expect(groupDelete(g, "friends").groups).toEqual({});
    expect(groupAdd(g, "nope Bob", () => false).messages).toEqual(["There is no group matching that name."]);
  });

  test("tell: a whole player name, then a group, then the start of a name", () => {
    const groups = { friends: ["Bob", "Sir Gawain", "Ann"] };
    expect(resolveTell("Bob hi", players, groups)).toEqual({ ids: [1], text: "hi" });
    expect(resolveTell("Sir Gawain well met", players, groups)).toEqual({ ids: [3], text: "well met" });
    expect(resolveTell("friends meet at the inn", players, groups)).toEqual({ ids: [1, 3], text: "meet at the inn" });
    expect(resolveTell("Bo hi", players, groups)).toEqual({ error: "That name is ambiguous." });
    expect(resolveTell("fri hi", players, groups)).toEqual({ ids: [1, 3], text: "hi" });
    expect(resolveTell("Zed hi", players, groups)).toEqual({ error: "No one with that name is logged on." });
    expect(resolveTell("Bob", players, groups)).toBeNull();
  });

  test("spells by whole name or a unique start", () => {
    const spells = [{ name: "Minor Heal" }, { name: "Major Heal" }, { name: "Blink" }];
    expect(findSpell(spells, "blink")).toEqual({ name: "Blink" });
    expect(findSpell(spells, "mi")).toEqual({ name: "Minor Heal" });
    expect(findSpell(spells, "m")).toBe("ambiguous");
    expect(findSpell(spells, "fireball")).toBe("none");
  });
});

describe("say.c FilterSayMessage", () => {
  test("control characters, long runs of spaces and colour codes go", () => {
    expect(filterSayMessage("hi\u0007 there")).toBe("hi there");
    expect(filterSayMessage(`a${" ".repeat(15)}b`)).toBe(`a${" ".repeat(9)}b`);
    expect(filterSayMessage("~r~b~g~u~i~kred")).toBe("~r~b~gred");
    expect(filterSayMessage("   ")).toBeNull();
  });
});
