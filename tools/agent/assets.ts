// The game files the headless body reads from disk (docs/adr/0020-ai-playtester.md): the server's
// resources for the redbook token and names, and from the asset build (npm run assets) the rooms
// with their nav grids, where each room's exits lead, every room's number and name, and the quest
// catalogue (gameInfo.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRsb } from "../../packages/formats/src/index.ts";
import type { AmbientExits, QuestCatalog } from "../../packages/world/src/index.ts";
import { GameIndex, type RoomInfo } from "./gameInfo.ts";

export type { LoadedRoom, RoomInfo } from "./gameInfo.ts";

export class GameData extends GameIndex {
  readonly secretKey: string;
  readonly rsb: ReturnType<typeof parseRsb>;
  readonly exits: Record<string, AmbientExits>;
  readonly rooms: RoomInfo[];
  readonly catalog: QuestCatalog;
  private readonly assetsDir: string;

  constructor(opts: { assetsDir: string; rsbPath: string; configPath: string }) {
    super();
    this.assetsDir = opts.assetsDir;
    this.secretKey = /^SecretKey\s+(\S+)/m.exec(readFileSync(opts.configPath, "utf8"))?.[1] ?? "";
    this.rsb = parseRsb(readFileSync(opts.rsbPath));
    this.exits = this.json("roomexits.json", {});
    this.rooms = this.json("rooms.json", []);
    this.catalog = this.json("quests.json", { hash: 0, quests: [] });
  }

  private json<T>(name: string, fallback: T): T {
    const path = join(this.assetsDir, name);
    if (!existsSync(path)) {
      console.error(`agent: no ${path}; run npm run assets`);
      return fallback;
    }
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }

  protected read(name: string): Promise<Uint8Array | null> {
    const path = join(this.assetsDir, name);
    return Promise.resolve(existsSync(path) ? new Uint8Array(readFileSync(path)) : null);
  }
}
