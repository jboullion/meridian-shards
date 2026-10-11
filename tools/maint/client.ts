// The local blakserv's maintenance port (localhost only): send admin commands, read the
// replies. Commands end with CR, not LF (blakserv/maintenance.c). The port answers only
// from the machine itself (MaintenanceMask 127.0.0.1 in the server's config).

import { connect } from "node:net";
import { MAINT_PORT } from "../shardsServer.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the commands in order and returns each one's reply (CRs removed). */
export function maintCommands(cmds: readonly string[], port = Number(process.env.MAINT_PORT ?? MAINT_PORT)): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: "127.0.0.1", port });
    let out = "";
    const replies: string[] = [];
    sock.on("data", (d) => (out += d.toString("latin1")));
    sock.on("error", (e) => reject(new Error(`maintenance port ${port}: ${e.message}`)));
    sock.on("connect", async () => {
      await sleep(300);
      out = "";
      for (const c of cmds) {
        sock.write(c + "\r");
        await sleep(700);
        replies.push(out.replace(/\r/g, ""));
        out = "";
      }
      sock.end();
      resolve(replies);
    });
  });
}
