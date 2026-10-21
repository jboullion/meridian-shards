// Ours (the magic item revamp): an elder who reveals magic items and a smith who repairs them, as
// our server tells us (UC_ITEM_SERVICE, shards-server util/itemservicebook.kod SendRevealMenu and
// SendRepairMenu), and the commands we send back (UC_SHARDS "reveal <slot>", "repair <slot>").
// They come to the client as CosmeticsEvent's "reveal" and "repair" kinds, so they open the way a
// tailor's window does.

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

export type ItemServiceEvent =
  | { type: "reveal"; npc: number; items: ServiceItem[] }
  | { type: "repair"; npc: number; items: ServiceItem[] };

/** UC_ITEM_SERVICE's body (after the UC byte) */
export function readItemService(r: ByteReader): ItemServiceEvent | null {
  const kind = r.u8();
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
