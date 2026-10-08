// The original client's command line (clientd3d/config.c ConfigOverride): /H:host,
// /P:port, /U:username, /W:password and /Q (quick start: log on with /U and /W and, with
// exactly one character, go straight into the game, charpick.c ChooseCharacter). A switch
// is "/" or "-", a letter in either case, and an optional ":" before the value. "/" only
// counts on Windows, where it can't start a path; Chromium's "--switches" are ignored.

import type { DesktopLaunch } from "../../client/src/host.ts";

export interface CommandLine extends DesktopLaunch {
  host?: string;
  port?: number;
}

export function parseCommandLine(args: readonly string[], windows = process.platform === "win32"): CommandLine {
  const out: CommandLine = { quickstart: false };
  for (const arg of args) {
    if (!arg || !(arg[0] === "-" || (windows && arg[0] === "/"))) continue;
    let p = arg.slice(1);
    const ch = p[0];
    p = p.slice(1);
    if (p[0] === ":") p = p.slice(1);
    switch (ch) {
      case "h":
      case "H":
        out.host = p;
        break;
      case "p":
      case "P": {
        // atoi: leading digits; 0 means an invalid port, ignored
        const port = Number.parseInt(p, 10);
        if (port > 0) out.port = port;
        break;
      }
      case "u":
      case "U":
        out.username = p;
        break;
      case "w":
      case "W":
        out.password = p;
        break;
      case "q":
      case "Q":
        out.quickstart = true;
        break;
    }
  }
  return out;
}

/**
 * Which server /H and /P name: a listed one with that host (and port, if given), else
 * https://host:port (http for localhost). /H may also be a whole origin. Null without /H.
 */
export function serverFromCommandLine(cl: CommandLine, listed: readonly { origin: string }[]): string | null {
  if (!cl.host) return null;
  if (cl.host.includes("://")) {
    try {
      return new URL(cl.host).origin;
    } catch {
      return null;
    }
  }
  const match = listed.find((s) => {
    const u = new URL(s.origin);
    return u.hostname.toLowerCase() === cl.host!.toLowerCase() && (cl.port === undefined || Number(u.port || (u.protocol === "https:" ? 443 : 80)) === cl.port);
  });
  if (match) return match.origin;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(cl.host);
  try {
    return new URL(`${local ? "http" : "https"}://${cl.host}${cl.port ? `:${cl.port}` : ""}`).origin;
  } catch {
    return null;
  }
}
