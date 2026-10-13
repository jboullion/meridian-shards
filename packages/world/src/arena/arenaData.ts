// Ours (docs/adr/0007-arena.md): what the arena's fighters fight with: the spells, weapons and
// armour of the game, with the numbers its Kod gives them, and our archetypes made of them. These
// are the defaults; the relay's arena.json may change any of it (arenaConfig.ts).
//
// The numbers are the server's (cited file:line under server/src/kod/object); the arena is ours.
// "Spell power" is the caster's, 0-99, as Kod's iSpellPower.

import { ANIMATE, type Animation } from "@shards/protocol";

/** The spells, by key */
export type ArenaSpellKey = "fireball" | "lightning" | "firewall" | "bramble" | "poisonfog" | "web" | "blind" | "dazzle";

/** What a wall spell lays: wallelem/*.kod and monster/bramble.kod */
export type FieldKind = "fire" | "fog" | "web" | "bramble";

/** A status a curse puts on its target */
export type CurseKind = "blind" | "dazzle";

export interface ProjectileDef {
  /** The projectile's art (GetProjectileIcon) and animation (SendProjectileAnimation) */
  file: string;
  animation: Animation;
  /** Squares a second (GetProjectileSpeed) */
  speed: number;
  /** Its light's colour (LIGHT_* in blakston.khd), or 0 for none */
  light: number;
}

export interface ArenaSpellDef {
  label: string;
  /** bolt: a projectile that hurts; wall: elements on the floor; curse: a projectile that blinds or dazzles */
  kind: "bolt" | "wall" | "curse";
  /** viMana */
  mana: number;
  /** viPostCast_time (s): the caster can't cast again for this long */
  postCast: number;
  /** The most it's cast from (squares) */
  range: number;
  /** Its sound (vrSucceed_wav) */
  sound: string;
  /** A bolt's or curse's projectile */
  projectile?: ProjectileDef;
  /** A bolt's damage (GetDamage's random range) */
  damage?: [number, number];
  /** A curse: which, and its duration (ms) from spell power: (base + power * perPower), less up to deviation %, clamped */
  curse?: { status: CurseKind; base: number; perPower: number; extra?: [number, number]; deviation: number; min: number; max: number };
  /** A wall: its elements, laid in a line across the way or a square ahead, `ahead` squares in front */
  wall?: { field: FieldKind; count: number; layout: "line" | "square"; ahead: number; spacing: number };
}

const proj = (file: string, period: number, lo: number, hi: number, speed: number, light: number): ProjectileDef => ({
  file, animation: { type: ANIMATE.CYCLE, period, groupLow: lo, groupHigh: hi }, speed, light,
});

/** blakston.khd LIGHT_BORANGE, LIGHT_LIGHTNING */
const LIGHT_BORANGE = 0x7e40;
const LIGHT_LIGHTNING = 0x3dff;

