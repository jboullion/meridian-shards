// The arena's feed (arenaFeed.ts, docs/adr/0015-social-on-our-server.md 3): watching needs no
// sign-in, only the server and the arena's room; anything else is told there's no arena, and the
// feed keeps its limits. The fights themselves are arena.test.ts's.

import { describe, expect, it } from "vitest";
import type { ArenaHost, ArenaWatcher } from "./arena.ts";
import { ArenaFeed, FEED_MAX_MESSAGE, FEED_RATE } from "./arenaFeed.ts";

/** An arena host that only notes who watches */
function fakeHost() {
  const watching: { server: string; w: ArenaWatcher; hour: number | null; room: string }[] = [];
  const hours: (number | null)[] = [];
  const busy: [string, string, boolean][] = [];
  const host = {
    rooms: ["tosarena.roo", "tosarena_death.roo"],
    watch(server: string, w: ArenaWatcher, hour: number | null = null, room = "tosarena.roo") {
      watching.push({ server, w, hour, room });
      w.send(JSON.stringify({ t: "arenaState" }));
      return true;
    },
    leave(server: string, w: ArenaWatcher) {
      const i = watching.findIndex((x) => x.server === server && x.w === w);
      if (i >= 0) watching.splice(i, 1);
    },
    setHour(_server: string, hour: number | null) {
      hours.push(hour);
    },
    setBusy(server: string, room: string, b: boolean) {
      busy.push([server, room, b]);
    },
  };
  return { host: host as unknown as ArenaHost, watching, hours, busy };
}

function peer() {
  const sent: Record<string, unknown>[] = [];
  const closes: number[] = [];
  return { sent, closes, peer: { send: (t: string) => sent.push(JSON.parse(t) as Record<string, unknown>), close: (code: number) => closes.push(code) } };
}

describe("the arena's feed", () => {
  it("watches with no sign-in, hears the hour, and stops when asked or gone", async () => {
    const { host, watching, hours } = fakeHost();
    const feed = new ArenaFeed({ arena: host });
    const p = peer();
    const conn = feed.connect(p.peer);
    await conn.receive(JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tosarena.roo", hour: 14 }));
    expect(watching).toHaveLength(1);
    expect(watching[0]).toMatchObject({ server: "ws://test/ws", hour: 14 });
    expect(p.sent[0]?.t).toBe("arenaState");
    await conn.receive(JSON.stringify({ t: "arenaHour", hour: 15 }));
    expect(hours).toEqual([15]);
    await conn.receive(JSON.stringify({ t: "arenaLeave" }));
    expect(watching).toHaveLength(0);
    await conn.receive(JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tosarena.roo" }));
    expect(watching).toHaveLength(1);
    conn.closed();
    expect(watching).toHaveLength(0);
    expect(feed.size).toBe(0);
  });

  it("watches the Arena of Death too, and passes on a player's bout holding the floor", async () => {
    const { host, watching, busy } = fakeHost();
    const feed = new ArenaFeed({ arena: host });
    const p = peer();
    const conn = feed.connect(p.peer);
    // Not before watching
    await conn.receive(JSON.stringify({ t: "arenaBusy", busy: true }));
    expect(busy).toEqual([]);
    await conn.receive(JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tosarena_death.roo", hour: 23 }));
    expect(watching[0]).toMatchObject({ room: "tosarena_death.roo", hour: 23 });
    await conn.receive(JSON.stringify({ t: "arenaBusy", busy: true }));
    await conn.receive(JSON.stringify({ t: "arenaBusy", busy: "yes" }));
    await conn.receive(JSON.stringify({ t: "arenaBusy", busy: false }));
    expect(busy).toEqual([
      ["ws://test/ws", "tosarena_death.roo", true],
      ["ws://test/ws", "tosarena_death.roo", false],
    ]);
  });

  it("says there's no arena for another room, no server, or no arena at all", async () => {
    const { host, watching } = fakeHost();
    const feed = new ArenaFeed({ arena: host });
    const p = peer();
    const conn = feed.connect(p.peer);
    await conn.receive(JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tos.roo" }));
    await conn.receive(JSON.stringify({ t: "arenaWatch", room: "tosarena.roo" }));
    expect(p.sent.map((m) => m.t)).toEqual(["arenaOff", "arenaOff"]);
    expect(watching).toHaveLength(0);
    const none = new ArenaFeed();
    const q = peer();
    await none.connect(q.peer).receive(JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tosarena.roo" }));
    expect(q.sent.map((m) => m.t)).toEqual(["arenaOff"]);
  });

  it("drops what's over the rate and closes on a message too big", async () => {
    let now = 0;
    const { host, watching } = fakeHost();
    const feed = new ArenaFeed({ arena: host, now: () => now });
    const p = peer();
    const conn = feed.connect(p.peer);
    const watch = JSON.stringify({ t: "arenaWatch", server: "ws://test/ws", room: "tosarena.roo" });
    for (let i = 0; i < 3 * FEED_RATE; i++) await conn.receive(watch);
    // A burst of twice the rate is let through, each watch replacing the last
    expect(p.sent).toHaveLength(2 * FEED_RATE);
    expect(watching).toHaveLength(1);
    now += 1000;
    await conn.receive("x".repeat(FEED_MAX_MESSAGE + 1));
    expect(p.closes).toEqual([1009]);
    expect(watching).toHaveLength(0);
  });
});
