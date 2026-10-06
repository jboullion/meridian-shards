// Headless protocol client for the milestone 0 spike. Logs in through the
// gateway, creates a character if the account has none, enters the game,
// prints BP_PLAYER / BP_ROOM_CONTENTS, optionally walks a path of squares and
// stays connected for a while (to soak-test the LCG + redbook handling).
//
//   node tools/headless/client.ts --user shardbot --pass secret [--char Shardbot]
//        [--url ws://localhost:8059] [--key <SecretKey>] [--rsb <path to rsc0000.rsb>]
//        [--walk "row,col row,col ..."] [--go] [--loop] [--stay 300] [--say "hello"] [--verbose]
//
// --walk takes 1-based grid squares (Kod coordinates / 64): "8,7" is the centre of
// square (8,7), "9.1,7.5" an exact spot. Moves are sent like the original client: at
// most every 250 ms, a short step each time. If the server snaps us back (the spot
// is outside the room), that waypoint is skipped. --go sends BP_REQ_GO (use a door /
// exit on the current square) after the walk. --loop walks the path back and forth
// until --stay runs out (soak test).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb, type RsbBundle } from "../../packages/formats/src/rsb.ts";
import {
  AP, BP, ByteReader, Connection, GENDER, KOD_FINENESS, SPEED_WALK, apName, bpName,
  buildLogin, buildNewCharInfo, buildReqGame, buildReqMove, buildSay, buildSimple, buildUseCharacter,
  passwordDigest, readCharacters, readMove, readPlayer, readRoomContents, readRoomObject,
  type PlayerInfo, type RoomObject,
} from "../../packages/protocol/src/index.ts";

