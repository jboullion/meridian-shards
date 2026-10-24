// Ours (docs/adr/0022-guilds.md, phase 8): our guild's hall, prestige and rent as our server tells
// the guild window's Hall tab (UC_GUILD_HALL, shards-server passive/guild.kod SendHallInfo), and the
// commands that ask for it and open or close the hall to visitors.

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
  };
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
