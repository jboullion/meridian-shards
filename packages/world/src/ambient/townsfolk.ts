// Ours: a townsperson's looks, put together the way the server dresses a player
// (player.kod SendOverlays and SendMoveOverlays, SetDefaultClothes; util.kod
// EncodeTwoColorXLAT), with a random face, hair, skin and outfit, so they look like any other
// player in the street. The art is the players' own: bodies, arms and legs from the clothing
// item classes, faces from system.kod's charinfo icons.

import { ANIMATE, type Animation, type ObjectInfo } from "@shards/protocol";
import { animStateFrom } from "../animation.ts";
import type { Look, OverlayState, WorldObject } from "../state.ts";
import { ambientId, localRes } from "./ambientIds.ts";

/** blakston.khd HS_* */
const HS = { HEAD: 1, EYES: 11, MOUTH: 12, TOUPEE: 13, NOSE: 14, RIGHT_HAND: 21, RIGHT_WEAPON: 22, LEFT_HAND: 31, LEFT_WEAPON: 32, LEGS: 41 } as const;
/**
 * A lit torch (torch.kod): its overlay in the left hand, flickering over groups 1-6 every 60 ms
 * (SendHeldAnimation), the left arm bent to hold it (player.kod: group 7 for HS_LEFT_WEAPON),
 * and the light a player with one gives (player.kod SendLightingInformation: LIGHT_FLAG_ON |
 * LIGHT_FLAG_DYNAMIC, 60, LIGHT_FIRE)
 */
const TORCH_OVERLAY = "torchov.bgf";
export const TORCH_LIGHT = { flags: 0x3, intensity: 60, color: 0x7f06 } as const;
const NO_LIGHT = { flags: 0, intensity: 0, color: 0 } as const;
/** proto.h OF_PLAYER: lit and shadowed like a player */
const OF_PLAYER = 0x4;

/** blakston.khd XLAT_TO_*: a two-colour translation's colours */
export const C = { RED: 0, SKIN1: 1, SKIN2: 2, SKIN4: 3, ORANGE: 4, GREEN: 5, BLUE: 6, PURPLE: 7, YELLOW: 8, GRAY: 9, SKY: 10, DGREEN: 11, BLACK: 12 } as const;

/** util.kod EncodeTwoColorXLAT: red parts to `cloth`, blue parts to `skin` (a skin colour) */
export function twoColorXlat(cloth: number, skin: number): number {
  if (cloth === C.DGREEN) return 121 + skin; // XLAT_REDTODGREEN1..3
  if (cloth === C.BLACK) return 124 + skin; // XLAT_REDTOBLACK1..3
  return 0x87 + 11 * cloth + skin; // XLAT_BASE_VALUE
}

/** system.kod SendCharInfo: the skin translations for faces (PT_BLUE_TO_SKIN1..4), and the body's skin colour for each (player.kod ConvertSkinColorToXLAT) */
const SKINS: [number, number][] = [[0x01, C.SKIN1], [0x02, C.SKIN1], [0x03, C.SKIN2], [0x04, C.SKIN4]];
/** system.kod GetHairTranslations: the hair colours, natural ones more often, dyed ones (blue, purple, green) rarely */
const HAIR_COLORS: [number, number][] = [
  [0x2c, 4], [0x22, 4], [0x1d, 3], [0x1e, 3], [0x2f, 3], [0x30, 2], [0x2a, 2], [0x2b, 2], [0x1a, 1], [0x1b, 1], [0x1c, 1], [0x0a, 1], [0x12, 1],
  [0x2d, 3], [0x2e, 3], [0x19, 1], [0x10, 1], [0x28, 1], [0x11, 0.15], [0x0f, 0.15], [0x14, 0.15],
];

interface FaceParts {
  head: string;
  hair: [string, number][];
  eyes: string[];
  noses: string[];
  mouths: string[];
  /** system.kod GetAllowedBeardIcons, weighted; "" is clean-shaven */
  beards: [string, number][];
}
/**
 * system.kod GetAllowed*Icons (no mohawks in town, mostly); "" is bald. Then Meridian Shards' new
 * styles (pts*.bgf), weighted to suit each, and its facial hair (pbd*.bgf), on most men none.
 */
