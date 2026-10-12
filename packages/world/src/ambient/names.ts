// Ours: names for the ambient townsfolk (shown when a player examines one: the NPC inspect
// window). Made up in the game's spirit, picked by the crowd's seed so friends sharing a crowd
// (docs/adr/0005-friends.md 6) see the same names. Titles follow the role: guards by surname,
// knights "Sir", ladies "Lady", nobles "Lord" or "Lady", fighters and mages an epithet.

import type { Role } from "./chatter.ts";

const MALE = [
  "Aldric", "Bram", "Corwin", "Dorran", "Edmund", "Faril", "Garet", "Halden", "Ivor", "Jorin", "Kael", "Lucan", "Merrick", "Niall", "Orrin",
  "Perrin", "Quill", "Sedric", "Tobin", "Ulric", "Varn", "Wendel", "Yorick", "Anselm", "Berold", "Cadoc", "Doran", "Emric", "Fenwick", "Gilles",
  "Hobb", "Jarrow", "Leof", "Mattias", "Osric", "Piers", "Rufus", "Stellan", "Tamas", "Wat",
] as const;
const FEMALE = [
  "Aelis", "Brenna", "Cerise", "Dara", "Elsbeth", "Fenna", "Gwyn", "Hesta", "Ilsa", "Jessamy", "Kara", "Lissa", "Maren", "Nell", "Odile",
  "Petra", "Rosalind", "Sabine", "Tamsin", "Una", "Vesna", "Wren", "Ysolde", "Adela", "Beatrix", "Clemence", "Dilys", "Edda", "Fern", "Greer",
  "Hild", "Isolt", "Jocasta", "Linnet", "Mabyn", "Nessa", "Orla", "Rhosyn", "Sorcha", "Tilda",
] as const;
const SURNAMES = [
  "Ashdown", "Barrow", "Cobb", "Dunmore", "Fletcher", "Greaves", "Hale", "Kettle", "Marsh", "Penn", "Quarry", "Rook", "Thatcher", "Vane", "Wick",
  "Alder", "Brask", "Coldwell", "Dyer", "Elm", "Fairweather", "Gall", "Harrow", "Iver", "Lark", "Mossop", "Nettle", "Oakes", "Pike", "Reed",
  "Sallow", "Tanner", "Underhill", "Weaver", "Yarrow",
] as const;
const FIGHTER_EPITHETS = ["the Bold", "the Quick", "Ironhand", "the Unbowed", "Stonefist", "the Red", "the Grim", "Swiftblade", "the Bear", "Two-Scars"] as const;
const MAGE_EPITHETS = ["the Grey", "of the Flame", "Stormcaller", "the Wise", "of Shal'ille", "the Learned", "Ashweaver", "the Pale", "Runehand", "of the Blue"] as const;

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];

/** A name for someone of this role and sex, with the title their role gives */
export function personName(rand: () => number, role: Role, female: boolean): string {
  const first = pick(rand, female ? FEMALE : MALE);
  const last = pick(rand, SURNAMES);
  switch (role) {
    case "guard":
      return `Guard ${last}`;
    case "knight":
      return female ? `Dame ${first}` : `Sir ${first} ${last}`;
    case "lady":
      return `Lady ${first} ${last}`;
    case "noble":
      return `${female ? "Lady" : "Lord"} ${first} ${last}`;
    case "fighter":
      return `${first} ${pick(rand, FIGHTER_EPITHETS)}`;
    case "mage":
      return `${first} ${pick(rand, MAGE_EPITHETS)}`;
    default:
      return `${first} ${last}`;
  }
}
