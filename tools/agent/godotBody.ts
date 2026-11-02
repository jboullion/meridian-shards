// The agent's body in the Godot client, meridian-godot (its phase 5c; docs/adr/0020-ai-playtester.md): we start
// its client.tscn with --agent-port, it logs in itself (the account from MR_AGENT_USER and MR_AGENT_PASSWORD, not
// on its command line) and answers the game tools on its own session, in the same words as play.ts, over a line of
// JSON a call on 127.0.0.1 ({id, call, args} out, {id, ok, text} back; meridian-godot's agent_server.gd). Screenshots
// come from its window: with the interface, or (hud false) the 3D view alone.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import type { PlayContext } from "./play.ts";

export interface GodotOptions {
  /** The meridian-godot checkout */
  dir: string;
  user: string;
  password: string;
  /** The character to pick (the client's first when not given) */
  character?: string;
  /** The port the client listens on for us */
  port: number;
  /** The client's window, "1280x720" */
  resolution: string;
}

const EXE = join("build", "godot", "bin", "Godot_v4.7.2-stable_win64_console.exe");
const START_MS = 90_000;
const CALL_MS = 180_000;

type Answer = { id: number; ok: boolean; text: string; context?: PlayContext; png?: string };

export class GodotBody {
  readonly opts: GodotOptions;
  private proc: ChildProcess | null = null;
  private sock: Socket | null = null;
  private buffer = "";
  private nextId = 1;
  private waiting = new Map<number, (a: Answer) => void>();
  /** The client's last lines, for an error when it doesn't come up */
  private said: string[] = [];

  constructor(opts: GodotOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return !!this.sock && !this.sock.destroyed;
  }

  /** Starts the client, waits for its port and for it to be in the game */
  async connect(): Promise<void> {
    if (this.connected) throw new Error("Already connected.");
    const { dir, user, password, character, port, resolution } = this.opts;
    const exe = join(dir, EXE);
    if (!existsSync(exe)) throw new Error(`No Godot at ${exe}: give --godot the meridian-godot checkout.`);
    const args = ["--path", join(dir, "project"), "--windowed", "--resolution", resolution, "res://client.tscn", "--", "--auto", "--agent-port", String(port)];
    if (character) args.push("--play-as", character);
    this.said = [];
    const proc = spawn(exe, args, { env: { ...process.env, MR_AGENT_USER: user, MR_AGENT_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    const keep = (b: Buffer) => {
      for (const line of b.toString().split(/\r?\n/)) if (line.trim()) this.said.push(line.trim());
      if (this.said.length > 40) this.said.splice(0, this.said.length - 40);
    };
    proc.stdout!.on("data", keep);
    proc.stderr!.on("data", keep);
    proc.on("exit", () => {
      this.proc = null;
      this.sock?.destroy();
    });
    const deadline = Date.now() + START_MS;
    try {
      while (!this.connected) {
        if (!this.proc) throw new Error("The client quit while starting.");
        if (Date.now() > deadline) throw new Error("The client's port didn't open.");
        await this.open(port).catch(() => new Promise((r) => setTimeout(r, 500)));
      }
      while (!(await this.context()).inGame) {
        if (!this.proc) throw new Error("The client quit while logging in.");
        const failed = this.said.find((l) => l.startsWith("MRG: FAIL"));
        if (failed) throw new Error(failed.slice(5));
        if (Date.now() > deadline) throw new Error("The client didn't get into the game.");
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      const tail = this.said.filter((l) => l.startsWith("MRG:")).slice(-6).join("\n");
      await this.disconnect();
      throw new Error(`${(e as Error).message}${tail ? `\n${tail}` : ""}`, { cause: e });
    }
  }

  private open(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        this.sock = sock;
        sock.setNoDelay(true);
        resolve();
      });
      sock.once("error", reject);
      sock.on("data", (b) => this.read(b.toString("utf8")));
      sock.on("close", () => {
        if (this.sock === sock) this.sock = null;
        for (const done of this.waiting.values()) done({ id: 0, ok: false, text: "The client went away." });
        this.waiting.clear();
      });
    });
  }

  private read(s: string): void {
    this.buffer += s;
    for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (!line.trim()) continue;
      const a = JSON.parse(line) as Answer;
      this.waiting.get(a.id)?.(a);
      this.waiting.delete(a.id);
    }
  }

  private send(call: string, args: Record<string, unknown> = {}): Promise<Answer> {
    const sock = this.sock;
    if (!sock || sock.destroyed) return Promise.reject(new Error("Not in the game: call connect first."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`The client didn't answer ${call}.`));
      }, CALL_MS);
      this.waiting.set(id, (a) => {
        clearTimeout(timer);
        resolve(a);
      });
      sock.write(`${JSON.stringify({ id, call, args })}\n`);
    });
  }

  /** A game tool, answered by the client (as play.ts) */
  async call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    const a = await this.send(name, args);
    return { ok: a.ok, text: a.text };
  }

  async context(): Promise<PlayContext> {
    const a = await this.send("context");
    if (!a.context) throw new Error(a.text || "No context from the client.");
    return a.context;
  }

  /** A PNG of the client's window, or (hud false) the 3D view alone */
  async screenshot(hud: boolean): Promise<Buffer> {
    const a = await this.send("screenshot", { hud });
    if (!a.png) throw new Error(a.text || "No picture from the client.");
    return Buffer.from(a.png, "base64");
  }

  /** Quits the client (it logs off as it goes) */
  async disconnect(): Promise<void> {
    const proc = this.proc;
    if (this.connected) await this.send("quit").catch(() => undefined);
    this.sock?.destroy();
    this.sock = null;
    if (proc && proc.exitCode === null) {
      await new Promise((r) => {
        const kill = setTimeout(() => proc.kill(), 5000);
        proc.once("exit", () => {
          clearTimeout(kill);
          r(undefined);
        });
      });
    }
    this.proc = null;
  }

  async close(): Promise<void> {
    await this.disconnect();
  }
}
