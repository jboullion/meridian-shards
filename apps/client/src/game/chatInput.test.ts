import { describe, expect, test } from "vitest";
import { MAX_CHAT_BYTES, expandChatLinks, insertAt, utf8Length } from "./chatInput.ts";
import { filterSayMessage } from "./commands.ts";

describe("chat input (ADR 0024)", () => {
  test("bytes, as the server counts them", () => {
    expect(utf8Length("hello")).toBe(5);
    expect(utf8Length("😀")).toBe(4);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("😀".repeat(140))).toBeGreaterThan(MAX_CHAT_BYTES);
  });

  test("linked names become their tokens when sent", () => {
    const links = new Map([["[Mace]", "{i:mace:0:0|Mace}"]]);
    expect(expandChatLinks("my [Mace] and your [Mace]", links)).toBe("my {i:mace:0:0|Mace} and your {i:mace:0:0|Mace}");
    expect(expandChatLinks("no [Sword] here", links)).toBe("no [Sword] here");
  });

  test("text goes in at the caret, over a selection, or at the end; links get spaces round them", () => {
    expect(insertAt("hello", "😀", 5, 5)).toEqual({ text: "hello😀", caret: 7 });
    expect(insertAt("hello world", "[Mace]", 5, 11)).toEqual({ text: "hello [Mace] ", caret: 13 });
    expect(insertAt("", "[Mace]", null, null)).toEqual({ text: "[Mace] ", caret: 7 });
    expect(insertAt("[Mace] ", "[Emerald]", null, null)).toEqual({ text: "[Mace] [Emerald] ", caret: 17 });
    expect(insertAt("a b", "[Mace]", 1, 1)).toEqual({ text: "a [Mace] b", caret: 8 });
  });

  test("say.c's filter leaves emoji alone", () => {
    expect(filterSayMessage("hi 😀👍 ⚔️")).toBe("hi 😀👍 ⚔️");
  });
});
