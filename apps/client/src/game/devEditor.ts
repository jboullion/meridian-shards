// Development only: opens the room we're standing in in the room editor (meridian-editor),
// through the Vite server's /__dev/editor/open (tools/dev/devTools.ts). Saving it there puts it
// back in the game: the server rebuilds the room and GameScene.syncRoom loads it again in place.

import type { GameSession } from "@shards/world";

/** What happened, for the admin console to show */
export async function editCurrentRoom(session: GameSession): Promise<string> {
  const p = session.world.player;
  const file = p ? session.resource(p.roomRes) : null;
  if (!file) return "We aren't in a room.";
  try {
    const res = await fetch(`/__dev/editor/open?room=${encodeURIComponent(file)}`);
    return ((await res.json()) as { message: string }).message;
  } catch (e) {
    return `The dev server didn't answer: ${(e as Error).message}`;
  }
}