export const ARENA_SPELLS: Record<ArenaSpellKey, ArenaSpellDef> = {
  // passive/spell/atakspel/boltspel/fireball.kod: 7 mana (:42), 9-15 damage (:59), speed 10, ffirebal.ogg (:29)
  fireball: {
    label: "Fireball", kind: "bolt", mana: 7, postCast: 2, range: 9, sound: "ffirebal.ogg", damage: [9, 15],
    projectile: proj("fireball.bgf", 40, 1, 2, 10, LIGHT_BORANGE),
  },
  // boltspel/lightnin.kod: 10 mana (:40), 13-18 damage (:60), speed 12, fbolt.ogg (:28)
  lightning: {
    label: "Lightning Bolt", kind: "bolt", mana: 10, postCast: 2, range: 9, sound: "fbolt.ogg", damage: [13, 18],
    projectile: proj("lightnin.bgf", 40, 2, 3, 12, LIGHT_LIGHTNING),
  },
  // walspell/firewall.kod: 15 mana (:41), 9 elements (:50) across the way, farenwala822m.ogg (:30)
  firewall: { label: "Wall of Fire", kind: "wall", mana: 15, postCast: 3, range: 7, sound: "farenwala822m.ogg", wall: { field: "fire", count: 9, layout: "line", ahead: 1, spacing: 0.5 } },
  // walspell/brmblwll.kod: 10 mana, 5 brambles (viNumElements) in a line a square ahead (PlaceWallElements)
  bramble: { label: "Bramble Wall", kind: "wall", mana: 10, postCast: 3, range: 6, sound: "faren.ogg", wall: { field: "bramble", count: 5, layout: "line", ahead: 1, spacing: 1 } },
  // walspell/summpfog.kod: 20 mana (:43), a square of clouds two squares ahead, qor.ogg
  poisonfog: { label: "Poison Fog", kind: "wall", mana: 20, postCast: 3, range: 6, sound: "qor.ogg", wall: { field: "fog", count: 9, layout: "square", ahead: 2, spacing: 1 } },
  // walspell/summweb.kod: 15 mana, 9 webs (viNumElements) in a square two squares ahead (PlaceWallElements), farenwala822m.ogg
  web: { label: "Spider Web", kind: "wall", mana: 15, postCast: 3, range: 6, sound: "farenwala822m.ogg", wall: { field: "web", count: 9, layout: "square", ahead: 2, spacing: 1 } },
  // debuff/blind.kod: 15 mana (:52), 4000 + power * 60 ms less up to 10% (:63-65, :164-165), 4-18 s (:68-69), qblind.ogg, blindring.bgf at speed 10
  blind: {
    label: "Blind", kind: "curse", mana: 15, postCast: 2, range: 8, sound: "qblind.ogg",
    curse: { status: "blind", base: 4000, perPower: 60, deviation: 10, min: 4000, max: 18000 },
    projectile: proj("blindring.bgf", 80, 1, 6, 10, 0),
  },
  // debuff/dazzle.kod: 12 mana (:48), 3000 + power * 40 + 1-10 s, clamped 4-18 s, less up to 10% (:151-157), sDazzle.ogg, dazzlestar.bgf
  dazzle: {
    label: "Dazzle", kind: "curse", mana: 12, postCast: 2, range: 8, sound: "sdazzle.ogg",
    curse: { status: "dazzle", base: 3000, perPower: 40, extra: [1000, 10000], deviation: 10, min: 4000, max: 18000 },
    projectile: proj("dazzlestar.bgf", 80, 1, 6, 10, 0),
  },
};

export interface FieldDef {
  /** The element's art, animation and DRAWFX_* */
  file: string;
  animation: Animation;
  drawFx: number;
  light?: { flags: number; intensity: number; color: number };
}

/**
 * The elements (wallelem/*.kod, monster/bramble.kod): art, animation and drawing. What each does
 * is in arenaSim.ts; how long they last and how hard they bite come from the spell power there.
 */
export const ARENA_FIELDS: Record<FieldKind, FieldDef> = {
  // wallelem/wallfire.kod: woflame.bgf, translucent, LIGHT_RED (brighter here so the walls light the floor)
  fire: { file: "woflame.bgf", animation: { type: ANIMATE.CYCLE, period: 100, groupLow: 1, groupHigh: 5 }, drawFx: 2, light: { flags: 0x3, intensity: 30, color: 0x5000 } },
  // wallelem/poisfogc.kod: poisoncl.bgf
  fog: { file: "poisoncl.bgf", animation: { type: ANIMATE.CYCLE, period: 240, groupLow: 1, groupHigh: 5 }, drawFx: 2 },
  // wallelem/web.kod: webspell.bgf
  web: { file: "webspell.bgf", animation: { type: ANIMATE.NONE, group: 1 }, drawFx: 0 },
  // monster/bramble.kod SendAnimation: grows over groups 1-5 every 250 ms, then shows its health (group 1-5)
  bramble: { file: "wothorns.bgf", animation: { type: ANIMATE.ONCE, period: 250, groupLow: 1, groupHigh: 5, groupFinal: 5 }, drawFx: 0 },
};

/** wallelem.kod EFFECT_INTERVAL (:21), bramble.kod (:22): a wall touches each person at most once a cycle */
export const EFFECT_INTERVAL_MS = 1500;

/** The webs' overlay on someone stuck in them (summweb.kod SummonWeb_overlay, on HS_LEGS) */
export const WEB_OVERLAY = "webov.bgf";

