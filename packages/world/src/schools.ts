// Ours (docs/adr/0028-abilities-tab.md): our standing in each school, for the Abilities tab, as
// our server reckons it (UC_SCHOOLS, shards-server util/shardsabilities.kod SendSchools, from
// player.kod LearnNeed, which the trainers' PlayerCanLearn uses too). Asked for with the
// UC_SHARDS line "schools"; also sent at logon and after any spell, skill or Intellect change.

import { objId, type ByteReader } from "@shards/protocol";

/** blakston.khd: weaponcraft's school (SKS_FENCING); brawling and thievery's */
export const SCHOOL_WEAPONCRAFT = 10;
export const SCHOOL_BRAWLING = 11;
export const SCHOOL_THIEVERY = 12;

/** shardsabilities.kod SCHOOL_*: a school's next level is there to learn, short, out of reach, or there is none */
export const SCHOOL_STATE = { READY: 1, SHORT: 2, IMPOSSIBLE: 3, MAX: 4 } as const;
export type SchoolState = (typeof SCHOOL_STATE)[keyof typeof SCHOOL_STATE];

/** A school we know: its highest level, the next (0 for none), our three best percents below it and what it needs */
export interface SchoolProgress {
  school: number;
  level: number;
  next: number;
  have: number;
  need: number;
  state: SchoolState;
}

/** A spell or skill we know: its object (as the stat lists have it), school, level, and whether it counts toward the next level */
export interface AbilitySchool {
  id: number;
  school: number;
  level: number;
  counts: boolean;
}

export interface Schools {
  /** Learn points: each school's highest level, by the level table (1, 2, 4, 6, 8, 10) */
  learnPoints: number;
  /** What Intellect takes off every school's need */
  intellectHelp: number;
  schools: SchoolProgress[];
  abilities: AbilitySchool[];
}

/**
 * UC_SCHOOLS's body (after the UC byte): learn points and Intellect's help (2 bytes each), a
 * 1-byte count of schools, each school, level, next (1 byte), have, need (2) and state (1); then
 * a 2-byte count of abilities, each the object (4), school, level and counts (1 byte each).
 */
export function readSchools(r: ByteReader): Schools {
  const learnPoints = r.u16();
  const intellectHelp = r.u16();
  const schools: SchoolProgress[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const school = r.u8();
    const level = r.u8();
    const next = r.u8();
    const have = r.u16();
    const need = r.u16();
    schools.push({ school, level, next, have, need, state: r.u8() as SchoolState });
  }
  const abilities: AbilitySchool[] = [];
  for (let n = r.u16(); n > 0; n--) {
    const id = objId(r.u32());
    const school = r.u8();
    const level = r.u8();
    abilities.push({ id, school, level, counts: r.u8() !== 0 });
  }
  return { learnPoints, intellectHelp, schools, abilities };
}

/** The UC_SHARDS line asking for UC_SCHOOLS */
export const schoolsCommand = (): string => "schools";
