// WebSocket -> TCP gateway for blakserv. Bytes pass through unchanged in both
// directions; one TCP connection per WebSocket. blakserv only ever sees the
// gateway's address, so the gateway logs the real client IP and enforces a
// per-IP connection limit. TLS (wss://) is terminated in front of it (Caddy).
//
//   node tools/gateway/gateway.ts [--port 8059] [--server 127.0.0.1:5959] [--max-per-ip 4]
//
// Env equivalents: GATEWAY_PORT, BLAKSERV_ADDR, GATEWAY_MAX_PER_IP,
// GATEWAY_ORIGINS (comma-separated allowed Origin headers; empty = allow all),
// GATEWAY_TRUST_PROXY=1 (take the client IP from X-Forwarded-For).
//
// The path /arena is the arena's feed instead (arenaFeed.ts, docs/adr/0007-arena.md): JSON text
// frames, never reaching blakserv, with its own per-IP limit, the same number, so a player's two
// connections don't crowd each other out.
//
// The gateway runs the arena's fights (arena.ts):
// ARENA_ASSETS (the asset build with tosarena.roo, default dist/assets), ARENA_STATE (the season
// file, default dist/arena-state.json; "none" keeps nothing) and ARENA_CONFIG (an arena.json to
// change the fights, read at start).

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { parseArgs } from "node:util";
import { WebSocketServer } from "ws";
import { readArenaConfigs } from "@shards/world";
import { ArenaHost } from "./arena.ts";
import { ArenaFeed, FEED_MAX_MESSAGE } from "./arenaFeed.ts";

const { values: args } = parseArgs({
  options: {
    port: { type: "string" },
    server: { type: "string" },
    "max-per-ip": { type: "string" },
  },
});

const PORT = Number(args.port ?? process.env.GATEWAY_PORT ?? 8059);
const [SERVER_HOST, SERVER_PORT] = (args.server ?? process.env.BLAKSERV_ADDR ?? "127.0.0.1:5959").split(":");
const MAX_PER_IP = Number(args["max-per-ip"] ?? process.env.GATEWAY_MAX_PER_IP ?? 4);
const ORIGINS = (process.env.GATEWAY_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TRUST_PROXY = process.env.GATEWAY_TRUST_PROXY === "1";
/** The protocol's biggest frames are a few KB; anything far bigger is abuse. */
const MAX_MESSAGE = 1 << 20;

const perIp = new Map<string, number>();
const arenaPerIp = new Map<string, number>();
let nextId = 1;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const http = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Meridian Shards gateway. Connect with a WebSocket.\n");
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE,
  perMessageDeflate: false,
  handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false),
});

/** The arenas' settings by room: the defaults, with arena.json's changes (the Arena of Death's under "death") */
function arenaConfigs() {
  const path = process.env.ARENA_CONFIG;
  if (!path) return readArenaConfigs(undefined).configs;
  let json: unknown;
  try {
    json = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    if (json === undefined) log(`arena: no config at ${path}; the defaults`);
  } catch (e) {
    log(`arena: ${path} isn't JSON (${(e as Error).message}); the defaults`);
  }
  const { configs, errors } = readArenaConfigs(json);
  for (const e of errors) log(`arena: ${path}: ${e}`);
  return configs;
}

const statePath = process.env.ARENA_STATE ?? "dist/arena-state.json";
const configs = arenaConfigs();
const arena = new ArenaHost({
  config: configs["tosarena.roo"]!,
  configs,
  assetsDir: process.env.ARENA_ASSETS ?? "dist/assets",
  statePath: statePath === "none" ? null : statePath,
  log,
});
const feed = new ArenaFeed({ log, arena });
const feedWss = new WebSocketServer({ noServer: true, maxPayload: FEED_MAX_MESSAGE, perMessageDeflate: false });

/** One fewer connection from this address */
const release = (counts: Map<string, number>, ip: string) => {
  const n = (counts.get(ip) ?? 1) - 1;
  if (n <= 0) counts.delete(ip);
  else counts.set(ip, n);
};

http.on("upgrade", (req, socket, head) => {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = (TRUST_PROXY && fwd) || req.socket.remoteAddress || "?";
  // Unreal Meridian's WebSocket client (the engine's libwebsockets) sends its own Origin, the host,
  // before the one the game sets, so a request may carry two. A browser always sends exactly one,
  // so letting any allowed one through admits no page the list doesn't.
  const origins = req.headersDistinct.origin ?? [];
  if (ORIGINS.length && !origins.some((o) => ORIGINS.includes(o))) {
    log(`reject ${ip}: origin ${origins.join(" + ") || "(none)"}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const isArena = (req.url ?? "/").split("?")[0] === "/arena";
  const counts = isArena ? arenaPerIp : perIp;
  const count = counts.get(ip) ?? 0;
  if (count >= MAX_PER_IP) {
    log(`reject ${ip}: ${count} ${isArena ? "arena " : ""}connections already`);
    socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    return;
  }
  counts.set(ip, count + 1);

  if (isArena) {
    feedWss.handleUpgrade(req, socket, head, (ws) => {
      let open = true;
      const conn = feed.connect({
        send: (text) => ws.send(text),
        close: (code, reason) => ws.close(code, reason),
      });
      const finish = () => {
        if (!open) return;
        open = false;
        release(arenaPerIp, ip);
        conn.closed();
      };
      ws.on("message", (data, isBinary) => {
        if (isBinary) return ws.close(1003, "text only");
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        void conn.receive(buf.toString("utf8"));
      });
      ws.on("close", finish);
      ws.on("error", finish);
    });
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const id = nextId++;
    let up = 0,
      down = 0;
    log(`#${id} open from ${ip} -> ${SERVER_HOST}:${SERVER_PORT}`);

    const tcp = connect({ host: SERVER_HOST, port: Number(SERVER_PORT) });
    tcp.setNoDelay(true);
    const pending: Buffer[] = [];
    let tcpReady = false;
    let done = false;

    const finish = (why: string) => {
      if (done) return;
      done = true;
      release(perIp, ip);
      log(`#${id} closed (${why}); up ${up} B, down ${down} B`);
      tcp.destroy();
      ws.close(1000);
    };

    tcp.on("connect", () => {
      tcpReady = true;
      for (const p of pending) tcp.write(p);
      pending.length = 0;
    });
    tcp.on("data", (d) => {
      down += d.length;
      ws.send(d, { binary: true });
    });
    tcp.on("close", () => finish("server closed"));
    tcp.on("error", (e) => finish(`server error: ${e.message}`));

    ws.on("message", (data, isBinary) => {
      if (!isBinary) return finish("text frame");
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      up += buf.length;
      if (tcpReady) tcp.write(buf);
      else pending.push(buf);
    });
    ws.on("close", () => finish("client closed"));
    ws.on("error", (e) => finish(`client error: ${e.message}`));
  });
});

http.listen(PORT, () => {
  log(`gateway listening on ws://localhost:${PORT} -> ${SERVER_HOST}:${SERVER_PORT} (max ${MAX_PER_IP}/IP), the arena's feed on /arena`);
});

// The arena's season is saved before going (docker stop sends SIGTERM)
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.once(sig, () => {
    void arena.stop().finally(() => process.exit(0));
  });
