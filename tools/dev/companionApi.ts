// The admin dashboard's companions (docs/adr/0010-followers.md; apps/client/src/admin/CompanionsTab.tsx):
// shards-server util/companionbook.kod's Admin* messages, for trying companions out on a player.
//
//   POST /__admin/companions/player   { playerId, action, kind?, points? } -> the book's Admin*
//                                     message, then the player's companion (AdminState)
//
// Actions: state, grant (kind 1-4), revive, recoverNow, setBond (points), bringHere, kill, remove.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { maint } from "../maint/maintClient.ts";
import { parseShownList } from "./questApi.ts";

type Route = (req: IncomingMessage) => Promise<unknown>;

/** What AdminState says of a player's companion; state 0 is none */
export interface CompanionState {
  state: number;
  kind: number;
  bond: number;
  tier: number;
  hp: number;
  maxHp: number;
  rid: number;
  pack: number;
}

const answer = (out: string | undefined, kind: "OBJECT" | "INT"): number | null => {
  const m = (kind === "OBJECT" ? /^: OBJECT (\d+)/m : /^: INT (-?\d+)/m).exec(out ?? "");
  return m ? Number(m[1]) : null;
};

export function companionApi(server: ViteDevServer, route: (fn: Route) => (req: IncomingMessage, res: ServerResponse) => void, body: (req: IncomingMessage) => Promise<string>): void {
  const book = async (): Promise<number> => {
    const [out] = await maint("send object 0 GetCompanionBook");
    const b = answer(out, "OBJECT");
    if (b === null) throw new Error("The server has no CompanionBook: build the Kod and reload system");
    return b;
  };

  const playerState = async (b: number, playerId: number): Promise<CompanionState> => {
    const [out] = await maint(`send object ${b} AdminState who object ${playerId}`);
    const list = /^: LIST (\d+)/m.exec(out ?? "")?.[1];
    if (!list) throw new Error(`Object ${playerId} isn't a player (a save may have renumbered it: wait for the game tab's next report)`);
    const [shown] = await maint(`show list ${list}`);
    const [state = 0, kind = 0, bond = 0, tier = 0, hp = 0, maxHp = 0, rid = 0, pack = 0] = ((parseShownList(shown ?? "") as (number | null)[] | null) ?? []).map((n) => n ?? 0);
    return { state, kind, bond, tier, hp, maxHp, rid, pack };
  };

  server.middlewares.use(
    "/__admin/companions/player",
    route(async (req) => {
      const { playerId, action, kind, points } = JSON.parse(await body(req)) as { playerId: number; action: string; kind?: number; points?: number };
      if (!Number.isInteger(playerId)) throw new Error("playerId: a number");
      const b = await book();
      const who = `who object ${playerId}`;
      const commands: Record<string, string> = {
        grant: `AdminGrant ${who} kind int ${Number(kind) || 1}`,
        revive: `AdminRevive ${who}`,
        recoverNow: `AdminRecoverNow ${who}`,
        setBond: `AdminSetBond ${who} points int ${Math.max(0, Math.floor(Number(points) || 0))}`,
        bringHere: `AdminBringHere ${who}`,
        kill: `AdminKill ${who}`,
        remove: `AdminRemove ${who}`,
      };
      // Asked first, so a stale object number is refused before anything is sent to it
      await playerState(b, playerId);
      if (action !== "state") {
        const cmd = commands[action];
        if (!cmd) throw new Error(`action: one of state, ${Object.keys(commands).join(", ")}`);
        const [out] = await maint(`send object ${b} ${cmd}`);
        if (answer(out, "INT") !== 1) throw new Error(`the server said no (${action}): does the player have a companion in a state that allows it?`);
      }
      return playerState(b, playerId);
    }),
  );
}