const FACES: Record<"male" | "female", FaceParts> = {
  male: {
    head: "phax.bgf",
    hair: [
      ["ptad.bgf", 4], ["ptbb.bgf", 3], ["ptac.bgf", 2], ["ptba.bgf", 1], ["ptxa.bgf", 2], ["", 2], ["ptcd.bgf", 0.3],
      ["ptsa.bgf", 1], ["ptsb.bgf", 3], ["ptsc.bgf", 2], ["ptsd.bgf", 1.5], ["ptse.bgf", 2], ["ptsf.bgf", 0.6],
      ["ptsg.bgf", 1], ["ptsh.bgf", 0.4], ["ptsi.bgf", 0.4], ["ptsl.bgf", 1],
    ],
    eyes: ["peax.bgf", "pebx.bgf", "pecx.bgf", "pedx.bgf"],
    noses: ["pnax.bgf", "pnbx.bgf", "pncx.bgf"],
    mouths: ["pmax.bgf", "pmbx.bgf", "pmcx.bgf"],
    beards: [["", 9], ["pbda.bgf", 2], ["pbdb.bgf", 1], ["pbdc.bgf", 1.2], ["pbdd.bgf", 1.2], ["pbde.bgf", 0.5], ["pbdf.bgf", 0.4]],
  },
  female: {
    head: "phkx.bgf",
    hair: [
      ["ptca.bgf", 3], ["ptbc.bgf", 3], ["ptdc.bgf", 3], ["ptcb.bgf", 3], ["ptbd.bgf", 2], ["ptdb.bgf", 2], ["ptxb.bgf", 2], ["ptdr.bgf", 1], ["ptcd.bgf", 0.2],
      ["ptsa.bgf", 0.3], ["ptsb.bgf", 1], ["ptsc.bgf", 1.5], ["ptsd.bgf", 3], ["ptse.bgf", 1], ["ptsg.bgf", 2],
      ["ptsh.bgf", 2], ["ptsi.bgf", 3], ["ptsj.bgf", 2.5], ["ptsk.bgf", 2.5], ["ptsl.bgf", 1.5],
    ],
    eyes: ["pekx.bgf", "pelx.bgf", "pemx.bgf"],
    noses: ["pnkx.bgf", "pnlx.bgf", "pnmx.bgf"],
    mouths: ["pmkx.bgf", "pmlx.bgf", "pmmx.bgf"],
    beards: [["", 1]],
  },
};

/** [male, female] art */
type Art = [string, string];
type ArmArt = [[string, string], [string, string]];

/** What goes on top: a body, arms, and how they're coloured */
interface Top {
  weight: [number, number];
  body: Art;
  arms: ArmArt;
  /**
   * shirt: the arms in its colour; bare: bare arms (item.kod SetNakedArms, the light jerkin);
   * royal: two colours of cloth, no skin (royalsht.kod); robe: one colour all over, with its
   * own skirts (robebase.kod)
   */
  kind: "shirt" | "bare" | "royal" | "robe";
}
/** What goes below */
interface Bottom {
  weight: [number, number];
  legs: Art;
  skirt?: boolean;
}

/**
 * The clothing item classes' player art. Tops: shirtbase.kod (shirts), tanktop.kod (the light
 * jerkin), royalsht.kod, leather.kod (armour takes the shirt's colours: armor.kod
 * SetPaletteTranslation; seen from behind it shows a bare back, in the original too), and
 * robebase.kod. Bottoms: pantsc/d.kod (baggy trousers), skirt.kod, shrtskrt.kod, and
 * pantsa/b.kod, the same art as a player's own legs, which only some wear.
 */
