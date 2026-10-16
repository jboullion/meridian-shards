// The admin dashboard's calls: the dev server's /__admin endpoints (tools/dev/adminApi.ts),
// recipes on the maintenance port built from them, and the HMR link to the game tabs.

import { useEffect, useState } from "react";
import type { DevState, GameReport } from "../game/devBridge.ts";

export type { DevState, GameReport };

/** Ours: the admin test room (shards-server room/provgrnd.kod) */
export const PROVING_GROUNDS_RID = 4300;

export interface CatalogEntry {
  className: string;
  name: string;
  icon: string | null;
}
export interface ItemEntry extends CatalogEntry {
  stack: boolean;
}
export interface SpellEntry extends CatalogEntry {
  sid: number;
}
export interface Catalog {
  monsters: CatalogEntry[];
  items: ItemEntry[];
  spells: SpellEntry[];
}

async function post<T>(url: string, data: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(data) });
  const out = (await res.json()) as T & { error?: string };
  if (!res.ok || out.error) throw new Error(out.error ?? `${url}: HTTP ${res.status}`);
  return out;
}

/** Commands on the maintenance port, in order; each one's output */
export async function maint(...commands: string[]): Promise<string[]> {
  return (await post<{ outputs: string[] }>("/__admin/maint", { commands })).outputs;
}

export const returnedObject = (out: string): number | null => (/^: OBJECT (\d+)/m.exec(out) ? Number(/^: OBJECT (\d+)/m.exec(out)![1]) : null);
export const returnedInt = (out: string): number | null => (/^: INT (-?\d+)/m.exec(out) ? Number(/^: INT (-?\d+)/m.exec(out)![1]) : null);

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch("/__admin/catalog");
  const out = (await res.json()) as Catalog & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}

export const buildKod = () => post<{ ok: boolean; tail: string }>("/__admin/kod/build");

/** A fast travel point (shards-server util/travelnet.kod GetPoints), as tools/dev/travelPoints.ts reads it */
export interface TravelPoint {
  id: string;
  name: string;
  ridName: string;
  rid: number | null;
  row: number;
  col: number;
  arrivalRow: number;
  arrivalCol: number;
  angle: string;
  fineRow: number | null;
  fineCol: number | null;
  /** A historic portal's other end, by its name resource (GetHistoricLinks) */
  leadsTo?: string;
}
export interface TravelHere {
  rid: number;
  row: number;
  col: number;
  angle: string;
  /** The room's travel points (the museum has five) */
  points: TravelPoint[];
}
export const travelHere = (playerId: number) => post<TravelHere>("/__admin/travel/here", { playerId });
/** Moves one of the room's portals, or its arrival square and facing, to where the player stands */
export const travelMove = (playerId: number, id: string, part: "portal" | "arrival") =>
  post<{ point: TravelPoint; steps: string[] }>("/__admin/travel/move", { playerId, id, part });
export const saveTuning = (values: DevState["tuning"]) => post<{ written: string[] }>("/__admin/tuning/save", { values });

/** The room object for a room number (object numbers change at every save, so always asked) */
export async function findRoom(rid: number): Promise<number> {
  const [out] = await maint(`send object 0 FindRoomByNum num int ${rid}`);
  const room = returnedObject(out ?? "");
  if (room === null) throw new Error(`RID ${rid} isn't loaded on the server`);
  return room;
}

/** A Proving Grounds helper (provgrnd.kod): SpawnMonster, ClearMonsters, ClearItems, ResetDummies; what it returned */
export async function provingGrounds(message: string, args = ""): Promise<number | null> {
  const room = await findRoom(PROVING_GROUNDS_RID);
  const [out] = await maint(`send object ${room} ${message}${args ? ` ${args}` : ""}`);
  return returnedInt(out ?? "");
}

