// The agent's body inside the real client (docs/adr/0020-ai-playtester.md, phase 2): loaded into
// the dev page by browserBody.ts (through Vite's /@fs/), it attaches a Body to the page's own
// GameSession and the scene's mover, and answers the game tools there with the same handlers as
// the headless body (play.ts). Development builds only: it needs window.shards (gameScene.ts).

import type { GameSession } from "../../packages/world/src/index.ts";
import { Body, type MoverHook } from "./body.ts";
import { context, PLAY, type PlayContext } from "./play.ts";
import { WebGameData } from "./webData.ts";

interface PageShards {
  session: GameSession;
  gameScene: { mover: MoverHook };
}

export interface PageAgent {
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  context(): PlayContext;
}

type AgentWindow = Window & { shards?: PageShards; shardsAgent?: PageAgent };

export async function start(): Promise<void> {
  const w = window as AgentWindow;
  if (w.shardsAgent) return;
  const data = await WebGameData.load();
  const body = new Body(data);
  // The page makes a new session (and scene) when we switch characters or log in again
  const attached = (): void => {
    const shards = w.shards;
    if (!shards?.session) throw new Error("The game isn't running in the page.");
    if (body.session !== shards.session) body.attach(shards.session, shards.gameScene.mover);
  };
  attached();
  w.shardsAgent = {
    async call(name, args) {
      try {
        attached();
        const run = PLAY[name];
        if (!run) throw new Error(`No tool ${name} in the page.`);
        return { ok: true, text: await run(body, args) };
      } catch (e) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    },
    context: () => context(body),
  };
}
