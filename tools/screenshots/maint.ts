// A long-lived client for the local blakserv maintenance port (tools/maint/maint.ts is the
// one-shot command line version). Commands end with CR; an answer is whatever arrives until
// the port goes quiet.

import { connect, type Socket } from "node:net";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Maint {
  private out = "";
  private sock: Socket;
  private constructor(sock: Socket) {
    this.sock = sock;
    sock.on("data", (d) => (this.out += d.toString("latin1")));
  }

  static async open(port = Number(process.env.MAINT_PORT ?? 9998)): Promise<Maint> {
    const sock = connect({ host: "127.0.0.1", port });
    await new Promise<void>((ok, fail) => {
      sock.once("connect", () => ok());
      sock.once("error", (e) => fail(new Error(`maintenance port ${port}: ${e.message} (is npm run dev up?)`)));
    });
    const m = new Maint(sock);
    await sleep(300);
    m.out = "";
    return m;
  }

  /** Sends one command and returns its answer (without the echo). */
  async run(cmd: string): Promise<string> {
    this.out = "";
    this.sock.write(cmd + "\r");
    // Wait for a first answer, then until nothing more arrives for a moment
    for (let waited = 0; !this.out && waited < 3000; waited += 50) await sleep(50);
    let len = -1;
    while (len !== this.out.length) {
      len = this.out.length;
      await sleep(150);
    }
    return this.out.replace(/\r/g, "").replace(/^> .*\n/gm, "").trim();
  }

  /** The object number in a "show user", "create object" or similar answer. */
  async objectId(cmd: string, pattern: RegExp): Promise<number> {
    const answer = await this.run(cmd);
    const m = pattern.exec(answer);
    if (!m) throw new Error(`no object number from "${cmd}":\n${answer}`);
    return Number(m[1]);
  }

  /** A property of an object, from "show object". */
  async property(id: number, name: string): Promise<string | null> {
    const answer = await this.run(`show object ${id}`);
    const m = new RegExp(`^[:\\s]*${name}\\s*=\\s*(.+)$`, "mi").exec(answer);
    return m ? m[1]!.trim() : null;
  }

  close() {
    this.sock.end();
  }
}
