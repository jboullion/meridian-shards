// What the agent knows about the game besides the session (docs/adr/0020-ai-playtester.md): where
// each room's exits lead, every room's number and name, the quest catalogue, and rooms with their
// nav grids. No Node APIs: the headless body reads it from disk (assets.ts GameData), the browser
// body from the page's /assets (webData.ts WebGameData).

import { parseRoo, type Room } from "../../packages/formats/src/index.ts";
import { buildNavGrid, decodeNavGrid, type AmbientExits, type NavGrid, type QuestCatalog } from "../../packages/world/src/index.ts";

export interface RoomInfo {
  rid: number;
  name: string;
  roo: string;
}

export interface LoadedRoom {
  file: string;
  room: Room;
  grid: NavGrid;
}

export interface GameInfo {
  /** roomexits.json: each room's doors and edges and where they lead */
  readonly exits: Record<string, AmbientExits>;
  /** rooms.json */
  readonly rooms: RoomInfo[];
  readonly catalog: QuestCatalog;
  /** The rooms using this file (a file can be several numbered rooms) */
  roomsOf(file: string): RoomInfo[];
  /** A room by number, file or name (a name may match several: the first) */
  findRoom(what: string): RoomInfo | undefined;
  /** A room file and its nav grid, read once; null when it isn't in the game files */
  room(file: string): Promise<LoadedRoom | null>;
}

/** The parts every source shares: lookups over the lists, and rooms read once */
export abstract class GameIndex implements GameInfo {
  abstract readonly exits: Record<string, AmbientExits>;
  abstract readonly rooms: RoomInfo[];
  abstract readonly catalog: QuestCatalog;
  private readonly loaded = new Map<string, Promise<LoadedRoom | null>>();

  /** The room's file and its nav grid file, or null for either that isn't there */
  protected abstract read(name: string): Promise<Uint8Array | null>;

  roomsOf(file: string): RoomInfo[] {
    return this.rooms.filter((r) => r.roo === file);
  }

  findRoom(what: string): RoomInfo | undefined {
    const w = what.trim().toLowerCase();
    if (/^\d+$/.test(w)) return this.rooms.find((r) => r.rid === Number(w));
    const file = w.endsWith(".roo") ? w : `${w}.roo`;
    return this.rooms.find((r) => r.roo === file) ?? this.rooms.find((r) => r.name.toLowerCase() === w) ?? this.rooms.find((r) => r.name.toLowerCase().includes(w));
  }

  /** As tools/gateway/arena.ts floor: the .nav when it's there and current, else built here */
  room(file: string): Promise<LoadedRoom | null> {
    let known = this.loaded.get(file);
    if (!known) {
      known = (async () => {
        const roo = await this.read(file);
        if (!roo) return null;
        const room = parseRoo(roo);
        const nav = await this.read(`nav/${file.replace(/\.roo$/, ".nav")}`);
        const grid = (nav ? decodeNavGrid(nav, room) : null) ?? buildNavGrid(room);
        return { file, room, grid };
      })();
      this.loaded.set(file, known);
    }
    return known;
  }
}
