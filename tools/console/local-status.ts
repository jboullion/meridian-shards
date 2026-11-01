// The local stack at a glance, for the Shards Console (ADR 0031): which of blakserv's ports, the
// gateway and Vite listen, blakserv's `show status` and `who`, and the tail of the run folder's
// channel/error.txt. Prints one JSON object.
//
//   node tools/console/local-status.ts

import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maint } from "../maint/maintClient.ts";
import { inGame, parseStatus, parseWho, type ServerStatus } from "./blakserv.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ERRORS = join(ROOT, "server", "src", "run", "server", "channel", "error.txt");
const PORTS = { game: 5959, maintenance: 9998, gateway: 8059, client: 5173 } as const;

export interface LocalStatus {
  at: string;
  ports: Record<keyof typeof PORTS, boolean>;
  server: ServerStatus | null;
  players: { account: string; room: string; rid: number }[];
  errors: { lines: number; tail: string[] } | null;
}

function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const sock = connect({ host: "127.0.0.1", port });
    sock.setTimeout(1000);
    sock.on("connect", () => (sock.destroy(), done(true)));
    sock.on("timeout", () => (sock.destroy(), done(false)));
    sock.on("error", () => done(false));
  });
}

function errorTail(): LocalStatus["errors"] {
  if (!existsSync(ERRORS)) return null;
  const lines = readFileSync(ERRORS, "latin1").split(/\r?\n/).filter((l) => l.trim());
  return { lines: lines.length, tail: lines.slice(-20) };
}

export async function localStatus(): Promise<LocalStatus> {
  const entries = await Promise.all(Object.entries(PORTS).map(async ([name, port]) => [name, await listening(port)] as const));
  const ports = Object.fromEntries(entries) as LocalStatus["ports"];
  let server: ServerStatus | null = null;
  let players: LocalStatus["players"] = [];
  if (ports.maintenance) {
    try {
      const [status = "", who = ""] = await Promise.race([
        maint("show status", "who"),
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error("timed out")), 10_000)),
      ]);
      server = parseStatus(status);
      players = inGame(parseWho(who)).map((p) => ({ account: p.account, room: p.room!, rid: p.rid! }));
    } catch {
      // blakserv is loading or busy: the ports say enough
    }
  }
  return { at: new Date().toISOString(), ports, server, players, errors: errorTail() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await localStatus(), null, 2));
  process.exit(0);
}
