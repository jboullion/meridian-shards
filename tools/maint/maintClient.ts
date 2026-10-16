// Admin commands on the local blakserv, through its maintenance port (localhost only;
// commands end with CR, not LF: blakserv/maintenance.c). One connection per call; each
// command's output is what arrived until it stopped growing, so long commands (reload system)
// are waited for. Shared by maint.ts and the admin dashboard's dev server (tools/dev/adminApi.ts).
// meridian-editor's apps/editor/src/main/shardsServer.ts does the same for the editor.

import { connect } from "node:net";

const PORT = Number(process.env.MAINT_PORT ?? 9998);
/** How long the output must stay still to count as finished, and the most a command may take */
const SETTLE_MS = 150;
const LONGEST_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the commands in order on one connection; each one's output, CRs removed */
export function maint(...commands: string[]): Promise<string[]> {
  return new Promise((done, fail) => {
    const sock = connect({ host: "127.0.0.1", port: PORT });
    let out = "";
    const results: string[] = [];
    sock.on("data", (d) => (out += d.toString("latin1")));
    sock.on("error", (e) => fail(new Error(`maintenance port ${PORT}: ${e.message}. Is blakserv running?`)));
    sock.on("connect", () => {
      void (async () => {
        // The greeting comes first; it isn't any command's output
        await sleep(SETTLE_MS);
        out = "";
        for (const c of commands) {
          sock.write(c + "\r");
          let last = -1;
          for (let waited = 0; waited < LONGEST_MS && (out.length === 0 || out.length !== last); waited += SETTLE_MS) {
            last = out.length;
            await sleep(SETTLE_MS);
          }
          results.push(out.replace(/\r/g, ""));
          out = "";
        }
        sock.end();
        done(results);
      })();
    });
  });
}

/** The object a `send object` returned (": OBJECT 123"), or null */
export function returnedObject(output: string): number | null {
  const m = /^: OBJECT (\d+)/m.exec(output);
  return m ? Number(m[1]) : null;
}

/** The int a `send object` returned (": INT 3"), or null */
export function returnedInt(output: string): number | null {
  const m = /^: INT (-?\d+)/m.exec(output);
  return m ? Number(m[1]) : null;
}
