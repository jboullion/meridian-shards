// Where the Meridian: Shards server lives, for the dev tools (ADR 0005). The server is its
// own repo (github.com/jboullion/meridian-shards-server); we use its Windows build:
//   <server>\tools\build.cmd          builds blakserv and the Kod into run\server
//   <server>\tools\setup-run.cmd      prepares run\shards, its config, saves and logs
//   <server>\run\server\blakserv.exe  run with run\shards as the working directory
//
// Env overrides: SHARDS_SERVER_DIR (the server repo), MERIDIAN_ART_DIR (an installed
// original client's resource folder, where the art comes from).

import { join } from "node:path";

export const SHARDS_SERVER_DIR = process.env.SHARDS_SERVER_DIR ?? "J:\\meridian-shard-server";
/** blakserv.exe and the build output (loadkod, rsc) */
export const SERVER_BUILD = join(SHARDS_SERVER_DIR, "run", "server");
/** The working directory: config, saves, logs */
export const SERVER_RUN = join(SHARDS_SERVER_DIR, "run", "shards");
export const SERVER_EXE = join(SERVER_BUILD, "blakserv.exe");
/** Kod source, for the asset build's derived JSON */
export const SERVER_KOD = join(SHARDS_SERVER_DIR, "kod");

/** The Shards server's ports (its config/blakserv.cfg): a Server 104 can keep 5959/9998 */
export const GAME_PORT = 5960;
export const MAINT_PORT = 9999;

/** The original client's art (bgf, ogg, wav, bsf), e.g. the Steam install. Never committed. */
export const ART_DIR = process.env.MERIDIAN_ART_DIR ?? "H:\\Steam\\steamapps\\common\\Meridian 59\\resource";

/** Test accounts the dev tools make on the server (password = name); see AGENTS.md */
export const TEST_ACCOUNTS = ["shardbot", "shardpal"] as const;