const SHIRT_ARMS: ArmArt = [["bla.bgf", "bra.bgf"], ["blb.bgf", "brb.bgf"]];
const SHIRT_BODY: Art = ["bta.bgf", "btb.bgf"];
const TOPS: Top[] = [
  { weight: [5, 5], body: SHIRT_BODY, arms: SHIRT_ARMS, kind: "shirt" },
  { weight: [2, 1.5], body: SHIRT_BODY, arms: SHIRT_ARMS, kind: "bare" },
  { weight: [1, 1], body: SHIRT_BODY, arms: SHIRT_ARMS, kind: "royal" },
  { weight: [1, 0.6], body: ["btg.bgf", "bth.bgf"], arms: SHIRT_ARMS, kind: "shirt" },
  { weight: [3, 3], body: ["btc.bgf", "btd.bgf"], arms: [["blc.bgf", "brc.bgf"], ["bld.bgf", "brd.bgf"]], kind: "robe" },
];
const BOTTOMS: Bottom[] = [
  { weight: [6, 3], legs: ["bfe.bgf", "bff.bgf"] },
  { weight: [0.2, 3], legs: ["bfc.bgf", "bfd.bgf"], skirt: true },
  { weight: [0.1, 1.2], legs: ["bfg.bgf", "bfh.bgf"], skirt: true },
  { weight: [1.5, 1], legs: ["bfa.bgf", "bfb.bgf"] },
];
/** Robes come with their own long skirts (robebase.kod robe_legs_*) */
const ROBE_LEGS: Art = ["bfc.bgf", "bfd.bgf"];
/** Colours: shirts are brighter (no skin tones: they look bare), trousers mostly browns and greys (player.kod SetDefaultClothes picks pants from the skin browns) */
const SHIRT_COLORS: [number, number][] = [
  [C.RED, 2], [C.ORANGE, 0.5], [C.GREEN, 2], [C.BLUE, 2], [C.PURPLE, 1], [C.YELLOW, 1], [C.GRAY, 2], [C.SKY, 1], [C.DGREEN, 2], [C.BLACK, 1],
];
/** A royal shirt's two colours: no dark green or black, which only pair with skin (util.kod EncodeTwoColorXLAT) */
const ROYAL_COLORS: [number, number][] = [[C.RED, 2], [C.GREEN, 1], [C.BLUE, 2], [C.PURPLE, 2], [C.YELLOW, 2], [C.GRAY, 1], [C.SKY, 1]];
const PANTS_COLORS: [number, number][] = [[C.SKIN1, 3], [C.SKIN2, 3], [C.SKIN4, 2], [C.GRAY, 2], [C.BLACK, 2], [C.BLUE, 1], [C.DGREEN, 1]];
const SKIRT_COLORS: [number, number][] = [...PANTS_COLORS, [C.RED, 1], [C.PURPLE, 1], [C.GREEN, 1], [C.SKY, 0.5]];
const ROBE_COLORS: [number, number][] = [[C.BLUE, 2], [C.RED, 1], [C.PURPLE, 2], [C.DGREEN, 2], [C.GRAY, 2], [C.BLACK, 1], [C.SKIN1, 2], [C.SKY, 1], [C.YELLOW, 0.5]];

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

function weighted<T>(rand: () => number, list: readonly [T, number][]): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1][0];
}

const none = (group: number): Animation => ({ type: ANIMATE.NONE, group });
const cycle = (period: number, low: number, high: number): Animation => ({ type: ANIMATE.CYCLE, period, groupLow: low, groupHigh: high });

function overlay(file: string, hotspot: number, translation: number, animation: Animation): OverlayState {
  return { iconRes: localRes(file), hotspot, translation, effect: 0, animation, anim: animStateFrom(animation) };
}

/**
 * What someone carries and wears on their head (player.kod SendOverlays: plOverlays). A weapon
 * bends the right arm to hold it, a shield or torch the left (iRight_group 17, iLeft_group 7).
 */
export interface Gear {
  /** The weapon's overlay in the right hand (weapon.kod: group 4 held) */
  weapon?: string;
  /** A shield in the left hand: its overlay (group 2) and translation, and an emblem over it (soldshld.kod) */
  shield?: { file: string; xlat: number; emblem?: string };
  /** On the head (helmet.kod: HS_TOUPEE), and whether it hides the hair (helmets do: RemoveHair; circlets don't) */
  hat?: { file: string; hidesHair: boolean };
}

/** What a person is made of, kept so the looks can be built again (a wave, a turn) */
export interface Appearance {
  female: boolean;
  body: string;
  bodyXlat: number;
  arms: [string, string];
  armsXlat: number;
  legs: string;
  legsXlat: number;
  head: string;
  eyes: string;
  nose: string;
  mouth: string;
  /** "" when bald */
  hair: string;
  hairXlat: number;
  /** Facial hair, "" for none: on the mouth's hotspot in the hair colour (player.kod SendOverlays) */
  beard: string;
  skinXlat: number;
  gear?: Gear;
}

