import { describe, expect, test } from "vitest";
import { ByteReader, ByteWriter, buildSay, decodePlayerText, utf8ToBytes, bytesToLatin1, SAY } from "@shards/protocol";
import { chatLinkLabel, chatLinkToken, splitChatLinks } from "../src/chatLinks.ts";
import { MAGIC_FLAGS_MASK, magicColour, magicShow } from "../src/magic.ts";
import { formatServerMessage, parseMarkup } from "../src/text.ts";

describe("player text as UTF-8 (ADR 0024)", () => {
  test("emoji go out as UTF-8 and come back", () => {
    const bytes = utf8ToBytes("hi 😀");
    expect([...bytes]).toEqual([0x68, 0x69, 0x20, 0xf0, 0x9f, 0x98, 0x80]);
    // read off the wire one byte per char, as ByteReader.string does
    expect(decodePlayerText(bytesToLatin1(bytes))).toBe("hi 😀");
  });
  test("ASCII and the original client's Windows-1252 text stay as they are", () => {
    expect(decodePlayerText("plain words")).toBe("plain words");
    // "café" from the original client: é is the one byte 0xE9, not valid UTF-8
    expect(decodePlayerText("café")).toBe("café");
  });
  test("buildSay sends the text as UTF-8", () => {
    const msg = buildSay("⚔", SAY.NORMAL);
    const r = new ByteReader(msg);
    r.u8();
    expect(r.u8()).toBe(SAY.NORMAL);
    expect(r.u16()).toBe(3);
    expect([...msg.subarray(msg.length - 3)]).toEqual([0xe2, 0x9a, 0x94]);
  });
  test("a said line's %q is decoded, its %s resources are not", () => {
    const rsc = new Map<number, string>([
      [1, '%s says, "%q~n"'],
      [2, "Sir Bédon"],
    ]);
    const r = new ByteReader(new ByteWriter().u32(2).string(utf8ToBytes("well met 🍺")).finish());
    expect(formatServerMessage(1, r, (id) => rsc.get(id))).toBe('Sir Bédon says, "well met 🍺~n"');
  });
});

describe("item links in chat (ADR 0024)", () => {
  // A revealed, enormous weapon with a ring colour: magic bits only, nothing else survives
  const flags = (6 * 0x00100000) | (3 * 0x00800000) | 0x40;

  test("a token carries the picture, its colours, the ring and the name", () => {
    const token = chatLinkToken("LongSwrd.bgf", 12, flags, "Enormous Longsword of {Siphoning}|");
    expect(token).toBe(`{i:longswrd:12:${((flags & MAGIC_FLAGS_MASK) >>> 20).toString(16)}|Enormous Longsword of Siphoning}`);
    expect(chatLinkToken("not-a-picture.png", 0, 0, "x")).toBeNull();
    expect(chatLinkLabel("Enormous Longsword of {Siphoning}")).toBe("[Enormous Longsword of Siphoning]");
  });

  test("tokens split out of the line, keeping the span's style", () => {
    const token = chatLinkToken("longswrd.bgf", 12, flags, "Enormous Longsword")!;
    const spans = splitChatLinks(parseMarkup(`look ${token} and ${token}!`, "white"));
    expect(spans.map((s) => s.text)).toEqual(["look ", "[Enormous Longsword]", " and ", "[Enormous Longsword]", "!"]);
    const item = spans[1].item!;
    expect(item).toMatchObject({ file: "longswrd", translation: 12, name: "Enormous Longsword" });
    expect(magicShow(item.flags)).toBe(6);
    expect(magicColour(item.flags)).toBe(3);
    expect(spans[1].color).toBe("white");
  });

  test("malformed tokens stay text", () => {
    const spans = splitChatLinks(parseMarkup("{i:mace|no translation} {i:mace:1:0|} {i:../x:0:0|bad}", "white"));
    expect(spans.every((s) => !s.item)).toBe(true);
    expect(spans.map((s) => s.text).join("")).toBe("{i:mace|no translation} {i:mace:1:0|} {i:../x:0:0|bad}");
  });

  test("a token inside a colour code still links", () => {
    const spans = splitChatLinks(parseMarkup("~r{i:mace:0:0|Mace}~n done", "white"));
    expect(spans[0]).toMatchObject({ text: "[Mace]", color: "rgb(128,0,0)", item: { file: "mace" } });
  });
});