/** item/passitem/weapon.kod: the damage of each kind (:30-38) */
export const WEAPON_DAMAGE = {
  thrust: [3, 8],
  bludgeon: [4, 8],
  slash: [7, 13],
} as const;
export type WeaponKind = keyof typeof WEAPON_DAMAGE;

export interface ArenaWeaponDef {
  label: string;
  /** Its overlay in the hand (vrWeapon_overlay) */
  overlay: string;
  kind: WeaponKind;
  /** weapon.kod: WEAPON_LOW_QUALITY_DAMAGE -1, HIGH +1, NERUDITE +1 (:67-69) */
  quality: number;
  /** Reach beyond arm's length (fine units: WEAPON_RANGE_* :50-52) */
  reach: number;
  /** ms between swings */
  swingMs: number;
}

export const ARENA_WEAPONS: Record<string, ArenaWeaponDef> = {
  // weapon/shrtswrd.kod: thrust, low quality, shswdov.bgf
  shortsword: { label: "short sword", overlay: "shswdov.bgf", kind: "thrust", quality: -1, reach: 128, swingMs: 900 },
  // weapon/longswrd.kod: thrust, normal, swordov.bgf
  longsword: { label: "long sword", overlay: "swordov.bgf", kind: "thrust", quality: 0, reach: 128, swingMs: 1000 },
  // weapon/scimitar.kod: slash, high quality, scimov.bgf
  scimitar: { label: "scimitar", overlay: "scimov.bgf", kind: "slash", quality: 1, reach: 128, swingMs: 1100 },
  // weapon/axe.kod: slash, normal, axeov.bgf
  axe: { label: "axe", overlay: "axeov.bgf", kind: "slash", quality: 0, reach: 128, swingMs: 1200 },
  // weapon/mace.kod: bludgeon, low quality, maceov.bgf
  mace: { label: "mace", overlay: "maceov.bgf", kind: "bludgeon", quality: -1, reach: 128, swingMs: 1000 },
  // weapon/hammer.kod: bludgeon, normal, hamrov.bgf
  hammer: { label: "hammer", overlay: "hamrov.bgf", kind: "bludgeon", quality: 0, reach: 128, swingMs: 1200 },
  // weapon/neruswd.kod: thrust, nerudite, nerswdov.bgf
  nerudite: { label: "nerudite sword", overlay: "nerswdov.bgf", kind: "thrust", quality: 1, reach: 128, swingMs: 1000 },
};

/** Armour, by its player art (armor/*.kod): how much it takes off a blow, and how much harder it is to hit */
export const ARENA_ARMOUR: Record<string, { label: string; files: [string, string]; soak: number; dodge: number }> = {
  leather: { label: "leather armour", files: ["btg.bgf", "bth.bgf"], soak: 1, dodge: 0.03 },
  chain: { label: "chain mail", files: ["btk.bgf", "btl.bgf"], soak: 2, dodge: 0.05 },
  scale: { label: "scale armour", files: ["bti.bgf", "btj.bgf"], soak: 2, dodge: 0.08 },
  plate: { label: "plate armour", files: ["bte.bgf", "btf.bgf"], soak: 3, dodge: 0.1 },
  nerudite: { label: "nerudite armour", files: ["btm.bgf", "btn.bgf"], soak: 4, dodge: 0.1 },
};

/**
 * The AI's temper: a fighter closes in; a caster keeps `keepAway` squares off and casts within
 * `castRange`, every `castEvery` ms or so (mana and post-cast times allowing). A fighter with
 * spells casts them when its spell timer allows, mostly at range.
 */
export interface ArenaTemper {
  keepAway: number;
  castRange: number;
  castEvery: [number, number];
}

export interface ArchetypeDef {
  label: string;
  /** Fights with a weapon, or a caster's hands */
  role: "fighter" | "mage";
  hp: [number, number];
  mana: number;
  /** Mana back a second */
  manaRegen: number;
  /** Added to a weapon's damage (a strong arm) */
  might: [number, number];
  /** Kod's iSpellPower (0-99) for the walls' and curses' strength */
  power: number;
  /** Base chance a swing lands, before the target's armour */
  hit: number;
  weapons: string[];
  /** Spells and how often each is wanted */
  spells: [ArenaSpellKey, number][];
  /** Armour worn ([key, weight]; "" for none), and the chance of a shield and a helm */
  armour: [string, number][];
  shield: number;
  helm: number;
  temper: ArenaTemper;
}

