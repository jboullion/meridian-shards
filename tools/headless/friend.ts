// A scripted friend (docs/adr/0005-friends.md), for trying the friends feature with one person:
// a character in the game (GameSession) on the friends relay, accepting any friend request,
// saying where it is and its health as the client does (apps/client social.ts), and telling
// followers which way it left. It can ask someone itself, and walk a path and use a door.
//
//   node tools/headless/friend.ts --user shardpal --pass shardpal [--add Shardbot]
//        [--walk "row,col row,col ..."] [--go] [--wait 20] [--stay 120] [--keyfile <path>]
//        [--server ws://localhost:5173/ws] [--gateway ws://localhost:8059] [--relay ws://localhost:8059/social]
//
// --server is the game server's name as the browser client sees it (its game socket URL): friends
// don't cross servers, so it must match the browser's (Vite's in development). --walk waits
// --wait seconds first (time to start following), then walks the squares and, with --go, sends
// BP_REQ_GO at the end. --keyfile keeps the character's key and friends in a file between runs
// (the browser keeps its key unreadable in IndexedDB; this is for testing only), so a restart
// needn't pair again.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";
import { STAT_GROUP } from "../../packages/protocol/src/index.ts";
import {
  FriendsService, GameSession, SocialClient, exitTaken, generateIdentity, squareOf, type AmbientExits,
} from "../../packages/world/src/index.ts";

const { values: opt } = parseArgs({
  options: {
    user: { type: "string", default: "shardpal" },
    pass: { type: "string", default: "shardpal" },
    server: { type: "string", default: "ws://localhost:5173/ws" },
    gateway: { type: "string", default: "ws://localhost:8059" },
    relay: { type: "string", default: "ws://localhost:8059/social" },
    rsb: { type: "string", default: "server/src/run/server/rsc/rsc0000.rsb" },
    add: { type: "string" },
    walk: { type: "string" },
    go: { type: "boolean", default: false },
    wait: { type: "string", default: "20" },
    stay: { type: "string", default: "120" },
    keyfile: { type: "string" },
  },
});

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cfg = readFileSync("server/config/blakserv.cfg", "utf8");
const secretKey = /^SecretKey\s+(\S+)/m.exec(cfg)?.[1] ?? "";
const rsb = parseRsb(readFileSync(opt.rsb!));
let exits: Record<string, AmbientExits> = {};
try {
  exits = JSON.parse(readFileSync("dist/assets/roomexits.json", "utf8")) as Record<string, AmbientExits>;
} catch {
  log("no dist/assets/roomexits.json: exits can't be named for followers");
}

const OF_PLAYER = 0x4;
let friends: FriendsService | null = null;
let room = "";
const session = new GameSession(
  { url: opt.gateway!, username: opt.user!, password: opt.pass!, secretKey, lookupResource: (id, lang) => rsb.get(id, lang) },
  {
    phase: (p) => {
      log("phase", p);
      if (p === "characters") {
        const c = session.characters.find((x) => x.flags !== 1);
        if (c) session.useCharacter(c.id);
        else log("no character to play");
      }
      if (p === "game") void startFriends();
      if (p === "closed") process.exit(0);
    },
    chat: (l) => log("chat:", l.spans.map((s) => s.text).join("")),
    error: (e) => log("error:", e),
  },
);

const name = () => {
  const self = session.world.self;
  return self ? (session.resource(self.info.nameRes) ?? "") : "";
};
const byName = (n: string) => [...session.world.players.values()].find((p) => p.name.toLowerCase() === n.toLowerCase());

