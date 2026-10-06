// Run admin commands on the local blakserv through its maintenance port
// (localhost only). Commands end with CR, not LF (blakserv/maintenance.c).
//
//   node tools/maint/maint.ts "show object 7001" ["another command" ...]
//
// Never use it for "save game" against a server you care about without meaning to.

import { connect } from "node:net";

const PORT = Number(process.env.MAINT_PORT ?? 9998);
const cmds = process.argv.slice(2);
if (!cmds.length) {
  console.error('usage: node tools/maint/maint.ts "<command>" ...');
  process.exit(2);
}

const sock = connect({ host: "127.0.0.1", port: PORT });
let out = "";
sock.on("data", (d) => (out += d.toString("latin1")));
sock.on("error", (e) => {
  console.error(`maintenance port ${PORT}: ${e.message}`);
  process.exit(1);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
sock.on("connect", async () => {
  await sleep(300);
  out = "";
  for (const c of cmds) {
    sock.write(c + "\r");
    await sleep(700);
    process.stdout.write(`> ${c}\n${out.replace(/\r/g, "")}\n`);
    out = "";
  }
  sock.end();
});