/** Monsters of a class on the square beside us, wherever we are; how many were made */
export async function spawnBeside(className: string, me: GameReport, count: number): Promise<number> {
  const [owner] = await maint(`send object ${me.playerId} GetOwner`);
  const room = returnedObject(owner ?? "");
  if (room === null) throw new Error("Couldn't find the room we're in");
  let made = 0;
  for (let i = 0; i < count; i++) {
    const [created] = await maint(`create object ${className}`);
    const id = /Created object (\d+)/.exec(created ?? "")?.[1];
    if (!id) throw new Error(`create object ${className}: ${created}`);
    await maint(
      `send object ${id} SetDontDispose`,
      `send object ${room} NewHold what object ${id} new_row int ${me.row} new_col int ${me.col + 1} fine_row int ${8 + ((i * 13) % 48)} fine_col int ${8 + ((i * 29) % 48)}`,
    );
    made++;
  }
  return made;
}

/** An item into a player's inventory (a number item as `amount` of them) */
export async function giveItem(className: string, playerId: number, amount: number, stack: boolean): Promise<void> {
  const [created] = await maint(stack ? `create object ${className} number int ${Math.max(1, amount)}` : `create object ${className}`);
  const id = /Created object (\d+)/.exec(created ?? "")?.[1];
  if (!id) throw new Error(`create object ${className}: ${created}`);
  await maint(`send object ${playerId} NewHold what object ${id}`);
}

/** A spell cast by `caster` at `target` (claude-testbench mcp_blakserv.py t_cast's recipe) */
export async function castSpell(sid: number, caster: number, target: number, power: number): Promise<string> {
  const [found] = await maint(`send object 0 FindSpellByNum num int ${sid}`);
  const spell = returnedObject(found ?? "");
  if (spell === null) throw new Error(`No spell ${sid} on the server`);
  const [list] = await maint(`create listnode object ${target} nil 0`);
  const node = /Created list node (\d+)/i.exec(list ?? "")?.[1];
  if (!node) throw new Error(`create listnode: ${list}`);
  const [out] = await maint(`send object ${spell} CastSpell who object ${caster} lTargets list ${node} iSpellPower int ${power}`);
  return out ?? "";
}

/** The objects in the room we're in: id and class, from `show object` on the room's active list */
export async function objectsHere(me: GameReport): Promise<{ id: number; className: string }[]> {
  const [owner] = await maint(`send object ${me.playerId} GetOwner`);
  const room = returnedObject(owner ?? "");
  if (room === null) return [];
  const [active] = await maint(`send object ${room} GetHolderActive`);
  const list = /^: LIST (\d+)/m.exec(active ?? "")?.[1];
  if (!list) return [];
  const [shown] = await maint(`show list ${list}`);
  const ids = [...new Set([...(shown ?? "").matchAll(/OBJECT (\d+)/g)].map((m) => Number(m[1])))].filter((id) => id !== me.playerId);
  const classes = await maint(...ids.map((id) => `show object ${id}`));
  return ids.map((id, i) => ({ id, className: /CLASS (\w+)/.exec(classes[i] ?? "")?.[1] ?? "?" }));
}

// ---------------------------------------------------------------- the game tabs, over Vite's HMR socket

export function useDevLink(): { state: DevState; game: GameReport | null; set: (s: Partial<DevState>) => void } {
  const [state, setState] = useState<DevState>({ tuning: {}, scene: {} });
  const [game, setGame] = useState<GameReport | null>(null);
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const onState = (s: DevState) => setState(s);
    const onGame = (g: GameReport) => setGame(g);
    hot.on("shards:state", onState);
    hot.on("shards:game", onGame);
    hot.send("shards:dash-hello", {});
    return () => {
      hot.off("shards:state", onState);
      hot.off("shards:game", onGame);
    };
  }, []);
  const set = (s: Partial<DevState>) => {
    setState((old) => ({ ...old, ...s }));
    import.meta.hot?.send("shards:set", s);
  };
  return { state, game, set };
}
