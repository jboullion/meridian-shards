// The arena on the gateway (docs/adr/0007-arena.md): everyone on a server watches one arena, it stops
// when nobody does, its season is kept on disk and turns over each Meridian year, and players get
// it through the feed with an ArenaClient.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  ArenaClient, DEFAULT_ARENA_CONFIG, SEASON_MS, seasonStart, type ArenaMessage, type ArenaState, type ArenaTick,
} from "../../packages/world/src/index.ts";
import { ArenaHost } from "./arena.ts";
import { ArenaFeed } from "./arenaFeed.ts";

const ASSETS = join(import.meta.dirname, "../../dist/assets");
const have = existsSync(join(ASSETS, "tosarena.roo"));
const haveDeath = existsSync(join(ASSETS, "tosarena_death.roo"));
const SERVER = "ws://test/ws";

let dir: string | null = null;
let http: Server | null = null;
const clients: ArenaClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
  http = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const until = async (test: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

function host(clock: { now: number }, statePath: string | null = null): ArenaHost {
  return new ArenaHost({ config: DEFAULT_ARENA_CONFIG, assetsDir: ASSETS, statePath, now: () => clock.now, manual: true });
}

const watcher = () => {
  const got: ArenaMessage[] = [];
  return { got, send: (t: string) => void got.push(JSON.parse(t) as ArenaMessage) };
};

describe.skipIf(!have)("the arena on the gateway", () => {
  it("everyone on a server watches the same arena; another server has its own", () => {
    const clock = { now: seasonStart(3) + 1000 };
    const h = host(clock);
    const a = watcher(),
      b = watcher(),
      c = watcher();
    expect(h.watch(SERVER, a)).toBe(true);
    h.stepAll(40);
    // A late watcher gets everything as it is, then the same ticks as the first
    h.watch(SERVER, b);
    h.watch("ws://other/ws", c);
    expect(h.running).toBe(2);
    expect(b.got[0].t).toBe("arenaState");
    expect((b.got[0] as ArenaState).season).toBe(3);
    h.stepAll(40);
    const ticks = (w: { got: ArenaMessage[] }) => w.got.filter((m) => m.t === "arenaTick").map((m) => JSON.stringify(m));
    expect(ticks(b).length).toBe(20);
    expect(ticks(a).slice(-20)).toEqual(ticks(b));
    expect(ticks(c)).not.toEqual(ticks(b));
  });

  it("keeps the game's hours by the watchers' sun, not the wall clock", () => {
    const clock = { now: seasonStart(2) };
    const h = host(clock);
    const a = watcher();
    // Their sun says the middle of the night: shut
    h.watch(SERVER, a, 2);
    h.stepAll(40);
    expect(h.simOf(SERVER)!.phase).toBe("closed");
    expect(h.simOf(SERVER)!.everyone).toHaveLength(0);
    // An admin sets the time to noon: open, and the stands fill
    h.setHour(SERVER, 12);
    h.stepAll(200);
    expect(h.simOf(SERVER)!.phase).not.toBe("closed");
    expect(h.simOf(SERVER)!.everyone.length).toBeGreaterThan(4);
  });

  it("runs by the clock, and stops a minute after the last watcher goes", () => {
    const clock = { now: seasonStart(2) };
    const h = host(clock);
    const a = watcher();
    h.watch(SERVER, a);
    clock.now += 1000;
    h.pump();
    // 20 ticks in a second, a message every other one
    expect(a.got.filter((m) => m.t === "arenaTick")).toHaveLength(10);
    h.leave(SERVER, a);
    clock.now += 30_000;
    h.pump();
    expect(h.running).toBe(1);
    clock.now += 31_000;
    h.pump();
    expect(h.running).toBe(0);
  });

  it("keeps the season's roster on disk, and turns it over each Meridian year with its champion", async () => {
    dir = mkdtempSync(join(tmpdir(), "arena-"));
    const file = join(dir, "arena-state.json");
    const clock = { now: seasonStart(4) + 5000 };
    const h = host(clock, file);
    const a = watcher();
    h.watch(SERVER, a);
    await h.save();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.version).toBe(1);
    expect(saved.servers[SERVER].season).toBe(4);
    const roster = saved.servers[SERVER].roster.map((r: { name: string }) => r.name);
    // A restart reads it back: the same roster, the same season
    const again = host(clock, file);
    const b = watcher();
    again.watch(SERVER, b);
    expect((b.got[0] as ArenaState).roster.map((r) => r.name)).toEqual(roster);
    // Someone won a few; the year ends
    const sim = again.simOf(SERVER)!;
    (sim as unknown as { records: Record<number, { wins: number; losses: number; kills: number }> }).records[2] = { wins: 3, losses: 0, kills: 4 };
    sim.now = seasonStart(5) + 10;
    again.stepAll(2);
    const tick = b.got.filter((m): m is ArenaTick => m.t === "arenaTick").at(-1)!;
    expect(tick.season).toBe(5);
    expect(tick.champions).toEqual([{ season: 4, name: roster[2], arch: saved.servers[SERVER].roster[2].arch }]);
    await again.save();
    const next = JSON.parse(readFileSync(file, "utf8")).servers[SERVER];
    expect(next.season).toBe(5);
    expect(next.roster.map((r: { name: string }) => r.name)).not.toEqual(roster);
    expect(next.champions).toHaveLength(1);
    expect(SEASON_MS).toBe(20 * 24 * 3600_000);
  });

  it.skipIf(!haveDeath)("runs the Arena of Death beside it, with its own season, by night, giving way to a player's bout", async () => {
    dir = mkdtempSync(join(tmpdir(), "arena-"));
    const file = join(dir, "arena-state.json");
    const clock = { now: seasonStart(4) + 5000 };
    const h = host(clock, file);
    const a = watcher(),
      d = watcher();
    h.watch(SERVER, a, 23);
    expect(h.watch(SERVER, d, 23, "tosarena_death.roo")).toBe(true);
    expect(h.running).toBe(2);
    // Its own roster: the elites, kept apart from the Arena of Kraanan's
    const roster = (d.got[0] as ArenaState).roster;
    expect(new Set(roster.map((r) => r.arch))).toEqual(new Set(["gladiator", "qorbattle", "farenbattle", "riijabattle"]));
    await h.save();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(saved.servers).sort()).toEqual([SERVER, `${SERVER}|death`]);
    // At 23 the Arena of Kraanan is shut and the Arena of Death fights
    h.stepAll(400);
    expect(h.simOf(SERVER)!.phase).toBe("closed");
    const death = h.simOf(SERVER, "tosarena_death.roo")!;
    expect(death.phase).not.toBe("closed");
    // A player's bout takes the floor: nobody fights while it does
    h.setBusy(SERVER, "tosarena_death.roo", true);
    h.stepAll(200);
    expect(death.busy).toBe(true);
    expect(death.phase).toBe("rest");
    // The hour moves to the day for everyone on the server: the Arena of Death shuts
    h.setHour(SERVER, 12);
    h.stepAll(40);
    expect(death.phase).toBe("closed");
    expect(h.simOf(SERVER)!.phase).not.toBe("closed");
  });

  it("players watch it through the feed; with no arena there, they're told", async () => {
    const clock = { now: Date.now() };
    const h = host(clock);
    const feed = new ArenaFeed({ arena: h });
    const wss = new WebSocketServer({ noServer: true });
    http = createServer();
    http.on("upgrade", (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = feed.connect({ send: (t) => ws.send(t), close: (code, r) => ws.close(code, r) });
        ws.on("message", (d) => void conn.receive(String(d)));
        ws.on("close", () => conn.closed());
      }),
    );
    await new Promise<void>((r) => http!.listen(0, "127.0.0.1", r));
    const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/arena`;
    const heard: (ArenaMessage | null)[] = [];
    const client = new ArenaClient({ url, server: SERVER }, (m) => heard.push(m));
    clients.push(client);
    client.watch("tosarena.roo");
    await until(() => heard.length > 0);
    expect(heard[0]?.t).toBe("arenaState");
    h.stepAll(4);
    await until(() => heard.length >= 3);
    expect(heard.slice(1).every((m) => m?.t === "arenaTick")).toBe(true);
    // Another room isn't the arena
    client.watch(null);
    await until(() => h.running === 1);
    client.watch("tos.roo");
    await until(() => heard.includes(null));
  });
});
