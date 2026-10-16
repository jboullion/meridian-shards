// FriendsService over our server (docs/adr/0015-social-on-our-server.md): it keeps the server's
// word, sends its commands, starts and stops following as the server's list says, keeps only the
// display switches itself, and asks the relay's old friends again once.

import { describe, expect, it } from "vitest";
import { FriendsService, type FriendsEvent, type FriendsHost, type SocialEvent } from "../src/index.ts";

function make(saved: Record<string, string> = {}) {
  const commands: string[] = [];
  const messages: string[] = [];
  const events: FriendsEvent[] = [];
  const store = new Map(Object.entries(saved));
  const clock = { now: 1000 };
  const host: FriendsHost = {
    command: (line) => commands.push(line),
    message: (text) => messages.push(text),
    now: () => clock.now,
    exitTaken: (from, to, at) => ({ type: "exit", from, to, at, door: [1, 2] }),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    storageKey: "friends",
  };
  const fs = new FriendsService(host);
  fs.onEvent((e) => events.push(e));
  return { fs, commands, messages, events, store, clock };
}

const list = (patch: Partial<Extract<SocialEvent, { type: "friends" }>> = {}): SocialEvent => ({
  type: "friends",
  flags: 0,
  friends: [{ name: "Shardpal", online: true, lastSeen: 0 }, { name: "Ann", online: false, lastSeen: 100 }],
  incoming: [],
  outgoing: [],
  following: null,
  followers: [],
  ...patch,
});

describe("friends from our server", () => {
  it("keeps the server's list, by name", () => {
    const { fs, commands } = make();
    fs.start();
    expect(commands).toEqual(["friend list"]);
    fs.handle(list({ incoming: ["Bob"], outgoing: ["Cy"], flags: 1 | 4 }));
    expect(fs.ready).toBe(true);
    expect(fs.friends.map((f) => f.key)).toEqual(["ann", "shardpal"]);
    expect([...fs.online]).toEqual(["shardpal"]);
    expect(fs.friendByName("ANN")?.lastSeen).toBe((100 + 1760000000) * 1000);
    expect(fs.incoming).toEqual([{ key: "bob", name: "Bob" }]);
    expect(fs.options).toMatchObject({ shareLocation: false, visible: true, refuseFollows: true });
  });

  it("sends requests and answers by name", () => {
    const { fs, commands } = make();
    fs.handle(list({ incoming: ["Bob Smith"], outgoing: ["Cy"] }));
    expect(fs.add("shardpal", "Me")).toMatch(/already your friend/);
    expect(fs.add("me", "Me")).toBe("That's you.");
    expect(fs.add("cy", "Me")).toMatch(/already asked/);
    expect(fs.add("Dee", "Me")).toBeNull();
    fs.accept("bob smith");
    fs.cancel("cy");
    fs.remove("ann");
    expect(commands).toEqual(["friend request Dee", "friend accept Bob Smith", "friend cancel Cy", "friend remove Ann"]);
  });

  it("starts and stops following as the server's list says", () => {
    const { fs, events, commands } = make();
    fs.handle(list());
    expect(fs.startFollow("shardpal")).toBeNull();
    expect(commands).toEqual(["friend follow Shardpal"]);
    expect(events).toEqual([]);
    fs.handle(list({ following: "Shardpal" }));
    expect(events).toEqual([{ type: "startFollowing", key: "shardpal", name: "Shardpal" }]);
    fs.handle({ type: "exit", name: "Shardpal", from: "a.roo", to: "b.roo", at: [3, 4] });
    expect(events[1]).toEqual({ type: "exit", key: "shardpal", exit: { type: "exit", from: "a.roo", to: "b.roo", at: [3, 4], door: [1, 2] } });
    // The leader turned us away: the next list has nobody
    fs.handle(list());
    expect(events[2]).toEqual({ type: "stopFollowing", key: "shardpal", why: "" });
    expect(fs.startFollow("ann")).toMatch(/isn't online/);
  });

  it("stops following itself and tells the server", () => {
    const { fs, events, commands, messages } = make();
    fs.handle(list({ following: "Shardpal" }));
    fs.stopFollowing("you moved");
    expect(fs.following).toBeNull();
    expect(commands).toEqual(["friend unfollow"]);
    expect(messages).toEqual(["You stop following: you moved."]);
    expect(events.at(-1)).toEqual({ type: "stopFollowing", key: "shardpal", why: "you moved" });
    // The server's list agreeing changes nothing more
    fs.handle(list());
    expect(events.filter((e) => e.type === "stopFollowing")).toHaveLength(1);
  });

  it("sends the options as the server's flags; health bars stay here", () => {
    const { fs, commands, store } = make();
    fs.handle(list());
    fs.setOptions({ visible: false });
    fs.setOptions({ refuseFollows: true });
    fs.setOptions({ healthBars: false });
    expect(commands).toEqual(["friend options 2", "friend options 6"]);
    expect(JSON.parse(store.get("friends")!)).toMatchObject({ version: 2, healthBars: false });
  });

  it("asks the server to send our health to friends in the room, on change and not too often", () => {
    const { fs, commands, clock } = make();
    fs.handle(list());
    fs.setHealth(80);
    fs.tick();
    expect(commands).toEqual([]);
    fs.setRoomFriends(["shardpal"]);
    fs.tick();
    fs.setHealth(70);
    fs.tick();
    clock.now += 300;
    fs.tick();
    clock.now += 100;
    fs.tick();
    clock.now += 5000;
    fs.tick();
    expect(commands).toEqual(["friend hp", "friend hp", "friend hp"]);
    fs.handle({ type: "health", name: "Shardpal", pct: 42 });
    expect(fs.healthOf("shardpal")).toBe(42);
  });

  it("searches, answered by the server's next list of names", async () => {
    const { fs, commands } = make();
    const found = fs.search("sh");
    expect(commands).toEqual(["friend search sh"]);
    fs.handle({ type: "search", names: ["Shardpal", "Ash"] });
    expect(await found).toEqual(["Ash", "Shardpal"]);
  });

  it("asks the relay's old friends again once, keeping their switches", () => {
    const old = { version: 1, friends: [{ name: "Shardpal", key: "k1", locate: false, marker: true }, { name: "Gone", key: "k2" }], options: { healthBars: false } };
    const { fs, commands, store } = make({ friends: JSON.stringify(old) });
    fs.handle(list());
    expect(commands).toEqual(["friend request Gone"]);
    expect(fs.friendByKey("shardpal")?.locate).toBe(false);
    expect(fs.options.healthBars).toBe(false);
    fs.handle(list());
    expect(commands).toHaveLength(1);
    expect(JSON.parse(store.get("friends")!).version).toBe(2);
  });
});