const { values: opt } = parseArgs({
  options: {
    url: { type: "string", default: "ws://localhost:8059" },
    user: { type: "string", default: "shardbot" },
    pass: { type: "string", default: "shardbot" },
    char: { type: "string" },
    key: { type: "string" },
    rsb: { type: "string", default: "server/src/run/server/rsc/rsc0000.rsb" },
    walk: { type: "string" },
    go: { type: "boolean", default: false },
    loop: { type: "boolean", default: false },
    stay: { type: "string", default: "10" },
    say: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});

const SECRET_KEY = opt.key ?? readSecretKey();
const rsb: RsbBundle = parseRsb(readFileSync(opt.rsb!));
/** Dynamic resources (player names etc.) arrive in BP_CHANGE_RESOURCE. */
const dynamicRsc = new Map<number, string>();
const rs = (id: number) => (id ? (dynamicRsc.get(id) ?? rsb.get(id) ?? `#${id}`) : "-");
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

function readSecretKey(): string {
  const cfg = readFileSync(new URL("../../server/config/blakserv.cfg", import.meta.url), "utf8");
  const m = /^SecretKey\s+(\S+)/m.exec(cfg);
  if (!m) throw new Error("no SecretKey in server/config/blakserv.cfg; pass --key");
  return m[1];
}

// ------------------------------------------------------------------ world state

let player: PlayerInfo | undefined;
const room = new Map<number, RoomObject>();
let me: { row: number; col: number } | undefined; // Kod fine units, 1-based
let roomChanges = 0;
const roomsVisited: string[] = [];
let path: { row: number; col: number }[] = (opt.walk ?? "")
  .split(/\s+/)
  .filter(Boolean)
  .map((p) => {
    // "8,7" = centre of square (8,7); "9.1,7.5" = that exact spot (squares + fraction)
    const toFine = (v: string) => Math.round((v.includes(".") ? Number(v) : Number(v) + 0.5) * KOD_FINENESS);
    const [r, c] = p.split(",");
    return { row: toFine(r), col: toFine(c) };
  });
const fullPath = [...path];
let walkTimer: ReturnType<typeof setInterval> | undefined;
let walking = false;
let sayTimer: ReturnType<typeof setInterval> | undefined;
let finished = false;

// ------------------------------------------------------------------ connection

const ws = new WebSocket(opt.url!, ["binary"]);
ws.binaryType = "arraybuffer";
const conn = new Connection((b) => ws.send(b as Uint8Array<ArrayBuffer>), {
  state: (s) => log(`state -> ${s}`),
  error: (e) => {
    log("protocol error:", e.message);
    exit(1);
  },
  message: (type, r, state) => (state === "login" ? onLogin(type, r) : onGame(type, r)),
});

conn.token.lookup = (id) => rsb.get(id);

ws.onopen = () => {
  log(`connected to ${opt.url}`);
  conn.start();
};
ws.onmessage = (ev) => conn.receive(new Uint8Array(ev.data as ArrayBuffer));
ws.onclose = () => {
  log("socket closed");
  exit(finished ? 0 : 1);
};
ws.onerror = () => log("socket error");

function onLogin(type: number, r: ByteReader): void {
  if (opt.verbose) log(`<- ${apName(type)} (${r.buf.length} B)`);
  switch (type) {
    case AP.GETLOGIN:
      log(`login as ${opt.user}`);
      conn.sendLogin(buildLogin({ username: opt.user!, passwordDigest: passwordDigest(opt.pass!), secretKey: SECRET_KEY }));
      break;
    case AP.LOGINOK:
      log(`login ok (account type ${r.u8()})`);
      break;
    case AP.LOGINFAILED:
      log("login failed: wrong password?");
      exit(1);
      break;
    case AP.MESSAGE:
      log(`server message: ${r.string()} (action ${r.u8()})`);
      break;
    case AP.GETCHOICE:
      if (finished) return; // back at the menu after BP_QUIT
      log("got seeds (AP_GETCHOICE); requesting game");
      conn.sendLogin(buildReqGame());
      break;
    case AP.NOCHARACTERS:
      log("account has no character slots");
      exit(1);
      break;
    case AP.GAME:
      log("entering game");
      break;
    default:
      if (!opt.verbose) log(`<- ${apName(type)} (unhandled)`);
  }
}

function onGame(type: number, r: ByteReader): void {
  if (opt.verbose) log(`<- ${bpName(type)} (${r.buf.length} B)`);
  switch (type) {
    case BP.ECHO_PING: {
      const b = r.u8();
      const id = r.u32();
      if (opt.verbose) log(`   echo: token ${b ^ 0xed}, redbook #${id} = ${JSON.stringify(rs(id))}`);
      break;
    }
    case BP.LOAD_MODULE: {
      const name = rs(r.u32());
      log(`load module ${name}`);
      if (/char/i.test(name)) conn.sendGame(buildSimple(BP.SEND_CHARACTERS));
      break;
    }
    case BP.CHARACTERS: {
      const { characters, motd } = readCharacters(r);
      log(`characters: ${characters.map((c) => `${c.name || "(new)"}#${c.id}${c.flags === 1 ? "*" : ""}`).join(", ")}`);
      if (motd) log(`motd: ${motd.split("\n")[0]}`);
      const wanted = opt.char ?? capitalise(opt.user!);
      const existing = characters.find((c) => c.flags !== 1 && c.name.toLowerCase() === wanted.toLowerCase())
        ?? characters.find((c) => c.flags !== 1);
      if (existing) {
        log(`using character ${existing.name}`);
        conn.sendGame(buildUseCharacter(existing.id));
        break;
      }
      const slot = characters.find((c) => c.flags === 1);
      if (!slot) {
        log("no usable character slot");
        exit(1);
        break;
      }
      log(`creating character ${wanted} in slot #${slot.id}`);
      conn.sendGame(
        buildNewCharInfo({
          id: slot.id, name: wanted, description: "A visitor from another shard.", gender: GENDER.MALE,
          faceParts: [], hairTranslation: 0, skinTranslation: 3,
          stats: [35, 35, 35, 35, 35, 35], spells: [], skills: [],
        }),
      );
      break;
    }
    case BP.CHARINFO_OK: {
      const id = r.u32();
      log(`character created (#${id}); entering`);
      conn.sendGame(buildUseCharacter(id));
      break;
    }
    case BP.CHARINFO_NOT_OK:
      log("character creation refused (name taken or invalid?) - try --char <Name>");
      exit(1);
      break;
    case BP.PLAYER: {
      const prev = player?.roomId;
      player = readPlayer(r);
      const name = rs(player.roomNameRes);
      if (prev !== undefined && prev !== player.roomId) roomChanges++;
      roomsVisited.push(name);
      log(`BP_PLAYER: I am ${rs(player.nameRes)} #${player.id}; room "${name}" (roo ${rs(player.roomRes)}, room obj #${player.roomId}, security ${player.roomSecurity}, ambient ${player.ambientLight}, player light ${player.playerLight}, bg ${rs(player.backgroundRes)})`);
      break;
    }
    case BP.ROOM_CONTENTS: {
      const rc = readRoomContents(r);
      room.clear();
      for (const o of rc.objects) room.set(o.id, o);
      const self = player ? room.get(player.id) : undefined;
      if (self) me = { row: self.kodRow, col: self.kodCol };
      log(`BP_ROOM_CONTENTS: ${rc.objects.length} objects; me at ${fmt(me)}`);
      if (opt.verbose) for (const o of rc.objects) log(`   #${o.id} ${rs(o.nameRes)} at ${fmt({ row: o.kodRow, col: o.kodCol })}`);
      afterRoomLoaded();
      break;
    }
    case BP.CREATE: {
      const o = readRoomObject(r);
      room.set(o.id, o);
      if (opt.verbose) log(`created ${rs(o.nameRes)} #${o.id}`);
      break;
    }
    case BP.REMOVE:
      room.delete(r.u32());
      break;
    case BP.MOVE: {
      const m = readMove(r);
      const o = room.get(m.id);
      if (o) {
        o.kodRow = m.kodRow;
        o.kodCol = m.kodCol;
      }
      if (player && m.id === player.id) {
        me = { row: m.kodRow, col: m.kodCol };
        log(`server moved me to ${fmt(me)}`);
        if (walking && path.length) {
          log(`  blocked: skipping waypoint ${fmt(path[0])}`);
          path.shift();
        }
      }
      break;
    }
    case BP.LIGHT_SHADING: {
      log(`BP_LIGHT_SHADING: intensity ${r.u8()}, sun angle ${r.u16()}, ${r.u16()}`);
      break;
    }
    case BP.LIGHT_AMBIENT:
      log(`BP_LIGHT_AMBIENT: ${r.u8()}`);
      break;
    case BP.CHANGE_RESOURCE: {
      const id = r.u32();
      dynamicRsc.set(id, r.string());
      break;
    }
    case BP.QUIT:
      log("server sent BP_QUIT");
      break;
    case BP.RESYNC:
      log("server asked for RESYNC (security or framing error)");
      break;
    default:
      break;
  }
}

let started = false;
function afterRoomLoaded(): void {
  if (started) return;
  started = true;
  if (opt.say) {
    conn.sendGame(buildSay(opt.say));
    sayTimer = setInterval(() => conn.sendGame(buildSay(opt.say!)), 3000);
  }
  if (path.length) startWalking();
  const stayMs = Number(opt.stay) * 1000;
  log(`staying connected for ${opt.stay}s (pings every 5 s)`);
  setTimeout(done, stayMs);
}

/** Step towards each waypoint, sending REQ_MOVE every 250 ms like clientd3d/move.c. */
function startWalking(): void {
  const STEP = 24; // Kod units per 250 ms: a bit under the original walk rate
  walking = true;
  walkTimer = setInterval(() => {
    if (!me || !player) return;
    if (path.length === 0 && opt.loop) {
      // walk the path back and forth for soak tests
      fullPath.reverse();
      path = [...fullPath];
      return;
    }
    if (path.length === 0) {
      clearInterval(walkTimer);
      walking = false;
      log(`walk finished at ${fmt(me)}`);
      if (opt.go) {
        log("-> BP_REQ_GO");
        conn.sendGame(buildSimple(BP.REQ_GO));
      }
      return;
    }
    const target = path[0];
    const dr = target.row - me.row;
    const dc = target.col - me.col;
    const dist = Math.hypot(dr, dc);
    if (dist <= STEP) {
      me = { ...target };
      path.shift();
    } else {
      me = { row: Math.round(me.row + (dr / dist) * STEP), col: Math.round(me.col + (dc / dist) * STEP) };
    }
    conn.sendGame(buildReqMove(me.row, me.col, SPEED_WALK, player.roomId));
  }, 250);
}

function done(): void {
  finished = true;
  clearInterval(sayTimer);
  clearInterval(walkTimer);
  log(
    `done: ${conn.stats.received} msgs in, ${conn.stats.sent} out, ${conn.stats.pings} pings / ${conn.stats.echoes} echoes, ` +
      `${roomChanges} room change(s); rooms: ${roomsVisited.join(" -> ")}`,
  );
  conn.sendGame(buildSimple(BP.REQ_QUIT));
  setTimeout(() => ws.close(), 300);
}

function exit(code: number): void {
  conn.close();
  clearInterval(walkTimer);
  if (ws.readyState === WebSocket.OPEN) ws.close();
  setTimeout(() => process.exit(code), 50);
}

function fmt(p?: { row: number; col: number }): string {
  if (!p) return "?";
  return `row ${(p.row / KOD_FINENESS).toFixed(2)}, col ${(p.col / KOD_FINENESS).toFixed(2)}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
