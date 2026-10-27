// Ours (docs/adr/0022-guilds.md, phase 8): our guild's hall, prestige and rent as our server tells
// the guild window's Hall tab (UC_GUILD_HALL, shards-server passive/guild.kod SendHallInfo), and the
// commands that ask for it, open or close the hall to visitors and put the guild's cloak on or off.
// (Decision 34, 26 October: the guild's prism on the hall's pedestal, and attuning to it.)

import type { ByteReader } from "@shards/protocol";

export interface GuildChest {
  /** "common chest", "members' chest", "vault" */
  name: string;
  /** The lowest rank (1-5) that may use it */
  rank: number;
  items: number;
}

export interface GuildHallInfo {
  name: string;
  isPublic: boolean;
  /** Whether we may open or close it (an Officer or the Leader) */
  mayToggle: boolean;
  chests: GuildChest[];
}

/** Decision 34: the prism on the hall's pedestal (shards-server item/passitem/prism.kod) */
export interface GuildPrism {
  /** 1, 3, 5 or 7: how many members may attune */
  sides: number;
  /** PRISM_COLOUR_*: 1 emerald .. 6 pearl */
  colour: number;
  attuned: number;
  /** Whether we are attuned */
  mine: boolean;
}

/** blakston.khd PRISM_COLOUR_*: each colour's name and gift */
export const PRISM_COLOURS: Record<number, { name: string; gift: string }> = {
  1: { name: "Emerald", gift: "5% more experience" },
  2: { name: "Ruby", gift: "5 more health" },
  3: { name: "Sapphire", gift: "5 more mana" },
  4: { name: "Amber", gift: "3% more weapon damage" },
  5: { name: "Amethyst", gift: "3 more spellpower" },
  6: { name: "Pearl", gift: "15% faster recovery" },
};

export interface GuildHallStatus {
  /** null: the guild has no hall */
  hall: GuildHallInfo | null;
  prestige: number;
  /** 0 to 4 (Guild.GetPrestigeTier) */
  tier: number;
  /** The prestige the next tier starts at; 0 at the top */
  nextTierAt: number;
  /** How many items each chest holds at this tier */
  chestLimit: number;
  /** Rent owed in shillings; below 0, paid ahead */
  rentDue: number;
  /** Hours before unpaid rent costs the hall; 0 when it isn't at risk */
  rentHours: number;
  trophies: number;
  trophyTotal: number;
  /** Whether the guild has chosen its colours, which its cloaks need */
  hasColours: boolean;
  /** Whether we wear the guild's cloak (the Hall tab's box, "guildhall cloak on|off") */
  wearingCloak: boolean;
  /** null: no prism on the pedestal (or a server from before decision 34) */
  prism: GuildPrism | null;
}

/** UC_GUILD_HALL's body (after the UC byte) */
export function readGuildHall(r: ByteReader): GuildHallStatus {
  let hall: GuildHallInfo | null = null;
  if (r.u8() !== 0) {
    const name = r.string();
    const isPublic = r.u8() !== 0;
    const mayToggle = r.u8() !== 0;
    const chests: GuildChest[] = [];
    for (let n = r.u8(); n > 0; n--) chests.push({ name: r.string(), rank: r.u8(), items: r.u16() });
    hall = { name, isPublic, mayToggle, chests };
  }
  return {
    hall,
    prestige: r.u32(),
    tier: r.u8(),
    nextTierAt: r.u32(),
    chestLimit: r.u16(),
    rentDue: r.i32(),
    rentHours: r.u16(),
    trophies: r.u8(),
    trophyTotal: r.u8(),
    hasColours: r.u8() !== 0,
    // since the cloak became a box on the Hall tab; read only when sent
    wearingCloak: r.remaining > 0 && r.u8() !== 0,
    prism: readPrism(r),
  };
}

/** Decision 34's tail, read only when sent: whether there's a prism, its sides, colour, attuned, ours */
function readPrism(r: ByteReader): GuildPrism | null {
  if (r.remaining < 5) return null;
  const has = r.u8() !== 0;
  const sides = r.u8();
  const colour = r.u8();
  const attuned = r.u8();
  const mine = r.u8() !== 0;
  return has ? { sides, colour, attuned, mine } : null;
}

/** The prism, in a sentence */
export function prismText(s: GuildHallStatus): string {
  const p = s.prism;
  if (!p) return "The prism pedestal stands empty. A Lord may say \"prism place\" in the hall to set one on it.";
  const c = PRISM_COLOURS[p.colour] ?? { name: "A", gift: "a gift" };
  return `${c.name} prism, ${p.sides} ${p.sides === 1 ? "side" : "sides"} (${c.gift}): ${p.attuned} of ${p.sides} attuned${p.mine ? ", you among them" : ""}.`;
}

/** The rent, in a sentence */
export function rentText(s: GuildHallStatus): string {
  if (!s.hall) return s.rentDue < 0 ? `Your guild has ${-s.rentDue} shillings of rent to its credit.` : "With no hall, your guild owes no rent.";
  if (s.rentDue < 0) return `Rent is paid ahead by ${-s.rentDue} shillings.`;
  if (s.rentDue === 0) return "The rent is paid up.";
  const risk = s.rentHours > 0 ? ` Pay it within ${s.rentHours} ${s.rentHours === 1 ? "hour" : "hours"} or lose the hall.` : "";
  return `Rent owed: ${s.rentDue} shillings. Pay Frular in Barloque.${risk}`;
}

/** The prestige and what its tier gives, in a sentence */
export function prestigeText(s: GuildHallStatus): string {
  const next = s.nextTierAt > 0 ? ` The next tier comes at ${s.nextTierAt}.` : " That's the highest tier.";
  return `Prestige ${s.prestige}, tier ${s.tier} of 4: each chest holds ${s.chestLimit} items.${next}`;
}

export const guildHallCommand = (): string => "guildhall";
export const guildHallPublicCommand = (open: boolean): string => `guildhall ${open ? "public" : "private"}`;
export const guildCloakCommand = (wear: boolean): string => `guildhall cloak ${wear ? "on" : "off"}`;
/** Decision 34: attune to the guild's prism, or give it up (near the pedestal, in the hall) */
export const guildAttuneCommand = (attune: boolean): string => `guildhall ${attune ? "attune" : "unattune"}`;
