import { describe, expect, it } from "vitest";
import { entryLine, Journal } from "./journal.ts";

describe("the agent's journal", () => {
  it("numbers entries and reads from a number on, by kind", () => {
    const j = new Journal(() => 0);
    j.add("chat", "hello", "Shardpal");
    j.add("combat", "You hit rat for 3.");
    j.add("quest", "Rats step 1: 1/20");
    expect(j.head).toBe(4);
    expect(j.since(2).map((e) => e.seq)).toEqual([2, 3]);
    expect(j.since(1, ["chat", "quest"]).map((e) => e.kind)).toEqual(["chat", "quest"]);
    expect(entryLine(j.since(1)[0]!)).toBe("#1 00:00:00 chat Shardpal: hello");
  });

  it("keeps the last 500", () => {
    const j = new Journal();
    for (let i = 0; i < 520; i++) j.add("server", `line ${i}`);
    expect(j.since(1)).toHaveLength(500);
    expect(j.since(1)[0]!.seq).toBe(21);
    expect(j.last(2).map((e) => e.text)).toEqual(["line 518", "line 519"]);
  });

  it("waits for the next entry, and gives up after the wait", async () => {
    const j = new Journal();
    const waiting = j.wait(j.head, 2000, ["chat"]);
    j.add("combat", "not this one");
    setTimeout(() => j.add("chat", "this one", "Shardpal"), 10);
    expect((await waiting).map((e) => e.text)).toEqual(["this one"]);
    expect(await j.wait(j.head, 20)).toEqual([]);
  });

  it("returns at once when there's something already", async () => {
    const j = new Journal();
    j.add("room", "Entered Raza");
    expect(await j.wait(1, 10_000)).toHaveLength(1);
  });
});
