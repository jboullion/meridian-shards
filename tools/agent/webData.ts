// The game files for the agent's body in the browser (docs/adr/0020-ai-playtester.md): the same
// lists and rooms as assets.ts, fetched from the page's own /assets (dist/assets in development).

import type { AmbientExits, QuestCatalog } from "../../packages/world/src/index.ts";
import { GameIndex, type RoomInfo } from "./gameInfo.ts";

/** Vite's dev server answers a missing file with the page itself */
const found = (r: Response): boolean => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html");

export class WebGameData extends GameIndex {
  readonly exits: Record<string, AmbientExits>;
  readonly rooms: RoomInfo[];
  readonly catalog: QuestCatalog;
  private readonly base: string;

  private constructor(base: string, exits: Record<string, AmbientExits>, rooms: RoomInfo[], catalog: QuestCatalog) {
    super();
    this.base = base;
    this.exits = exits;
    this.rooms = rooms;
    this.catalog = catalog;
  }

  static async load(base = "/assets/"): Promise<WebGameData> {
    const json = async <T>(name: string, fallback: T): Promise<T> => {
      const r = await fetch(base + name);
      return found(r) ? ((await r.json()) as T) : fallback;
    };
    const [exits, rooms, catalog] = await Promise.all([json("roomexits.json", {}), json<RoomInfo[]>("rooms.json", []), json<QuestCatalog>("quests.json", { hash: 0, quests: [] })]);
    return new WebGameData(base, exits, rooms, catalog);
  }

  protected async read(name: string): Promise<Uint8Array | null> {
    const r = await fetch(this.base + name);
    return found(r) ? new Uint8Array(await r.arrayBuffer()) : null;
  }
}