/** A random townsperson */
export function randomAppearance(rand: () => number): Appearance {
  const female = rand() < 0.5;
  const sex = female ? 1 : 0;
  const face = FACES[female ? "female" : "male"];
  const [skinXlat, skin] = pick(rand, SKINS);
  const top = weighted(rand, TOPS.map((t) => [t, t.weight[sex]] as [Top, number]));
  let shirt: number;
  let sleeves: number;
  if (top.kind === "royal") {
    const c1 = weighted(rand, ROYAL_COLORS);
    const others = ROYAL_COLORS.filter(([c]) => c !== c1);
    shirt = twoColorXlat(c1, weighted(rand, others));
    // Not the second colour on the arms: it's their hands' (they'd look gloved)
    sleeves = twoColorXlat(c1, skin);
  } else {
    shirt = twoColorXlat(weighted(rand, top.kind === "robe" ? ROBE_COLORS : SHIRT_COLORS), skin);
    // item.kod SetNakedArms: skin all over
    sleeves = top.kind === "bare" ? twoColorXlat(skin, skin) : shirt;
  }
  let legs: string, legsXlat: number;
  if (top.kind === "robe") [legs, legsXlat] = [ROBE_LEGS[sex], shirt];
  else {
    const bottom = weighted(rand, BOTTOMS.map((b) => [b, b.weight[sex]] as [Bottom, number]));
    [legs, legsXlat] = [bottom.legs[sex], twoColorXlat(weighted(rand, bottom.skirt ? SKIRT_COLORS : PANTS_COLORS), skin)];
  }
  return {
    female,
    body: top.body[sex],
    bodyXlat: shirt,
    arms: top.arms[sex],
    armsXlat: sleeves,
    legs,
    legsXlat,
    head: face.head,
    eyes: pick(rand, face.eyes),
    nose: pick(rand, face.noses),
    mouth: pick(rand, face.mouths),
    hair: weighted(rand, face.hair),
    hairXlat: weighted(rand, HAIR_COLORS),
    skinXlat,
    beard: weighted(rand, face.beards),
  };
}

/**
 * The arms' and legs' animations: standing, walking, and the emotes: waving the right hand,
 * pointing, dancing, casting a spell, swinging a weapon, and our cheer (a dance's frame, held)
 */
export type Pose = "stand" | "walk" | "wave" | "point" | "dance" | "cast" | "attack" | "cheer";

const once = (period: number, low: number, high: number, final: number): Animation => ({ type: ANIMATE.ONCE, period, groupLow: low, groupHigh: high, groupFinal: final });

/**
 * player.kod SendOverlays (standing, and PANM_WAVE, PANM_POINT, PANM_DANCE, PANM_CAST and
 * PANM_WEAPON_ATTACK), SendMoveOverlays (walking) and SendAnimation (the body bends into a
 * swing, and dances), with a lit torch in the left hand or not. The emotes that play once must
 * be built again to play again. A cheer is ours: one frame of the dance (`cheerFrame`, 0-16), held, the
 * body, arms and legs all at the same point in it.
 */
