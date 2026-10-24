// Temporary (guild revamp phase 4 tuning): log in the given accounts, wait until each is in
// guildh13.roo, then all fight the nearest attackable monster for up to --secs. Prints each
// body's fight summary. Delete after use.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { GameData } from "./assets.ts";
import { HeadlessBody } from "./headless.ts";
import { sleep } from "./body.ts";
import * as act from "./actions.ts";
import { OF } from "./describe.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values: opt } = parseArgs({ options: { users: { type: "string" }, secs: { type: "string", default: "300" } } });
const data = new GameData({
  assetsDir: join(ROOT, "dist", "assets"),
  rsbPath: join(ROOT, "server", "src", "run", "server", "rsc", "rsc0000.rsb"),
  configPath: join(ROOT, "server", "config", "blakserv.cfg"),
});
const users = opt.users!.split(",");
const bodies = users.map((u) => new HeadlessBody({ gateway: "ws://localhost:8059", user: u, password: u }, data));
for (const b of bodies) await b.connect();
console.log("READY");
// Wait for the harness to put everyone in the sanctum and write the go file
const GO = process.env.BOSSFIGHT_GO!;
while (!existsSync(GO)) await sleep(300);
await sleep(3000);
const t0 = Date.now();
const results = await Promise.all(
  bodies.map(async (b, i) => {
    const foe = act.nearest(b, (o) => (o.info.flags & OF.ATTACKABLE) !== 0 && (o.info.flags & OF.PLAYER) === 0);
    if (!foe) return `${users[i]}: no foe in sight`;
    const r = await act.fight(b, foe.id, Number(opt.secs), 0);
    return `${users[i]} after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${r.split("\n")[0]}`;
  }),
);
for (const r of results) console.log(r);
for (const b of bodies) b.disconnect();
process.exit(0);
