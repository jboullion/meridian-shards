// Ours (docs/adr/0012-cosmetics.md): tailors and barbers, as our server tells us (UC_COSMETICS,
// shards-server util/cosmeticsbook.kod SendTailorMenu and SendBarberMenu), and the commands we
// send back (UC_SHARDS "tailor ..." and "barber ...").

import { objId, type ByteReader } from "@shards/protocol";

/** A dye a tailor offers: its dye field (render xlat.ts dyeField: a palette ramp and a shade) and name */
export interface Dye {
  field: number;
  name: string;
}

/** What a dye goes on in an item's art (blakston.khd DYE_RAMP_*) */
export const DYE_RAMP = { NONE: 0, CLOTH: 1, TRIM: 2 } as const;

/** Something of ours the tailor can dye; `slot` (from 1) is how the commands name it */
export interface DyeableItem {
  slot: number;
  id: number;
  ramp: number;
  /** Its dye field now, 0 for none */
  field: number;
  worn: boolean;
}

/** Places in the character creator's lists (BP_CHARINFO), as AppearanceEditor's Face has them */
export interface BarberLook {
  gender: number;
  hair: number;
  /** 0 none, else its place + 1 */
  beard: number;
  hairColour: number;
  head: number;
  eyes: number;
  nose: number;
  mouth: number;
  skin: number;
}

export type CosmeticsEvent =
  | { type: "tailor"; npc: number; dyePrice: number; undyePrice: number; dyes: Dye[]; items: DyeableItem[] }
  | { type: "barber"; npc: number; price: number; look: BarberLook };

/** UC_COSMETICS's body (after the UC byte) */
export function readCosmetics(r: ByteReader, resource: (id: number) => string | null | undefined): CosmeticsEvent | null {
  const kind = r.u8();
  if (kind === 1) {
    const npc = objId(r.u32());
    const dyePrice = r.u32();
    const undyePrice = r.u32();
    const dyes: Dye[] = [];
    for (let n = r.u8(); n > 0; n--) {
      const field = r.u8();
      dyes.push({ field, name: resource(r.u32()) ?? "" });
    }
    const items: DyeableItem[] = [];
    for (let n = r.u8(), slot = 1; n > 0; n--, slot++) {
      const id = objId(r.u32());
      const ramp = r.u8();
      const field = r.u8();
      items.push({ slot, id, ramp, field, worn: r.u8() !== 0 });
    }
    return { type: "tailor", npc, dyePrice, undyePrice, dyes, items };
  }
  if (kind === 2) {
    const npc = objId(r.u32());
    const price = r.u32();
    const look: BarberLook = {
      gender: r.u8(), hair: r.u8(), beard: r.u8(), hairColour: r.u8(), head: r.u8(), eyes: r.u8(), nose: r.u8(), mouth: r.u8(), skin: r.u8(),
    };
    return { type: "barber", npc, price, look };
  }
  return null;
}

/** The commands for a tailor's and a barber's work */
export const tailorDyeCommand = (slot: number, field: number) => `tailor dye ${slot} ${field}`;
export const tailorUndyeCommand = (slot: number) => `tailor undye ${slot}`;
export const barberCommand = (hair: number, beard: number, hairColour: number) => `barber ${hair} ${beard} ${hairColour}`;
