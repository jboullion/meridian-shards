// Development-only endpoints on the client's Vite server (`vite serve`; never in a build):
//
//   GET /__dev/editor/open?room=<file.roo>
//     Opens that room's source (shards-server's resource/rooms/src/<name>.room.json) in the
//     room editor (meridian-editor) that's running, through its agent endpoint: the address
//     and token it writes to agent.json (the app) or agent-web.json (its web build), the
//     same way an agent finds it (meridian-editor apps/editor/src/main/agentFiles.ts).
//     Answers { ok, message }, for the admin console to show.
//
//   /__admin/* and the dashboard's HMR messages: the admin dashboard (apps/client/admin.html),
//     in adminApi.ts.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { adminApi } from "./adminApi.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ROOM_SOURCES = join(ROOT, "server", "src", "resource", "rooms", "src");

interface Endpoint {
  url: string;
  token: string;
  pid: number;
  kind: "electron" | "web";
}

/** The editors running now, likeliest first: development app, installed app, web build */
function runningEditors(): Endpoint[] {
  const base = process.platform === "win32" ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")) : process.platform === "darwin" ? join(homedir(), "Library", "Application Support") : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  const files = [join(base, "Meridian Room Editor (dev)", "agent.json"), join(base, "Meridian Room Editor", "agent.json"), join(base, "Meridian Room Editor (dev)", "agent-web.json")];
  return files.flatMap((f) => {
    if (!existsSync(f)) return [];
    try {
      const e = JSON.parse(readFileSync(f, "utf8")) as Endpoint;
      process.kill(e.pid, 0);
      return [e];
    } catch {
      return [];
    }
  });
}

/** One call to the editor's page; it times out when no page answers (the web build with no tab open) */
async function call<T>(editor: Endpoint, body: unknown): Promise<T> {
  const res = await fetch(editor.url, { method: "POST", headers: { authorization: `Bearer ${editor.token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const reply = (await res.json()) as { ok: true; value: T } | { ok: false; error: string };
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

async function openInEditor(roo: string): Promise<{ ok: boolean; message: string }> {
  const name = roo.toLowerCase().replace(/\.roo$/, "");
  if (!/^[\w-]+$/.test(name)) return { ok: false, message: `Not a room file: ${roo}` };
  const path = join(ROOM_SOURCES, `${name}.room.json`);
  if (!existsSync(path)) return { ok: false, message: `${name} has no source in shards-server's resource/rooms/src` };
  const editors = runningEditors();
  if (!editors.length) return { ok: false, message: "No room editor is running: npm run dev -- --editor, then open http://127.0.0.1:5174" };
  for (const editor of editors) {
    try {
      const state = await call<{ name: string | null; dirty: boolean }>(editor, { op: "state" });
      if (state.name?.toLowerCase() === name) return { ok: true, message: `${name} is open in the editor` };
      if (state.dirty) return { ok: false, message: `The editor has unsaved changes to ${state.name}: save or discard them first` };
      await call(editor, { op: "load", path, name, room: JSON.parse(readFileSync(path, "utf8")) as unknown, saved: true });
      return { ok: true, message: `Opened ${name} in the editor` };
    } catch (e) {
      if (editor === editors[editors.length - 1]) {
        const why = (e as Error).name === "TimeoutError" ? "it didn't answer (is its page open? http://127.0.0.1:5174)" : (e as Error).message;
        return { ok: false, message: `The room editor couldn't open ${name}: ${why}` };
      }
    }
  }
  return { ok: false, message: "No room editor answered" };
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function devTools(): Plugin {
  return {
    name: "shards-dev-tools",
    apply: "serve",
    configureServer(server) {
      adminApi(server);
      server.middlewares.use("/__dev/editor/open", (req: IncomingMessage, res: ServerResponse) => {
        const room = new URL(req.url ?? "/", "http://localhost").searchParams.get("room") ?? "";
        void openInEditor(room).then(
          (r) => reply(res, 200, r),
          (e: unknown) => reply(res, 500, { ok: false, message: (e as Error).message }),
        );
      });
    },
  };
}