async function startFriends(): Promise<void> {
  while (!name()) await new Promise((r) => setTimeout(r, 100));
  const me = name();
  log(`in the game as ${me}`);
  const { keys, store } = await loadIdentity();
  const client = new SocialClient(
    { url: opt.relay!, server: opt.server!, name: me, keys, visible: true },
    {
      status: (s) => {
        log("relay", s);
        friends?.setRelayStatus(s);
      },
      message: (from, n, body) => {
        log(`relay message from ${n}:`, JSON.stringify(body));
        void friends?.relayMessage(from, n, body);
      },
      presence: (key, online, n) => {
        log(`presence ${n ?? key.slice(0, 8)}: ${online ? "online" : "offline"}`);
        friends?.relayPresence(key, online);
      },
      undeliverable: (to) => friends?.relayUndeliverable(to),
    },
  );
  await client.start();
  const fs = new FriendsService(client, {
    tell: (n, text) => {
      const p = byName(n);
      if (!p) return false;
      session.sayTo([p.id], text);
      return true;
    },
    inGame: (n) => !!byName(n),
    message: (t) => log("friends:", t),
    now: () => Date.now(),
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
        void saveIdentity(keys, store);
      },
    },
    storageKey: "friends",
  });
  friends = fs;
  while (client.status !== "online") await new Promise((r) => setTimeout(r, 100));
  fs.setRelayStatus("online");
  await fs.init();
  session.lineFilter = (text, sender) => fs.tellReceived(sender?.name ?? "", text, !sender || sender.id === session.world.player?.id);
  // Accept whoever asks, as soon as their request is proven
  fs.onChange(() => {
    for (const r of fs.incoming) {
      log(`accepting ${r.name}`);
      fs.accept(r.key);
    }
  });
  const world = session.world;
  const where = () => {
    const self = world.self;
    room = (session.resource(world.player?.roomRes ?? 0) ?? "").toLowerCase();
    if (self && room) fs.setLocation({ room, rid: 0, at: squareOf(self) });
  };
  const roomFriends = () => {
    const keys: string[] = [];
    for (const o of world.objects.values()) {
      if (!(o.info.flags & OF_PLAYER) || o.id === world.player?.id) continue;
      const f = fs.friendByName(session.resource(o.info.nameRes) ?? "");
      if (f) keys.push(f.key);
    }
    fs.setRoomFriends(keys);
  };
  const health = () => {
    const hp = world.stats.get(STAT_GROUP.MAIN)?.find((s) => s.num === 1)?.numeric;
    if (hp && hp.currentMax) fs.setHealth((100 * hp.value) / hp.currentMax);
  };
  world.on((e) => {
    if (e.type === "player" && e.roomChanged) {
      const from = room;
      const to = (session.resource(e.player.roomRes) ?? "").toLowerCase();
      const self = world.self;
      if (from && to && from !== to && self) {
        const exit = exitTaken(exits[from], from, to, squareOf(self), null);
        log(`left ${from} for ${to}:`, JSON.stringify(exit));
        fs.leftRoom(exit);
      }
    }
    if (e.type === "roomContents") {
      where();
      roomFriends();
    }
    if (e.type === "objectAdded" || e.type === "objectRemoved") roomFriends();
    if (e.type === "stats" && e.group === STAT_GROUP.MAIN) health();
  });
  health();
  where();
  roomFriends();
  setInterval(() => fs.tick(), 250);
  if (opt.add) {
    const found = await client.search(opt.add);
    const p = found.find((x) => x.name.toLowerCase() === opt.add!.toLowerCase()) ?? found[0];
    log(p ? `asking ${p.name}: ${fs.add(p) ?? "sent"}` : `${opt.add} isn't on the relay`);
  }
  if (opt.walk) void walk(opt.walk);
}

interface KeyFile {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
  store: Record<string, string>;
}

/** A new key each run, or the one in --keyfile (made extractable so it can be kept there) */
async function loadIdentity(): Promise<{ keys: CryptoKeyPair; store: Map<string, string> }> {
  if (!opt.keyfile) return { keys: await generateIdentity(), store: new Map() };
  const alg = { name: "ECDSA", namedCurve: "P-256" };
  if (existsSync(opt.keyfile)) {
    const f = JSON.parse(readFileSync(opt.keyfile, "utf8")) as KeyFile;
    const keys = {
      privateKey: await crypto.subtle.importKey("jwk", f.privateKey, alg, true, ["sign"]),
      publicKey: await crypto.subtle.importKey("jwk", f.publicKey, alg, true, ["verify"]),
    };
    log(`key from ${opt.keyfile}`);
    return { keys, store: new Map(Object.entries(f.store ?? {})) };
  }
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const store = new Map<string, string>();
  await saveIdentity(keys, store);
  return { keys, store };
}

async function saveIdentity(keys: CryptoKeyPair, store: Map<string, string>): Promise<void> {
  if (!opt.keyfile) return;
  const f: KeyFile = {
    privateKey: await crypto.subtle.exportKey("jwk", keys.privateKey),
    publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
    store: Object.fromEntries(store),
  };
  writeFileSync(opt.keyfile, JSON.stringify(f));
}

/** Walk the squares as the headless client does: a short step every 250 ms */
async function walk(path: string): Promise<void> {
  log(`walking in ${opt.wait} s`);
  await new Promise((r) => setTimeout(r, Number(opt.wait) * 1000));
  for (const pt of path.split(/\s+/)) {
    const [row, col] = pt.split(",").map(Number);
    const tx = (col - 0.5) * 1024,
      ty = (row - 0.5) * 1024;
    for (;;) {
      const self = session.world.self;
      if (!self) break;
      const dx = tx - self.x,
        dy = ty - self.y;
      const d = Math.hypot(dx, dy);
      if (d < 32) break;
      const step = Math.min(d, 256);
      self.x += (dx / d) * step;
      self.y += (dy / d) * step;
      session.requestMove(self.x, self.y, 25);
      await new Promise((r) => setTimeout(r, 250));
    }
    log(`at ${row},${col}`);
  }
  if (opt.go) {
    log("go");
    session.go();
  }
}

setTimeout(() => {
  log("done");
  session.close();
  process.exit(0);
}, Number(opt.stay) * 1000);
