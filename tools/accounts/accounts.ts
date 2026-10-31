// The account service (docs/adr/0030-account-recovery.md): POST /api/account/<route> with a JSON
// body, answered with JSON {ok, message?, ...}. The routes are service.ts's. It talks to blakserv
// over the maintenance port, which only takes connections from 127.0.0.1, so on the VM it shares
// blakserv's network (deploy/docker-compose.yml) and Caddy proxies /api/account/* to it.
//
//   node tools/accounts/accounts.ts
//
// Env: ACCOUNTS_PORT (8060), ACCOUNTS_SECRET (the links' HMAC key; required in production),
// SITE_URL (origin used in emails, default http://localhost:5173), MAINT_PORT (9998),
// RESEND_API_KEY + MAIL_FROM (without a key, emails are printed), TURNSTILE_SECRET (without it,
// no bot check), ACCOUNTS_TRUST_PROXY=1 (client IP from X-Forwarded-For),
// ACCOUNTS_ORIGINS (comma-separated origins allowed cross-origin, for local site dev),
// ACCOUNTS_START_DELAY_MS (wait before the first command: blakserv once hung on a maintenance
// command in its first minute, deploy/README.md).

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Blakserv, maintRunner } from "./blakserv.ts";
import { consoleMailer, resendMailer } from "./mail.ts";
import { createService } from "./service.ts";

const PORT = Number(process.env.ACCOUNTS_PORT ?? 8060);
const PROD = process.env.NODE_ENV === "production";
const SECRET = process.env.ACCOUNTS_SECRET ?? "";
if (PROD && SECRET.length < 32) {
  console.error("ACCOUNTS_SECRET must be set (32+ characters) in production");
  process.exit(1);
}
const TRUST_PROXY = process.env.ACCOUNTS_TRUST_PROXY === "1";
const ORIGINS = (process.env.ACCOUNTS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const START_DELAY = Number(
  process.env.ACCOUNTS_START_DELAY_MS ?? (PROD ? 60_000 : 0),
);
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET ?? "";
/** Request bodies are a few small fields */
const MAX_BODY = 4096;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const started = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const service = createService({
  blakserv: new Blakserv(async (command) => {
    const wait = started + START_DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    return maintRunner(command);
  }),
  mail: process.env.RESEND_API_KEY
    ? resendMailer(
        process.env.RESEND_API_KEY,
        process.env.MAIL_FROM ?? "Meridian Shards <noreply@m59-shards.com>",
      )
    : consoleMailer,
  // Without a configured key the links still work, but only until the service restarts
  secret: SECRET || randomBytes(32).toString("hex"),
  siteUrl: (process.env.SITE_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  turnstile: TURNSTILE_SECRET
    ? async (token, ip) => {
        const res = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: TURNSTILE_SECRET,
              response: token,
              remoteip: ip,
            }),
          },
        );
        return (
          res.ok &&
          ((await res.json()) as { success?: boolean }).success === true
        );
      }
    : undefined,
});

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (TRUST_PROXY && typeof fwd === "string" && fwd)
    return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "?";
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((done) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (d: Buffer) => {
      size += d.length;
      if (size > MAX_BODY) {
        done(null);
        req.destroy();
      } else parts.push(d);
    });
    req.on("end", () => done(Buffer.concat(parts).toString("utf8")));
    req.on("error", () => done(null));
  });
}

const http = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (origin && ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "content-type";
    headers["vary"] = "Origin";
  }
  const send = (status: number, body: unknown) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const m = /^\/api\/account\/([a-z]+)$/.exec(req.url?.split("?")[0] ?? "");
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }
  if (!m || req.method !== "POST")
    return send(404, { ok: false, message: "No such request." });

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw === null ? null : JSON.parse(raw);
  } catch {
    body = null;
  }
  const ip = clientIp(req);
  try {
    const r = await service.handle(m[1]!, body, ip);
    if (r.status !== 200) log(ip, m[1], r.status);
    send(r.status, r.body);
  } catch (e) {
    log(ip, m[1], "failed:", (e as Error).message);
    send(503, {
      ok: false,
      message:
        "The account service can't reach the game server right now. Try again later.",
    });
  }
});

http.listen(PORT, () =>
  log(`account service on :${PORT} (routes: ${service.routes.join(", ")})`),
);