export function lookFor(a: Appearance, pose: Pose, torch = false, cheerFrame = 0): Look {
  const walk = pose === "walk";
  const gear = a.gear ?? {};
  const armed = !!gear.weapon;
  // A torch takes the shield's hand
  const shield = torch ? undefined : gear.shield;
  const leftHeld = torch || !!shield;
  const attack = pose === "attack" && armed;
  // The arms: bent to hold what they hold, else swinging as they walk
  const rightGroup = armed ? 17 : 1;
  const leftGroup = leftHeld ? 7 : 1;
  let right: Animation, left: Animation;
  switch (pose) {
    case "attack":
      right = armed ? once(300, 4, 6, 17) : none(rightGroup);
      left = armed ? once(300, 4, 6, leftGroup) : none(leftGroup);
      break;
    case "wave":
      right = armed ? none(17) : once(100, 7, 10, 1);
      left = none(leftGroup);
      break;
    case "point":
      right = once(700, 12, 12, rightGroup);
      left = none(leftGroup);
      break;
    case "cast":
      right = once(300, 11, 11, rightGroup);
      left = once(300, 8, 8, leftGroup);
      break;
    case "dance":
      right = cycle(150, 18, 34);
      left = cycle(150, 10, 26);
      break;
    case "cheer":
      right = none(18 + cheerFrame);
      left = none(10 + cheerFrame);
      break;
    default:
      right = armed ? none(17) : walk ? cycle(200, 2, 3) : none(1);
      left = leftHeld ? none(7) : walk ? cycle(200, 2, 3) : none(1);
  }
  const legs = attack ? once(900, 6, 6, 1) : pose === "dance" ? cycle(150, 8, 24) : pose === "cheer" ? none(8 + cheerFrame) : walk ? cycle(100, 2, 5) : none(1);
  const overlays = [
    overlay(a.arms[0], HS.LEFT_HAND, a.armsXlat, left),
    overlay(a.arms[1], HS.RIGHT_HAND, a.armsXlat, right),
    overlay(a.legs, HS.LEGS, a.legsXlat, legs),
    overlay(a.head, HS.HEAD, a.skinXlat, none(1)),
    overlay(a.mouth, HS.MOUTH, a.skinXlat, none(1)),
    overlay(a.eyes, HS.EYES, a.skinXlat, none(1)),
    overlay(a.nose, HS.NOSE, a.skinXlat, none(1)),
  ];
  // Facial hair before the hair, as the server sends it; helmets don't hide it
  if (a.beard) overlays.push(overlay(a.beard, HS.MOUTH, a.hairXlat, none(1)));
  if (a.hair && !gear.hat?.hidesHair) overlays.push(overlay(a.hair, HS.TOUPEE, a.hairXlat, none(1)));
  // Held and worn items come last (player.kod: plOverlays after the body's own)
  if (gear.hat) overlays.push(overlay(gear.hat.file, HS.TOUPEE, 0, none(1)));
  if (gear.weapon) overlays.push(overlay(gear.weapon, HS.RIGHT_WEAPON, 0, attack ? once(300, 1, 3, 4) : none(4)));
  if (shield) {
    overlays.push(overlay(shield.file, HS.LEFT_WEAPON, shield.xlat, none(2)));
    if (shield.emblem) overlays.push(overlay(shield.emblem, HS.LEFT_WEAPON, 0, none(1)));
  }
  if (torch) overlays.push(overlay(TORCH_OVERLAY, HS.LEFT_WEAPON, 0, cycle(60, 1, 6)));
  // The body bends into a swing and sways in a dance (player.kod SendAnimation)
  const body = attack ? once(300, 2, 4, 1) : pose === "dance" ? cycle(150, 6, 22) : pose === "cheer" ? none(6 + cheerFrame) : none(1);
  return { anim: animStateFrom(body), overlays, translation: a.bodyXlat };
}

/** Light a torch or put it out: the looks and the light change together */
export function setTorch(o: WorldObject, a: Appearance, pose: Pose, torch: boolean): void {
  o.normal = lookFor(a, pose === "walk" ? "stand" : pose, torch);
  o.moving = lookFor(a, "walk", torch);
  o.look = pose === "walk" ? o.moving : o.normal;
  o.info.overlays = o.look.overlays;
  o.info.light = torch ? { ...TORCH_LIGHT } : { ...NO_LIGHT };
  o.version++;
}

// ---- dressed for a part ----

/** A face, hair and skin, as anyone's (randomAppearance's) */
function person(rand: () => number, female: boolean): Pick<Appearance, "female" | "head" | "eyes" | "nose" | "mouth" | "hair" | "hairXlat" | "skinXlat" | "beard"> & { skin: number } {
  const face = FACES[female ? "female" : "male"];
  const [skinXlat, skin] = pick(rand, SKINS);
  return {
    female, head: face.head, eyes: pick(rand, face.eyes), nose: pick(rand, face.noses), mouth: pick(rand, face.mouths),
    hair: weighted(rand, face.hair), hairXlat: weighted(rand, HAIR_COLORS), skinXlat, skin,
    beard: weighted(rand, face.beards),
  };
}

