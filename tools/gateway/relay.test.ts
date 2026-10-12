// The friends relay with real clients (docs/adr/0005-friends.md 7.1): two players pairing through
// it and one tell, a fake name that can't, presence only between friends, and what friends send.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  FRIEND_REQUEST_MS, FriendsService, SocialClient, generateIdentity, helloText, publicKeyString, toBase64Url, type FriendsEvent, type FriendsHost,
} from "../../packages/world/src/index.ts";
import { SocialRelay } from "./relay.ts";

const SERVER = "ws://test/ws";

let http: Server | null = null;
const clients: SocialClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
  http = null;
});

/** The relay on a free port, as gateway.ts runs it */
async function startRelay(): Promise<{ url: string; relay: SocialRelay }> {
  const relay = new SocialRelay();
  const wss = new WebSocketServer({ noServer: true });
  http = createServer();
  http.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = relay.connect({ send: (t) => ws.send(t), close: (c, r) => ws.close(c, r) });
      ws.on("message", (d) => void conn.receive(String(d)));
      ws.on("close", () => conn.closed());
    }),
  );
  await new Promise<void>((r) => http!.listen(0, "127.0.0.1", r));
  return { url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}/social`, relay };
}

const until = async (test: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** A player: a relay client, a friends service, and a pretend game whose tells reach `world` */
interface Player {
  name: string;
  client: SocialClient;
  friends: FriendsService;
  messages: string[];
  events: FriendsEvent[];
}

const world = new Map<string, Player>();
let clock = 1_000_000;

async function player(url: string, name: string, claim = name): Promise<Player> {
  const messages: string[] = [];
  const events: FriendsEvent[] = [];
  const store = new Map<string, string>();
  let friends: FriendsService | null = null;
  const host: FriendsHost = {
    // The server delivers the tell to the character named, saying who sent it
    tell: (to, text) => {
      const p = world.get(to.toLowerCase());
      if (!p) return false;
      p.friends.tellReceived(name, text, false);
      return true;
    },
    inGame: (n) => world.has(n.toLowerCase()),
    message: (t) => messages.push(t),
    now: () => clock,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    storageKey: `shards.friends.${SERVER}.${name}`,
  };
  const client = new SocialClient(
    { url, server: SERVER, name: claim, keys: await generateIdentity(), visible: true },
    {
      status: (s) => friends?.setRelayStatus(s),
      message: (from, n, body) => void friends?.relayMessage(from, n, body),
      presence: (key, online) => friends?.relayPresence(key, online),
      undeliverable: (to) => friends?.relayUndeliverable(to),
    },
  );
  clients.push(client);
  await client.start();
  friends = new FriendsService(client, host);
  friends.onEvent((e) => events.push(e));
  await until(() => client.status === "online");
  friends.setRelayStatus("online");
  await friends.init();
  const p = { name, client, friends, messages, events };
  if (claim === name) world.set(name.toLowerCase(), p);
  return p;
}

async function pair(a: Player, b: Player): Promise<void> {
  const [found] = await a.client.search(b.name.slice(0, 3));
  expect(found?.name).toBe(b.name);
  expect(a.friends.add(found)).toBeNull();
  await until(() => b.friends.incoming.length === 1);
  b.friends.accept(b.friends.incoming[0].key);
  await until(() => a.friends.friends.length === 1 && b.friends.friends.length === 1);
}

describe("friends relay", () => {
  it("pairs two players with one tell, then shows them online to each other", async () => {
    world.clear();
    const { url } = await startRelay();
    const bob = await player(url, "Bob");
    const alice = await player(url, "Alice");
    await pair(bob, alice);
    expect(bob.friends.friends[0]).toMatchObject({ name: "Alice", key: alice.client.key });
    expect(alice.friends.friends[0]).toMatchObject({ name: "Bob", key: bob.client.key });
    await until(() => bob.friends.online.has(alice.client.key) && alice.friends.online.has(bob.client.key));
    expect(alice.messages.some((m) => m.includes("Bob wants to be your friend"))).toBe(true);
  });

  it("drops a request from someone only claiming the name", async () => {
    world.clear();
    const { url } = await startRelay();
    const alice = await player(url, "Alice");
    const bob = await player(url, "Bob");
    // Mallory connects to the relay saying she's Carol; Carol is in the game but not on the relay
    const carol = { name: "Carol", tells: [] as string[] };
    world.set("carol", { name: "Carol", friends: { tellReceived: (_s: string, t: string) => carol.tells.push(t) } } as unknown as Player);
    const mallory = await player(url, "Mallory", "Carol");
    const [found] = await bob.client.search("Car");
    expect(found.key).toBe(mallory.client.key);
    expect(bob.friends.add(found)).toBeNull();
    // The tell went to the real Carol; Mallory got the relay's half and has no code to answer with
    expect(carol.tells.length).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(mallory.friends.incoming).toEqual([]);
    // Mallory asks Alice in Carol's name: the server would say the tell came from Mallory, so nothing matches
    mallory.client.send(alice.client.key, { type: "request" });
    alice.friends.tellReceived("Mallory", "[Meridian Shards friend request ABCDEFGH 0123456789abcdef]", false);
    await new Promise((r) => setTimeout(r, 100));
    expect(alice.friends.incoming).toEqual([]);
    clock += FRIEND_REQUEST_MS + 1;
    alice.friends.tick();
    expect(alice.friends.incoming).toEqual([]);
  });

  it("only friends see each other online", async () => {
    const { url } = await startRelay();
    const seen: Record<string, [string, boolean][]> = { anna: [], bert: [] };
    const make = async (name: "anna" | "bert") => {
      const c = new SocialClient(
        { url, server: SERVER, name, keys: await generateIdentity(), visible: true },
        { presence: (k, online) => seen[name].push([k, online]) },
      );
      clients.push(c);
      await c.start();
      await until(() => c.status === "online");
      return c;
    };
    const anna = await make("anna");
    const bert = await make("bert");
    // Anna watches Bert's key without his watching hers: the relay says nothing
    anna.watch([bert.key]);
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.anna).toEqual([]);
    // Once both watch, both hear; and when one goes, the other hears that
    bert.watch([anna.key]);
    await until(() => seen.anna.length === 1 && seen.bert.length === 1);
    expect(seen.anna[0]).toEqual([bert.key, true]);
    expect(seen.bert[0]).toEqual([anna.key, true]);
    bert.close();
    await until(() => seen.anna.length === 2);
    expect(seen.anna[1]).toEqual([bert.key, false]);
  });

  it("keeps pets by name (ADR 0006 section 3): answered when asked, changes heard, the first to claim a name keeps it", async () => {
    const { url } = await startRelay();
    const heard: { name: string; key: string | null; pet: unknown }[][] = [];
    const make = async (name: string, onPets?: (p: { name: string; key: string | null; pet: unknown }[]) => void) => {
      const c = new SocialClient({ url, server: SERVER, name, keys: await generateIdentity(), visible: true }, { pets: onPets });
      clients.push(c);
      await c.start();
      await until(() => c.status === "online");
      return c;
    };
    const alice = await make("Alice");
    alice.setPet({ kind: "rat", colour: 0, name: "Squeak" });
    // A second "Alice" can't take over her pet
    const fake = await make("Alice");
    fake.setPet({ kind: "spider", colour: 0, name: "Boo" });
    const bob = await make("Bob", (p) => heard.push(p));
    bob.queryPets(["alice", "carol"]);
    await until(() => heard.length === 1);
    expect(heard[0]).toEqual([{ name: "Alice", key: alice.key, pet: { kind: "rat", colour: 0, name: "Squeak" } }]);
    alice.setPet({ kind: "bunny", colour: 0, name: "Hop" });
    await until(() => heard.length === 2);
    expect(heard[1][0].pet).toEqual({ kind: "bunny", colour: 0, name: "Hop" });
    // Alice goes: her name passes to the other claim, whose pet Bob now hears
    alice.close();
    await until(() => heard.length === 3);
    expect(heard[2][0]).toMatchObject({ key: fake.key, pet: { kind: "spider" } });
    // Asking about others: no more about Alice
    bob.queryPets(["carol"]);
    await until(() => heard.length === 4);
    fake.setPet(null);
    await new Promise((r) => setTimeout(r, 100));
    expect(heard).toHaveLength(4);
  });

  it("refuses a hello with a bad signature", async () => {
    const { url } = await startRelay();
    const keys = await generateIdentity();
    const key = await publicKeyString(keys.publicKey);
    const ws = new WebSocket(url);
    const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data)) as { t: string; nonce: string };
      if (m.t !== "challenge") return;
      // Signed for another name
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(helloText(m.nonce, SERVER, "Someone")));
      ws.send(JSON.stringify({ t: "hello", key, server: SERVER, name: "Other", sig: toBase64Url(new Uint8Array(sig)) }));
    };
    expect(await closed).toBe(4003);
  });

  it("carries location, health, following and exits between friends, and removal", async () => {
    world.clear();
    const { url } = await startRelay();
    const lead = await player(url, "Leader");
    const fol = await player(url, "Follower");
    await pair(fol, lead);
    await until(() => fol.friends.online.has(lead.client.key) && lead.friends.online.has(fol.client.key));
    lead.friends.setLocation({ room: "tos.roo", rid: 15, at: [10, 20] });
    await until(() => fol.friends.locations.get(lead.client.key) !== undefined);
    expect(fol.friends.locations.get(lead.client.key)).toMatchObject({ room: "tos.roo", rid: 15, at: [10, 20] });
    // Sharing off: friends are told at once
    lead.friends.setOptions({ shareLocation: false });
    await until(() => "hidden" in (fol.friends.locations.get(lead.client.key) ?? {}));

    lead.friends.setHealth(73.4);
    lead.friends.setRoomFriends([fol.client.key]);
    lead.friends.tick();
    await until(() => fol.friends.healthOf(lead.client.key) === 73);

    expect(fol.friends.startFollow(lead.client.key)).toBeNull();
    await until(() => lead.friends.followers.has(fol.client.key));
    // No following back
    expect(lead.friends.startFollow(fol.client.key)).toMatch(/following you/);
    lead.friends.leftRoom({ from: "tos.roo", to: "tosinn.roo", at: [5, 6], door: [5, 6] });
    await until(() => fol.events.some((e) => e.type === "exit"));
    expect(fol.events.find((e) => e.type === "exit")).toMatchObject({ exit: { from: "tos.roo", to: "tosinn.roo", door: [5, 6] } });
    lead.friends.stopFollower(fol.client.key);
    await until(() => fol.friends.following === null);
    expect(fol.events.some((e) => e.type === "stopFollowing")).toBe(true);

    lead.friends.remove(fol.client.key);
    await until(() => fol.friends.friends.length === 0);
    expect(lead.friends.friends.length).toBe(0);
  });

  it("asks a friend which crowd they see (ADR 0005 section 6), friends only", async () => {
    world.clear();
    const { url } = await startRelay();
    const a = await player(url, "Asker");
    const b = await player(url, "Teller");
    const stranger = await player(url, "Stranger");
    await pair(a, b);
    await until(() => a.friends.online.has(b.client.key) && b.friends.online.has(a.client.key));
    b.friends.onEvent((e) => {
      if (e.type === "ambientAsk") b.friends.sendAmbient(a.client.key, { type: "ambient", room: e.room, seed: 42, since: 1000 });
    });
    a.friends.sendAmbient(b.client.key, { type: "ambient-ask", room: "tosarena.roo" });
    await until(() => a.events.some((e) => e.type === "ambient"));
    expect(a.events.find((e) => e.type === "ambient")).toMatchObject({ room: "tosarena.roo", seed: 42, since: 1000 });
    // Not a friend: not asked, and not heard
    a.friends.sendAmbient(stranger.client.key, { type: "ambient-ask", room: "tosarena.roo" });
    stranger.client.send(a.client.key, { type: "ambient", room: "tosarena.roo", seed: 7, since: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(stranger.events).toEqual([]);
    expect(a.events.filter((e) => e.type === "ambient")).toHaveLength(1);
  });

  it("tells a friend removed while offline when they're back", async () => {
    world.clear();
    const { url } = await startRelay();
    const a = await player(url, "Ada");
    const b = await player(url, "Ben");
    await pair(a, b);
    await until(() => a.friends.online.has(b.client.key));
    // Ben drops off the relay; Ada removes him meanwhile
    b.client.close();
    await until(() => !a.friends.online.has(b.client.key));
    a.friends.remove(b.client.key);
    // Ben comes back with the same key
    const again = new SocialClient(
      { url, server: SERVER, name: "Ben", keys: (b.client as unknown as { opts: { keys: CryptoKeyPair } }).opts.keys, visible: true },
      { message: (from, n, body) => void b.friends.relayMessage(from, n, body), presence: (k, o) => b.friends.relayPresence(k, o) },
    );
    clients.push(again);
    await again.start();
    await until(() => again.status === "online");
    again.watch(b.friends.friends.map((f) => f.key));
    await until(() => b.friends.friends.length === 0);
  });
});
