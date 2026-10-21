// Ours (docs/adr/0016-abilities.md): what we can train with training points, as our server
// tells us (UC_TRAINING, shards-server util/shardsabilities.kod SendTraining), and the commands
// we send back (UC_SHARDS "train list"; UC_SHARDS_OBJECT "train <amount>" on the ability).
// And whether an item we carry can be appraised for the citizen's market (UC_APPRAISAL,
// SendAppraisal, after UC_SHARDS_OBJECT "appraise ask"): valuable things only.

import { objId, type ByteReader } from "@shards/protocol";

/** A spell or skill we know that can be trained: its object (as the Spells and Skills lists have it) and what 1% costs */
export interface TrainingCost {
  id: number;
  cost: number;
}

/** UC_TRAINING's body (after the UC byte): a 2-byte count, then the ability and its cost, 4 bytes each */
export function readTraining(r: ByteReader): TrainingCost[] {
  const out: TrainingCost[] = [];
  for (let n = r.u16(); n > 0; n--) {
    const id = objId(r.u32());
    out.push({ id, cost: r.u32() });
  }
  return out;
}

/** Whether an item of ours can be appraised (magical, or worth 5,000), and its price now (0 for none) */
export interface Appraisal {
  id: number;
  appraisable: boolean;
  price: number;
}

/** UC_APPRAISAL's body (after the UC byte): the item DWORD, appraisable BYTE, price DWORD */
export function readAppraisal(r: ByteReader): Appraisal {
  const id = objId(r.u32());
  const appraisable = r.u8() !== 0;
  return { id, appraisable, price: r.u32() };
}

/**
 * What a buyer would take from our inventory (UC_SHARDS_OBJECT "sell list" on them, UC_SELLABLE
 * back): each item and what they'd pay for it, the whole stack of a number item (0: they can't say).
 */
export interface Sellable {
  npc: number;
  items: { id: number; price: number }[];
}

/** UC_SELLABLE's body (after the UC byte): the buyer DWORD, a 2-byte count, then each item and its price, 4 bytes each */
export function readSellable(r: ByteReader): Sellable {
  const npc = objId(r.u32());
  const items: Sellable["items"] = [];
  for (let n = r.u16(); n > 0; n--) {
    const id = objId(r.u32());
    items.push({ id, price: r.u32() });
  }
  return { npc, items };
}

/** The most percent we can train an ability at `percent` now: to 99, and as far as `points` go */
export function trainableAmount(percent: number, cost: number, points: number): number {
  if (cost <= 0) return 0;
  return Math.max(0, Math.min(99 - percent, Math.floor(points / cost)));
}

/** UC_SHARDS_OBJECT's line to train an ability by `amount` percent */
export const trainCommand = (amount: number): string => `train ${Math.max(1, Math.floor(amount))}`;