/** Armour's player art (armor/*.kod): it takes the shirt's colour (armor.kod SetPaletteTranslation) */
const ARMOUR = {
  leather: ["btg.bgf", "bth.bgf"],
  chain: ["btk.bgf", "btl.bgf"],
  scale: ["bti.bgf", "btj.bgf"],
  plate: ["bte.bgf", "btf.bgf"],
  nerudite: ["btm.bgf", "btn.bgf"],
} as const satisfies Record<string, Art>;
/** Gauntlets on shirt sleeves (gauntlet.kod standardshirt_*_gauntlet_*) */
const GAUNTLET_ARMS: ArmArt = [["ble.bgf", "bre.bgf"], ["blf.bgf", "brf.bgf"]];
/**
 * Helmets (helmet/*.kod): [male, female]. Every helmet hides the hair (each class's NewUsed sends
 * RemoveHair); circlets don't. Not the steel helm (`whelm`): it was left out when hair showed
 * through helms.
 */
const HELMS = {
  simple: ["helm.bgf", "helmb.bgf"],
  war: ["warhelm.bgf", "warhelmb.bgf"],
  knight: ["khelm.bgf", "khelmb.bgf"],
  ornate: ["ornhelma.bgf", "ornhelmb.bgf"],
  dark: ["dhelma.bgf", "dhelmb.bgf"],
  legion: ["legionhelm.bgf", "legionhelmb.bgf"],
} as const satisfies Record<string, readonly [string, string]>;
type Helm = keyof typeof HELMS;
/** Circlets (circlet.kod, ivycircl.kod, thorncirclet.kod): over the hair */
const CIRCLETS = ["circlet.bgf", "ivycirov.bgf", "thocirclov.bgf"];
/** Weapons' overlays in the hand (weapon/*.kod) */
const WEAPONS = { sword: "swordov.bgf", shortSword: "shswdov.bgf", scimitar: "scimov.bgf", mace: "maceov.bgf", hammer: "hamrov.bgf", axe: "axeov.bgf" } as const;
/** Shields' overlays (shield/*.kod): metal, knight's, gold, nerudite */
const SHIELDS = ["metlshld.bgf", "mtlshld.bgf", "rshield.bgf", "nerushld.bgf"];
/** The armies' soldier shields (soldshld/*.kod): gshE.bgf in the army's colour, its emblem over it */
export const FACTIONS = {
  duke: { color: C.PURPLE, emblem: "gshdaov.bgf" },
  princess: { color: C.ORANGE, emblem: "gshprov.bgf" },
} as const;
export type Faction = keyof typeof FACTIONS;

function helm(female: boolean, kind: Helm): Gear["hat"] {
  const [m, f] = HELMS[kind];
  return { file: female ? f : m, hidesHair: true };
}

const PANTS: Art = ["bfe.bgf", "bff.bgf"];
const PLAIN_LEGS: Art = ["bfa.bgf", "bfb.bgf"];
/** Plain trousers, dark */
const DARK_PANTS: [number, number][] = [[C.BLACK, 3], [C.SKIN4, 2], [C.GRAY, 2], [C.SKIN2, 1]];

/** A town guard in the town's colours: leather, a plain helm, a sword or mace, sometimes a shield */
export function guardAppearance(rand: () => number, livery: number): Appearance {
  const p = person(rand, rand() < 0.25);
  const sex = p.female ? 1 : 0;
  const shirt = twoColorXlat(livery, p.skin);
  return {
    ...p, body: ARMOUR.leather[sex], bodyXlat: shirt, arms: SHIRT_ARMS[sex], armsXlat: shirt,
    legs: PLAIN_LEGS[sex], legsXlat: twoColorXlat(weighted(rand, DARK_PANTS), p.skin),
    gear: {
      hat: helm(p.female, rand() < 0.75 ? "simple" : "war"),
      weapon: rand() < 0.6 ? WEAPONS.sword : WEAPONS.mace,
      shield: rand() < 0.5 ? { file: "metlshld.bgf", xlat: 0 } : undefined,
    },
  };
}

