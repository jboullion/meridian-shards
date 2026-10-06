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

import { createServer } from "node:http";
import { connect } from "node:net";
import { parseArgs } from "node:util";
import { acceptWebSocket } from "./ws.ts";

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

const perIp = new Map<string, number>();
let nextId = 1;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const http = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Meridian Shards gateway. Connect with a WebSocket.\n");
});

http.on("upgrade", (req, socket, head) => {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = (TRUST_PROXY && fwd) || req.socket.remoteAddress || "?";
  const origin = req.headers.origin ?? "";
  if (ORIGINS.length && !ORIGINS.includes(origin)) {
    log(`reject ${ip}: origin ${origin || "(none)"}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const count = perIp.get(ip) ?? 0;
  if (count >= MAX_PER_IP) {
    log(`reject ${ip}: ${count} connections already`);
    socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    return;
  }

  const ws = acceptWebSocket(req, socket, head);
  if (!ws) return;
  const id = nextId++;
  perIp.set(ip, count + 1);
  let up = 0,
    down = 0;
  log(`#${id} open from ${ip} -> ${SERVER_HOST}:${SERVER_PORT}`);

  const tcp = connect({ host: SERVER_HOST, port: Number(SERVER_PORT) });
  tcp.setNoDelay(true);
  const pending: Uint8Array[] = [];
  let tcpReady = false;
  let done = false;

  const finish = (why: string) => {
    if (done) return;
    done = true;
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
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
    ws.sendBinary(d);
  });
  tcp.on("close", () => finish("server closed"));
  tcp.on("error", (e) => finish(`server error: ${e.message}`));

  ws.onMessage = (data) => {
    up += data.length;
    if (tcpReady) tcp.write(data);
    else pending.push(data);
  };
  ws.onClose = () => finish("client closed");
});

http.listen(PORT, () => {
  log(`gateway listening on ws://localhost:${PORT} -> ${SERVER_HOST}:${SERVER_PORT} (max ${MAX_PER_IP}/IP)`);
});
