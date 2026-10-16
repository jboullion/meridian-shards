// A scripted friend (docs/adr/0005-friends.md, on our server since docs/adr/0015), for trying the
// friends feature with one person: a character in the game (GameSession) that accepts any friend
// request, can ask someone itself, keeps a pet, and can walk a path and use a door. Our server
// tells its friends where it is and its followers which way it went; it only asks the server to
// send its health, as the client does (apps/client social.ts).
//
//   node tools/headless/friend.ts --user shardpal --pass shardpal [--add Shardbot] [--follow Shardbot]
//        [--pet kind:colour[:name]]
//        [--walk "row,col row,col ..."] [--go] [--wait 20] [--stay 120] [--gateway ws://localhost:8059]
//
// --walk waits --wait seconds first (time to start following), then walks the squares and, with
// --go, sends BP_REQ_GO at the end. --follow asks to follow a friend once they're in the game
// (the walking is the browser's; this logs the exits the server says they take).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";
import { STAT_GROUP } from "../../packages/protocol/src/index.ts";
import { FriendsService, GameSession, exitTaken, type AmbientExits } from "../../packages/world/src/index.ts";

const { values: opt } = parseArgs({
  options: {
    user: { type: "string", default: "shardpal" },
    pass: { type: "string", default: "shardpal" },
    gateway: { type: "string", default: "ws://localhost:8059" },
    rsb: { type: "string", default: "server/src/run/server/rsc/rsc0000.rsb" },
    add: { type: "string" },
    follow: { type: "string" },
    pet: { type: "string" },
    walk: { type: "string" },
    go: { type: "boolean", default: false },
    wait: { type: "string", default: "20" },
    stay: { type: "string", default: "120" },
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
  log("no dist/assets/roomexits.json: exits can't be named");
}

const OF_PLAYER = 0x4;
let friends: FriendsService | null = null;
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
    social: (e) => {
      log("social:", JSON.stringify(e));
      if (e.type !== "pets" && e.type !== "ambient") friends?.handle(e);
    },
  },
);

const name = () => {
  const self = session.world.self;
  return self ? (session.resource(self.info.nameRes) ?? "") : "";
};

async function startFriends(): Promise<void> {
  while (!name()) await new Promise((r) => setTimeout(r, 100));
  log(`in the game as ${name()}`);
  const store = new Map<string, string>();
  const fs = new FriendsService({
    command: (line) => {
      log(">", line);
      session.shardsCommand(line);
    },
    message: (t) => log("friends:", t),
    now: () => Date.now(),
    exitTaken: (from, to, at) => exitTaken(exits[from], from, to, at, null),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    storageKey: "friends",
  });
  friends = fs;
  // Accept whoever asks; a new friend in the room hears our health
  let followAsked = false;
  fs.onChange(() => {
    const lead = opt.follow ? fs.friendByName(opt.follow) : undefined;
    if (lead && !followAsked && fs.online.has(lead.key)) {
      followAsked = true;
      log(`following ${lead.name}: ${fs.startFollow(lead.key) ?? "asked"}`);
    }
    for (const r of fs.incoming) {
      log(`accepting ${r.name}`);
      fs.accept(r.key);
    }
    roomFriends();
  });
  fs.onEvent((e) => log("follow:", JSON.stringify(e)));
  fs.start();
  const world = session.world;
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
    if (e.type === "roomContents" || e.type === "objectAdded" || e.type === "objectRemoved") roomFriends();
    if (e.type === "stats" && e.group === STAT_GROUP.MAIN) health();
  });
  health();
  roomFriends();
  setInterval(() => fs.tick(), 250);
  if (opt.pet) {
    const [kind, colour, ...petName] = opt.pet.split(":");
    session.shardsCommand(`pet set ${kind} ${Number(colour) || 0}${petName.length ? ` ${petName.join(":")}` : ""}`);
  }
  if (opt.add) log(`asking ${opt.add}: ${fs.add(opt.add, name()) ?? "sent"}`);
  if (opt.walk) void walk(opt.walk);
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