/** A knight of an army: plate, gauntlets, the plain helm (it suits them best), the army's shield and a weapon */
export function knightAppearance(rand: () => number, faction: Faction): Appearance {
  const p = person(rand, rand() < 0.35);
  const sex = p.female ? 1 : 0;
  const army = FACTIONS[faction];
  const shirt = twoColorXlat(army.color, p.skin);
  return {
    ...p, body: ARMOUR.plate[sex], bodyXlat: shirt, arms: GAUNTLET_ARMS[sex], armsXlat: shirt,
    legs: PANTS[sex], legsXlat: twoColorXlat(weighted(rand, DARK_PANTS), p.skin),
    gear: {
      hat: helm(p.female, "simple"),
      weapon: weighted<string>(rand, [[WEAPONS.sword, 4], [WEAPONS.mace, 2], [WEAPONS.hammer, 1], [WEAPONS.axe, 1], [WEAPONS.scimitar, 1]]),
      shield: { file: "gshe.bgf", xlat: twoColorXlat(army.color, army.color), emblem: army.emblem },
    },
  };
}

/** A lady of the court: a robe in a rich colour and a circlet */
export function ladyAppearance(rand: () => number): Appearance {
  const p = person(rand, true);
  const robe = twoColorXlat(weighted(rand, ROYAL_COLORS), p.skin);
  return {
    ...p, body: "btd.bgf", bodyXlat: robe, arms: ["bld.bgf", "brd.bgf"], armsXlat: robe, legs: ROBE_LEGS[1], legsXlat: robe,
    gear: { hat: { file: pick(rand, CIRCLETS), hidesHair: false } },
  };
}

/** Robes' bodies and sleeves (robebase.kod) */
const ROBE_BODY: Art = ["btc.bgf", "btd.bgf"];
const ROBE_ARMS: ArmArt = [["blc.bgf", "brc.bgf"], ["bld.bgf", "brd.bgf"]];

/**
 * Nobility at court, men and women: a robe or a royal shirt in rich colours, with bright
 * trousers or a skirt, and mostly a circlet
 */
export function nobleAppearance(rand: () => number): Appearance {
  const p = person(rand, rand() < 0.45);
  const sex = p.female ? 1 : 0;
  const c1 = weighted(rand, ROYAL_COLORS);
  const c2 = weighted(rand, ROYAL_COLORS.filter(([c]) => c !== c1));
  const gear = rand() < 0.85 ? { hat: { file: pick(rand, CIRCLETS), hidesHair: false } } : undefined;
  if (rand() < 0.5) {
    const robe = twoColorXlat(c1, p.skin);
    return { ...p, body: ROBE_BODY[sex], bodyXlat: robe, arms: ROBE_ARMS[sex], armsXlat: robe, legs: ROBE_LEGS[sex], legsXlat: robe, gear };
  }
  // Not the second colour on the arms: it's their hands' (they'd look gloved)
  const skirt = p.female && rand() < 0.6;
  return {
    ...p, body: SHIRT_BODY[sex], bodyXlat: twoColorXlat(c1, c2), arms: SHIRT_ARMS[sex], armsXlat: twoColorXlat(c1, p.skin),
    legs: skirt ? ROBE_LEGS[1] : PANTS[sex], legsXlat: twoColorXlat(weighted(rand, skirt ? ROYAL_COLORS : [...ROYAL_COLORS, ...DARK_PANTS]), p.skin),
    gear,
  };
}

/**
 * A fighter at the arena: any armour, a helm or not, a weapon, often a shield. The arena's roster
 * (arena/arenaRoster.ts) says which armour (a key of ARMOUR, or "" for a plain shirt), which
 * weapon's overlay, and how likely a shield and a helm are.
 */
