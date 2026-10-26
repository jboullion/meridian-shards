// Ours (the magic item revamp): an elder who reveals magic items and a smith who repairs them, as
// our server tells us (UC_ITEM_SERVICE, shards-server util/itemservicebook.kod SendRevealMenu and
// SendRepairMenu), and the commands we send back (UC_SHARDS "reveal <slot>", "repair <slot>").
// They come to the client as CosmeticsEvent's "reveal" and "repair" kinds, so they open the way a
// tailor's window does. So does Caramo's name change (docs/adr/0026-the-office-of-the-justicar.md):
// kind 3, her and the fee, answered with "rename <new name>".

import { objId, type ByteReader } from "@shards/protocol";

/** Something of ours the elder or smith can work on; `slot` (from 1) is how the commands name it */
export interface ServiceItem {
  slot: number;
  id: number;
  /** In shillings */
  price: number;
  hits: number;
  maxHits: number;
}

/** An elder's or smith's menu: the things of ours they can work on */
export type ItemMenuEvent =
  | { type: "reveal"; npc: number; items: ServiceItem[] }
  | { type: "repair"; npc: number; items: ServiceItem[] };

export type ItemServiceEvent =
  | ItemMenuEvent
  /** Caramo, in the Office of the Justicar: a new name for `fee` shillings (purse first, then the Tos bank) */
  | { type: "rename"; npc: number; fee: number };

/** UC_ITEM_SERVICE's body (after the UC byte) */
export function readItemService(r: ByteReader): ItemServiceEvent | null {
  const kind = r.u8();
  if (kind === 3) {
    const npc = objId(r.u32());
    return { type: "rename", npc, fee: r.u32() };
  }
  if (kind !== 1 && kind !== 2) return null;
  const npc = objId(r.u32());
  const items: ServiceItem[] = [];
  for (let n = r.u8(), slot = 1; n > 0; n--, slot++) {
    const id = objId(r.u32());
    const price = r.u32();
    const hits = r.u32();
    items.push({ slot, id, price, hits, maxHits: r.u32() });
  }
  return { type: kind === 1 ? "reveal" : "repair", npc, items };
}

export const revealCommand = (slot: number) => `reveal ${slot}`;
export const repairCommand = (slot: number) => `repair ${slot}`;
/** The server joins the words back with single spaces (util/itemservicebook.kod Rename) */
export const renameCommand = (name: string) => `rename ${name.trim().split(/\s+/).join(" ")}`;
/** blakston.khd MIN_CHAR_NAME_LEN and MAX_CHAR_NAME_LEN */
export const CHAR_NAME_MIN = 3;
export const CHAR_NAME_MAX = 30;