const FIGHTER_TEMPER: ArenaTemper = { keepAway: 0, castRange: 7, castEvery: [6000, 12000] };
const MAGE_TEMPER: ArenaTemper = { keepAway: 4, castRange: 8, castEvery: [3500, 7000] };

export const ARENA_ARCHETYPES: Record<string, ArchetypeDef> = {
  warrior: {
    label: "Warrior", role: "fighter", hp: [95, 120], mana: 0, manaRegen: 0, might: [1, 3], power: 0, hit: 0.65,
    weapons: ["longsword", "axe", "hammer", "mace"], spells: [], armour: [["chain", 3], ["scale", 2], ["leather", 1]], shield: 0.6, helm: 0.6,
    temper: FIGHTER_TEMPER,
  },
  knight: {
    label: "Knight", role: "fighter", hp: [105, 130], mana: 0, manaRegen: 0, might: [0, 2], power: 0, hit: 0.6,
    weapons: ["longsword", "mace", "nerudite"], spells: [], armour: [["plate", 3], ["nerudite", 1]], shield: 0.9, helm: 0.9,
    temper: FIGHTER_TEMPER,
  },
  duelist: {
    label: "Duelist", role: "fighter", hp: [80, 100], mana: 0, manaRegen: 0, might: [0, 2], power: 0, hit: 0.75,
    weapons: ["scimitar", "shortsword"], spells: [], armour: [["leather", 3], ["chain", 1]], shield: 0.1, helm: 0.3,
    temper: FIGHTER_TEMPER,
  },
  kraanan: {
    label: "Kraanan war-mage", role: "fighter", hp: [85, 105], mana: 50, manaRegen: 1.2, might: [0, 2], power: 50, hit: 0.62,
    weapons: ["longsword", "hammer", "axe"], spells: [["dazzle", 2], ["fireball", 1]], armour: [["chain", 2], ["leather", 2]], shield: 0.3, helm: 0.5,
    temper: FIGHTER_TEMPER,
  },
  faren: {
    label: "Faren battle mage", role: "mage", hp: [65, 80], mana: 90, manaRegen: 2, might: [0, 0], power: 70, hit: 0.4,
    weapons: [], spells: [["fireball", 3], ["lightning", 2], ["firewall", 1.5], ["bramble", 1.5], ["web", 1.5]], armour: [], shield: 0, helm: 0,
    temper: MAGE_TEMPER,
  },
  qor: {
    label: "Qor shadowcaster", role: "mage", hp: [65, 80], mana: 90, manaRegen: 2, might: [0, 0], power: 70, hit: 0.4,
    weapons: [], spells: [["blind", 2.5], ["poisonfog", 2], ["lightning", 2], ["web", 1]], armour: [], shield: 0, helm: 0,
    temper: MAGE_TEMPER,
  },
  shalille: {
    label: "Shal'ille mystic", role: "mage", hp: [70, 85], mana: 80, manaRegen: 2, might: [0, 0], power: 60, hit: 0.4,
    weapons: [], spells: [["dazzle", 3], ["lightning", 2], ["bramble", 1.5]], armour: [], shield: 0, helm: 0,
    temper: MAGE_TEMPER,
  },
  riija: {
    label: "Riija trickster", role: "mage", hp: [65, 80], mana: 85, manaRegen: 2, might: [0, 0], power: 65, hit: 0.4,
    weapons: [], spells: [["web", 2.5], ["dazzle", 2], ["blind", 1.5], ["fireball", 1.5]], armour: [], shield: 0, helm: 0,
    temper: MAGE_TEMPER,
  },
};

/** The art the arena can draw (projectiles, elements, overlays), to load ahead of time */
export function arenaArt(spells: Record<string, ArenaSpellDef> = ARENA_SPELLS, weapons: Record<string, ArenaWeaponDef> = ARENA_WEAPONS): string[] {
  const out = new Set<string>([WEB_OVERLAY]);
  for (const s of Object.values(spells)) if (s.projectile) out.add(s.projectile.file);
  for (const f of Object.values(ARENA_FIELDS)) out.add(f.file);
  for (const w of Object.values(weapons)) out.add(w.overlay);
  return [...out];
}