export function fighterAppearance(
  rand: () => number, opts: { armour?: string; weapon?: string; shield?: number; helm?: number; female?: boolean } = {},
): Appearance {
  const p = person(rand, opts.female ?? rand() < 0.4);
  const sex = p.female ? 1 : 0;
  const armour = opts.armour ?? weighted<keyof typeof ARMOUR>(rand, [["leather", 3], ["chain", 3], ["scale", 2], ["plate", 2], ["nerudite", 1]]);
  const body = (ARMOUR as Record<string, Art>)[armour] ?? SHIRT_BODY;
  const shirt = twoColorXlat(weighted(rand, SHIRT_COLORS), p.skin);
  const kind = weighted<Helm | null>(rand, [["simple", 1.5], ["war", 1], ["knight", 1], ["ornate", 0.5], ["dark", 0.5], ["legion", 0.5], [null, 2]]);
  const helmed = opts.helm === undefined ? kind : rand() < opts.helm ? (kind ?? "simple") : null;
  return {
    ...p, body: body[sex], bodyXlat: shirt, arms: (rand() < 0.5 ? GAUNTLET_ARMS : SHIRT_ARMS)[sex], armsXlat: shirt,
    legs: (rand() < 0.65 ? PANTS : PLAIN_LEGS)[sex], legsXlat: twoColorXlat(weighted(rand, PANTS_COLORS), p.skin),
    gear: {
      hat: helmed ? helm(p.female, helmed) : undefined,
      weapon: opts.weapon ?? pick(rand, Object.values(WEAPONS)),
      shield: rand() < (opts.shield ?? 0.6) ? { file: pick(rand, SHIELDS), xlat: 0 } : undefined,
    },
  };
}

/** A battle mage at the arena: a robe in a deep colour, no weapon, hands free for casting */
export function mageAppearance(rand: () => number, female?: boolean): Appearance {
  const p = person(rand, female ?? rand() < 0.45);
  const sex = p.female ? 1 : 0;
  const robe = twoColorXlat(weighted(rand, [[C.BLUE, 2], [C.PURPLE, 2], [C.RED, 1], [C.BLACK, 1.5], [C.DGREEN, 1], [C.SKY, 0.5]]), p.skin);
  return {
    ...p, body: ["btc.bgf", "btd.bgf"][sex], bodyXlat: robe, arms: ([["blc.bgf", "brc.bgf"], ["bld.bgf", "brd.bgf"]] as const)[sex].slice() as [string, string],
    armsXlat: robe, legs: ROBE_LEGS[sex], legsXlat: robe,
  };
}

/** Whether a player's body art is armour worth a second look (chain, scale, plate or nerudite) */
export function isImpressiveBody(file: string): boolean {
  const f = file.toLowerCase();
  return [ARMOUR.chain, ARMOUR.scale, ARMOUR.plate, ARMOUR.nerudite].some((a) => (a as readonly string[]).includes(f));
}

/** A townsperson as a room object, standing at (x, y) facing `angle` */
export function makePerson(a: Appearance, x: number, y: number, angle: number): WorldObject {
  const id = ambientId();
  const normal = lookFor(a, "stand");
  const info: ObjectInfo = {
    id, amount: 0, iconRes: localRes(a.body), nameRes: 0, flags: OF_PLAYER, drawingType: 0, minimapFlags: 0, nameColor: 0,
    objectType: 0, moveOnType: 0, light: { ...NO_LIGHT }, translation: a.bodyXlat, effect: 0,
    animation: none(1), overlays: normal.overlays,
  };
  return { id, info, x, y, angle, normal, moving: lookFor(a, "walk"), look: normal, motion: null, version: 0 };
}

/** Every art file townsfolk can wear, to load ahead of time */
export function townsfolkArt(): string[] {
  const out = new Set<string>([TORCH_OVERLAY]);
  for (const f of Object.values(FACES)) {
    out.add(f.head);
    for (const [h] of f.hair) if (h) out.add(h);
    for (const [b] of f.beards) if (b) out.add(b);
    for (const p of [...f.eyes, ...f.noses, ...f.mouths]) out.add(p);
  }
  for (const s of [0, 1]) {
    for (const t of TOPS) [t.body[s], ...t.arms[s]].forEach((p) => out.add(p));
    for (const b of BOTTOMS) out.add(b.legs[s]);
    out.add(ROBE_LEGS[s]);
    for (const a of Object.values(ARMOUR)) out.add(a[s]);
    GAUNTLET_ARMS[s].forEach((p) => out.add(p));
    for (const h of Object.values(HELMS)) out.add(h[s] as string);
    out.add(PANTS[s]);
    out.add(PLAIN_LEGS[s]);
  }
  for (const f of [...CIRCLETS, ...Object.values(WEAPONS), ...SHIELDS, "gshe.bgf"]) out.add(f);
  for (const f of Object.values(FACTIONS)) out.add(f.emblem);
  return [...out];
}
