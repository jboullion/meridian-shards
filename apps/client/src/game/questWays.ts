// Ours (docs/adr/0009-quests.md 5): what the maps show of our tracked quests' areas: whether the
// room we're in is one of them (a gold wash) and the exits to take toward them, or back to where
// a step is handed in (@shards/world questWay.ts). Worked out once per room and quest change.

import { questWay, type AmbientExits, type WayMark } from "@shards/world";
import type { QuestStore } from "./quests.ts";

export interface MapWay {
  /** We stand in a tracked step's area */
  wash: boolean;
  /** The exits out of this room toward the tracked steps' rooms */
  marks: WayMark[];
}

export interface WaySource {
  roomExits(): Promise<Record<string, AmbientExits>>;
  roomList(): Promise<{ rid: number; roo: string }[]>;
}

export class QuestWays {
  private exits: Record<string, AmbientExits> = {};
  private roo = new Map<number, string>();
  private loaded = 0;
  private cache: { key: string; way: MapWay | null } | null = null;
  private readonly store: QuestStore;

  constructor(source: WaySource, store: QuestStore) {
    this.store = store;
    void Promise.all([source.roomExits(), source.roomList()]).then(
      ([exits, rooms]) => {
        this.exits = exits;
        this.roo = new Map(rooms.map((r) => [r.rid, r.roo.toLowerCase()]));
        this.loaded++;
      },
      (e: unknown) => console.warn("quest areas: no room exits or list", e),
    );
  }

  /** The way for the room we're in (its file, lower case), or null for nothing to show */
  get(here: string): MapWay | null {
    const key = `${here}|${this.store.version}|${this.loaded}`;
    if (this.cache?.key === key) return this.cache.way;
    let way: MapWay | null = null;
    if (here && this.loaded) {
      const marks = new Map<string, WayMark>();
      let wash = false;
      for (const a of this.store.trackedQuests()) {
        const step = a.quest?.steps[a.step - 1];
        if (!step) continue;
        const w = questWay(this.exits, (rid) => this.roo.get(rid), here, step, a.count);
        wash ||= w.inArea;
        for (const m of w.marks) marks.set(JSON.stringify(m), m);
      }
      if (wash || marks.size) way = { wash, marks: [...marks.values()] };
    }
    this.cache = { key, way };
    return way;
  }
}
