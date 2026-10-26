// Ours (docs/adr/0010-followers.md): our companion, as our server tells us (UC_COMPANION, shards-
// server util/companionbook.kod SendStatus and HealthChanged), and the commands we send back
// (UC_SHARDS "companion ...").

import { objId, type ByteReader } from "@shards/protocol";

/** Its state (COMP_* in blakston.khd) */
export const COMPANION_STATE = { NONE: 0, ACTIVE: 1, WAITING: 2, FALLEN: 3, RECOVERING: 4 } as const;
export type CompanionState = (typeof COMPANION_STATE)[keyof typeof COMPANION_STATE];

/** Its stance (COMP_FOLLOW..COMP_PASSIVE), and the command word for each */
export const COMPANION_STANCES = [
  { id: 1, word: "follow", label: "Follow" },
  { id: 2, word: "defend", label: "Defend" },
  { id: 3, word: "stay", label: "Stay" },
  { id: 4, word: "passive", label: "Passive" },
] as const;

/** Status flags (companionbook.kod COMPANION_LEFT_BEHIND etc.) */
export const COMPANION_FLAG = { LEFT_BEHIND: 1, FOREVER_ARMED: 2, READY: 4 } as const;

/**
 * Its look, as places in the character creator's lists (BP_CHARINFO): gender 0 male, 1 female;
 * beard 0 none, else its place + 1; skin 0-3; colour1/2 places in its palette.
 */
export interface CompanionLook {
  gender: number;
  hair: number;
  eyes: number;
  nose: number;
  mouth: number;
  beard: number;
  hairColour: number;
  skin: number;
  colour1: number;
  colour2: number;
}

export interface CompanionStatus {
  state: CompanionState;
  flags: number;
  /** Its object while it's in the world with us, else 0 */
  id: number;
  name: string;
  kindName: string;
  kind: number;
  hp: number;
  maxHp: number;
  bond: number;
  tier: number;
  tierFloor: number;
  /** The next tier's floor, 0 at the top tier */
  nextTier: number;
  stance: number;
  /** The room it's in, "" in limbo */
  room: string;
  /** Seconds until a recovering companion can be fetched */
  secondsLeft: number;
  /** Shillings to fetch it now */
  fee: number;
  packCount: number;
  packBulk: number;
  bulkMax: number;
  look: CompanionLook;
  /** Colours its clothes may be (XLAT_TO_* numbers) */
  palette: number[];
}

export type CompanionEvent =
  | { type: "none" }
  | { type: "status"; status: CompanionStatus }
  | { type: "health"; hp: number; maxHp: number };

/** UC_COMPANION's body (after the UC byte) */
export function readCompanion(r: ByteReader, resource: (id: number) => string | null | undefined): CompanionEvent | null {
  const kind = r.u8();
  if (kind === 2) return { type: "health", hp: r.u16(), maxHp: r.u16() };
  if (kind !== 1) return null;
  const state = r.u8() as CompanionState;
  if (state === COMPANION_STATE.NONE) return { type: "none" };
  const flags = r.u8();
  const id = objId(r.u32());
  const name = resource(r.u32()) ?? "Companion";
  const kindName = resource(r.u32()) ?? "";
  const companionKind = r.u8();
  const hp = r.u16();
  const maxHp = r.u16();
  const bond = r.u32();
  const tier = r.u8();
  const tierFloor = r.u32();
  const nextTier = r.u32();
  const stance = r.u8();
  const roomRsc = r.u32();
  const room = roomRsc ? (resource(roomRsc) ?? "") : "";
  const secondsLeft = r.u32();
  const fee = r.u32();
  const packCount = r.u16();
  const packBulk = r.u16();
  const bulkMax = r.u16();
  const look: CompanionLook = {
    gender: r.u8(),
    hair: r.u8(),
    eyes: r.u8(),
    nose: r.u8(),
    mouth: r.u8(),
    beard: r.u8(),
    hairColour: r.u8(),
    skin: r.u8(),
    colour1: r.u8(),
    colour2: r.u8(),
  };
  const palette: number[] = [];
  for (let n = r.u8(); n > 0; n--) palette.push(r.u8());
  return {
    type: "status",
    status: {
      state, flags, id, name, kindName, kind: companionKind, hp, maxHp, bond, tier, tierFloor, nextTier, stance, room,
      secondsLeft, fee, packCount, packBulk, bulkMax, look, palette,
    },
  };
}

/** The `companion look` command for a chosen look */
export function buildLookCommand(l: CompanionLook): string {
  return `companion look ${[l.gender, l.hair, l.eyes, l.nose, l.mouth, l.beard, l.hairColour, l.skin, l.colour1, l.colour2].join(" ")}`;
}

/** What a state is called in our Companion tab */
export function companionStateLabel(s: CompanionStatus): string {
  if (s.state === COMPANION_STATE.ACTIVE) return s.flags & COMPANION_FLAG.LEFT_BEHIND ? "Left behind" : "With you";
  if (s.state === COMPANION_STATE.WAITING) return "Waiting";
  if (s.state === COMPANION_STATE.FALLEN) return "Fallen";
  if (s.state === COMPANION_STATE.RECOVERING) return s.secondsLeft > 0 ? "Recovering" : "Ready";
  return "";
}
