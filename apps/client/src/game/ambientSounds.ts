// Ours: the sounds of ambient life and the weather (the Ambient Sounds option), none of them the
// server's. Each frame the scene says what's about (how many townsfolk, the room's kind, the
// rain) and what happened (a swing, a cheer, a strike), and this plays it:
//   - a bed of chatter under the townsfolk, courtiers and the arena's crowd, as loud as how many
//     are about, muffled in the rain;
//   - the arena (arena/, docs/adr/0007-arena.md): what the game plays for a fight: weapons
//     swinging and striking by how hard (player.kod DoHitMessageSound), the hurt crying out by how
//     hurt (GetOuchSound), each spell's own sound, webs, brambles and fire frying whoever they
//     catch, the fog's cough; and the stands' cheers and applause;
//   - inns: no chatter, but the hearth, the door as people come and go, a chair creaking, and
//     the patrons' dice and drinks now and then;
//   - the Office of the Justicar's court (docs/adr/0026): no murmur (2026-10-27), but a cough
//     from the gallery now and then (the judge's gavel is the server's);
//   - thunder after each lightning strike, later and duller the further off;
//   - critters squeaking now and then, fish splashing;
//   - splashing steps through puddles.
// Birds, bats, butterflies, fireflies and leaves are silent.
// Only where people live (towns, inns, castles, the arena): the wilds keep the original's sounds
// alone, but for thunder with the lightning.
// The game's own sounds where they fit; the chatter, crowd and thunder recordings are CC0
// (tools/assets/fetch-sounds.ts). docs/ambient-sounds.md lists every cue.

import { FINENESS } from "@shards/formats";
import { ARENA_SPELLS, type AmbientEvent, type AmbientKind, type ArenaEvent } from "@shards/world";
import type { AmbientSound, GameAudio } from "./audio.ts";

const SQ = FINENESS;

/** What's about this frame, and what happened */
export interface AmbientSoundFrame {
  dt: number;
  listener: { x: number; y: number; angle: number };
  /** The room's file, and its kind of ambient life (null: none) */
  room: string;
  kind: AmbientKind | null;
  /** No sky over the room */
  indoors: boolean;
  /**
   * A town, inn, castle or the arena (or a room whose terrain says people live there). Elsewhere,
   * in the wilds, nothing of ours plays but thunder: the original's own sounds are enough there.
   */
  populated: boolean;
  /** Ambient people within earshot */
  people: number;
  /** The game hour (null: not known): the streets fall quiet at night */
  hour: number | null;
  raining: boolean;
  events: AmbientEvent[];
  /** What the arena's fights did (ArenaView.takeEvents) */
  arenaEvents: ArenaEvent[];
  /** A lightning strike just now (which way from the eye, radians from east toward south, and how far, squares) */
  strike: { yaw: number; distance: number } | null;
  /** A fish leaping (small) or landing (big) */
  splashes: { x: number; y: number; big: boolean }[];
  /** A critter about us to make a noise, asked now and then */
  critterVoice: () => { x: number; y: number; sound: string } | null;
  /** A pet about us to make its noise (docs/adr/0006-pets.md 5.5), asked every minute or two */
  petVoice: () => { x: number; y: number; sound: string } | null;
  /** Standing in a puddle, and how fast we move (fine units a ms) */
  wetUnderfoot: boolean;
  speed: number;
}

/** The chatter under each kind of crowd: the file, how loud, and how many people make it full */
const BEDS: Partial<Record<AmbientKind, { file: string; indoorFile?: string; volume: number; full: number }>> = {
  town: { file: "amb_town_talk.ogg", volume: 0.18, full: 7 },
  castle: { file: "amb_town_talk.ogg", indoorFile: "amb_hall_talk.ogg", volume: 0.15, full: 5 },
  arena: { file: "amb_hall_talk.ogg", volume: 0.29, full: 10 },
};

/** The Office of the Justicar's court: its gallery is the server's NPCs (courtassizes.kod) */
const COURT_ROOM = "barcourt.roo";

/**
 * The court's gallery coughs now and then, one cough at a time: each recording holds several,
 * and each entry is one of them (`offset` and `seconds`, found from the recordings' loudness,
 * with a little lead-in and tail). Every 20-40 s.
 */
const COURT_COUGHS: readonly { file: string; offset: number; seconds: number }[] = [
  { file: "amb_cough_m.ogg", offset: 0.35, seconds: 0.9 },
  { file: "amb_cough_m.ogg", offset: 2.6, seconds: 0.9 },
  { file: "amb_cough_m.ogg", offset: 4.7, seconds: 0.55 },
  { file: "amb_cough_m.ogg", offset: 6.25, seconds: 0.55 },
  { file: "amb_cough_f.ogg", offset: 0.55, seconds: 1.1 },
  { file: "amb_cough_f.ogg", offset: 2.5, seconds: 0.95 },
  { file: "amb_cough_f.ogg", offset: 4.45, seconds: 1.1 },
];
const COURT_COUGH_EVERY: [number, number] = [20000, 40000];

/**
 * The inns, whoever is about: no chatter (2026-10-27), but a hearth under the room, the door across
 * the room as people come and go, and a chair creaking now and then.
 */
const INN_HEARTH = { file: "amb_fireplace.ogg", volume: 0.6 };
/** room.kod's creaky door (creaky_door_sound), quieter and duller than ours going through it */
const INN_DOOR = "doropen1.ogg";
const INN_DOOR_EVERY: [number, number] = [30000, 70000];
/**
 * A second or three of a recording of forty-odd creaks, a creak every second or so and never more
 * than 2 s apart (found from its loudness), so each piece holds one or two
 */
const INN_CHAIR = { file: "amb_chair.ogg", seconds: 55 };
const INN_CHAIR_EVERY: [number, number] = [25000, 60000];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length) % list.length];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A weapon swung (stroke.kod: swswish1-3) and missing (swordmis.ogg) */
const SWISH = ["swswish1.ogg", "swswish2.ogg", "swswish3.ogg"];
const MISS = "swordmis.ogg";
/** player.kod DoHitMessageSound (:754-764): flesh up to 3 health, leather up to 6, metal beyond */
const HITS = {
  metal: ["mhit1b.ogg", "mhit2b.ogg", "mhit3b.ogg"],
  leather: ["lhit1b.ogg", "lhit2b.ogg", "lhit3b.ogg"],
  flesh: ["fhit1b.ogg", "fhit2b.ogg", "fhit3b.ogg"],
} as const;
/** player.kod GetOuchSound (:767-775): "in increasing order of agony" */
const OUCH = { male: ["ouchm1.ogg", "ouchm2.ogg", "ouchm3.ogg", "ouchm4.ogg"], female: ["ouchf1.ogg", "ouchf2.ogg", "ouchf3.ogg", "ouchf4.ogg"] };
const CHEERS: [string, number][] = [["huzzah.ogg", 0.5], ["arena.ogg", 0.45], ["amb_cheer1.ogg", 0.32], ["amb_cheer2.ogg", 0.32]];
/** web.kod web_stick_snd, bramble.kod Brambles_scratch_snd, wallfire.kod firewall_burn_snd: all frying.ogg */
const FRYING = "frying.ogg";
/** poisfogc.kod PoisonFogCloud_poison_snd */
const COUGH = "psncough.ogg";
const ZAP = ["zaphit1.ogg", "zaphit2.ogg", "zaphit3.ogg"];
const THUNDER = ["amb_thunder1.ogg", "amb_thunder2.ogg", "amb_thunder3.ogg", "amb_thunder4.ogg"];

export class AmbientSounds {
  private readonly audio: GameAudio;
  private bed: { file: string; sound: AmbientSound; volume: number } | null = null;
  private critterMs = 4000;
  private petMs = 30000;
  private cheerMs = 0;
  private stepMs = 0;
  private coughMs = 0;
  private doorMs = 0;
  private chairMs = 0;

  constructor(audio: GameAudio) {
    this.audio = audio;
  }

  update(f: AmbientSoundFrame): void {
    if (!this.audio.ambientOn) {
      if (this.bed) this.stop(300);
      return;
    }
    this.cheerMs -= f.dt;
    // Thunder goes with the lightning everywhere
    if (f.strike) this.thunder(f.strike, f.listener.angle);
    if (!f.populated) {
      if (this.bed) this.stop(800);
      return;
    }
    this.updateBed(f);
    for (const e of f.events) this.event(e);
    for (const e of f.arenaEvents) this.arenaEvent(e);
    for (const s of f.splashes) this.audio.playAmbient("splash.ogg", { at: s, range: 22 * SQ, volume: s.big ? 0.45 : 0.25, rate: s.big ? 1 : 1.3 });
    this.updateCritters(f);
    this.updatePets(f);
    this.updateSteps(f);
    this.updateCourt(f);
    this.updateInn(f);
  }

  /**
   * Dev tools: hear one cue by itself, about us (window.shards.gameScene.ambientSoundBoard.audition("thunder")).
   * Cues: town, hall (5 s of each chatter), inn (5 s of the hearth), inn-door, inn-chair, court-cough, swing, miss, hit, cast-fire, cast-lightning, zap,
   * blind, dazzle, frying, cough, cheer, applause, thunder, critter, splash, step, dice, drink,
   * ouch, death
   */
  audition(cue: string): string[] {
    const a = this.audio;
    const once = (file: string, volume = 0.6, o = {}) => a.playAmbient(file, { volume, ...o });
    const taste = (file: string, volume: number) => {
      const s = a.playAmbient(file, { volume, offset: "random", fadeIn: 500 });
      setTimeout(() => s.stop(800), 5000);
    };
    switch (cue) {
      case "town": taste(BEDS.town!.file, BEDS.town!.volume); break;
      case "inn": taste(INN_HEARTH.file, INN_HEARTH.volume); break;
      case "inn-door": this.innDoor(); break;
      case "inn-chair": this.innChair(); break;
      case "hall": taste(BEDS.arena!.file, BEDS.arena!.volume); break;
      case "court-cough": this.courtCough(); break;
      case "swing": once(pick(SWISH), 0.45); break;
      case "miss": once(MISS, 0.4); break;
      case "hit": once(pick(HITS.metal), 0.55); break;
      case "blind": once("qblind.ogg", 0.5); break;
      case "dazzle": once("sdazzle.ogg", 0.5); break;
      case "frying": once(FRYING, 0.45); break;
      case "cough": once(COUGH, 0.45); break;
      case "cast-fire": once("ffirebal.ogg", 0.5); break;
      case "cast-lightning": once("fbolt.ogg", 0.5); break;
      case "zap": once("zaphit1.ogg", 0.35); break;
      case "cheer": { const [f, v] = pick(CHEERS); once(f, v); break; }
      case "applause": taste("amb_applause.ogg", 0.32); break;
      case "thunder": this.thunder({ yaw: Math.random() * 2 * Math.PI, distance: rnd(45, 70) }, 0); break;
      case "critter": once("rat_awr.ogg", 0.28, { rate: 1.3 }); break;
      case "splash": once("splash.ogg", 0.45); break;
      case "step": once("weatstp1.ogg", 0.3); break;
      case "dice": once("dice.ogg", 0.45); break;
      case "drink": once("drink.ogg", 0.175); break;
      case "ouch": once(pick(OUCH.male), 0.35); break;
      case "death": once("pdeath.ogg", 0.5); break;
    }
    return [
      "town", "inn", "inn-door", "inn-chair", "hall", "court-cough", "swing", "miss", "hit", "cast-fire", "cast-lightning", "zap", "blind", "dazzle", "frying", "cough", "cheer", "applause",
      "thunder", "critter", "splash", "step", "dice", "drink", "ouch", "death",
    ];
  }

  /** Everything stops: another room's sounds start from nothing */
  stop(fadeMs = 800): void {
    this.bed?.sound.stop(fadeMs);
    this.bed = null;
  }

  // ---- chatter ----

  private updateBed(f: AmbientSoundFrame): void {
    // (A shop's one or two customers make no crowd)
    // The towns' streets fall quiet at night (20 to 5): no talk under the few still out
    const night = f.hour !== null && (f.hour >= 20 || f.hour < 5);
    const spec = f.kind && !(night && f.kind === "town") ? (BEDS[f.kind] ?? null) : null;
    const own = f.kind === "inn" ? INN_HEARTH : undefined;
    const file = own ? own.file : spec ? (f.indoors && spec.indoorFile) || spec.file : null;
    let volume = own ? own.volume : spec && f.people > 0 ? spec.volume * Math.min(1, 0.25 + (0.75 * f.people) / spec.full) : 0;
    // The rain drowns out the street, and muffles it
    const wet = f.raining && !f.indoors;
    if (wet) volume *= 0.6;
    if (this.bed && (this.bed.file !== file || volume === 0 || this.bed.sound.done)) {
      this.bed.sound.stop(1500);
      this.bed = null;
    }
    if (!file || volume === 0) return;
    if (!this.bed) {
      this.bed = { file, volume, sound: this.audio.playAmbient(file, { loop: true, volume, offset: "random", fadeIn: 2500, lowpass: wet ? 1600 : 20000 }) };
      return;
    }
    if (Math.abs(this.bed.volume - volume) > 0.01) {
      this.bed.volume = volume;
      this.bed.sound.setVolume(volume, 1500);
    }
    this.bed.sound.setLowpass(wet ? 1600 : 20000, 2000);
  }

  /** The court's gallery: a cough now and then, from somewhere about us */
  private updateCourt(f: AmbientSoundFrame): void {
    if (f.room.toLowerCase() !== COURT_ROOM) {
      this.coughMs = rnd(...COURT_COUGH_EVERY);
      return;
    }
    this.coughMs -= f.dt;
    if (this.coughMs > 0) return;
    this.coughMs = rnd(...COURT_COUGH_EVERY);
    this.courtCough();
  }

  private courtCough(): void {
    const c = pick(COURT_COUGHS);
    this.audio.playAmbient(c.file, { volume: rnd(0.12, 0.2), offset: c.offset, duration: c.seconds, pan: rnd(-0.7, 0.7), lowpass: 6000, rate: rnd(0.95, 1.05) });
  }

  /** An inn: someone at the door and a chair creaking, now and then, from somewhere about us */
  private updateInn(f: AmbientSoundFrame): void {
    if (f.kind !== "inn") {
      this.doorMs = rnd(...INN_DOOR_EVERY);
      this.chairMs = rnd(...INN_CHAIR_EVERY);
      return;
    }
    if ((this.doorMs -= f.dt) <= 0) {
      this.doorMs = rnd(...INN_DOOR_EVERY);
      this.innDoor();
    }
    if ((this.chairMs -= f.dt) <= 0) {
      this.chairMs = rnd(...INN_CHAIR_EVERY);
      this.innChair();
    }
  }

  private innDoor(): void {
    this.audio.playAmbient(INN_DOOR, { volume: rnd(0.15, 0.25), pan: rnd(-0.8, 0.8), lowpass: 3000, rate: rnd(0.92, 1.05) });
  }

  private innChair(): void {
    const seconds = rnd(2.2, 3.5);
    this.audio.playAmbient(INN_CHAIR.file, {
      volume: rnd(0.15, 0.25), offset: rnd(0.2, INN_CHAIR.seconds - seconds), duration: seconds, fadeIn: 150,
      pan: rnd(-0.7, 0.7), lowpass: 7000, rate: rnd(0.95, 1.05),
    });
  }

  // ---- what the crowd did ----

  private event(e: AmbientEvent): void {
    const at = { x: e.x, y: e.y };
    const a = this.audio;
    switch (e.type) {
      case "flee":
        a.playAmbient(pick(e.female ? OUCH.female : OUCH.male), { at, range: 18 * SQ, volume: 0.35, rate: rnd(1.05, 1.2) });
        break;
      case "dice":
        a.playAmbient("dice.ogg", { at, range: 12 * SQ, volume: 0.45 });
        break;
      case "drink":
        a.playAmbient("drink.ogg", { at, range: 10 * SQ, volume: 0.175 });
        break;
    }
  }

  /** The hurt's cry, by how hurt (ArenaEvent's ouch, 1-4; 0 for none) */
  private ouch(at: { x: number; y: number }, level: number, female: boolean, delay = 0): void {
    if (level < 1) return;
    const list = female ? OUCH.female : OUCH.male;
    this.audio.playAmbient(list[Math.min(4, level) - 1], { at, range: 16 * SQ, volume: 0.35, delay });
  }

  /** What an arena fight did (the sim's events, arenaWire.ts) */
  private arenaEvent(e: ArenaEvent): void {
    const at = { x: e.x, y: e.y };
    const a = this.audio;
    switch (e.type) {
      case "swing":
        a.playAmbient(pick(SWISH), { at, range: 16 * SQ, volume: 0.45, rate: rnd(0.95, 1.1) });
        if (!e.hit) {
          a.playAmbient(MISS, { at, range: 14 * SQ, volume: 0.3, delay: 150, rate: rnd(0.95, 1.05) });
          break;
        }
        a.playAmbient(pick(HITS[e.hit]), { at, range: 16 * SQ, volume: 0.55, delay: 180, rate: rnd(0.95, 1.05) });
        this.ouch(at, e.ouch, e.female, 260);
        break;
      case "cast": {
        const sound = ARENA_SPELLS[e.spell as keyof typeof ARENA_SPELLS]?.sound;
        if (sound) a.playAmbient(sound, { at, range: 22 * SQ, volume: 0.5 });
        break;
      }
      case "impact":
        if (e.spell === "lightning") a.playAmbient(pick(ZAP), { at, range: 18 * SQ, volume: 0.35 });
        // player.kod DoHitMessageSound: an attack spell's victim cries out
        this.ouch(at, e.ouch, e.female, 120);
        break;
      case "stuck":
      case "scratch":
      case "burn":
        a.playAmbient(FRYING, { at, range: 14 * SQ, volume: 0.4, rate: rnd(0.95, 1.05) });
        this.ouch(at, e.ouch, e.female, 200);
        break;
      case "poisoned":
        a.playAmbient(COUGH, { at, range: 14 * SQ, volume: 0.4 });
        break;
      case "chop":
        break;
      case "cheer":
        if (this.cheerMs > 0) return;
        this.cheerMs = rnd(2400, 6000);
        {
          const [file, volume] = pick(CHEERS);
          a.playAmbient(file, { at, range: 40 * SQ, volume, rate: rnd(0.92, 1.08) });
        }
        break;
      case "death":
        // player.kod's death cries (playerm_death_wav, playerf_death_wav)
        a.playAmbient(e.female ? "pdeathf.ogg" : "pdeath.ogg", { at, range: 24 * SQ, volume: 0.5, rate: rnd(0.95, 1.05) });
        break;
      case "victory": {
        // A round won: applause and a huzzah
        const clap = a.playAmbient("amb_applause.ogg", { at, range: 40 * SQ, volume: 0.32, offset: rnd(0, 15), fadeIn: 300 });
        setTimeout(() => clap.stop(1500), rnd(3000, 5000));
        a.playAmbient("huzzah.ogg", { at, range: 40 * SQ, volume: 0.45, delay: 200 });
        break;
      }
    }
  }

  // ---- the weather ----

  /** Thunder after a strike: later, quieter and duller the further off, from its side */
  private thunder(s: { yaw: number; distance: number }, facing: number): void {
    const a = (facing * 2 * Math.PI) / 4096;
    const far = Math.min(1, Math.max(0, (s.distance - 40) / 35));
    this.audio.playAmbient(pick(THUNDER), {
      volume: rnd(0.75, 0.95) - 0.3 * far,
      pan: 0.6 * Math.sin(s.yaw - a),
      lowpass: 3500 - 2300 * far,
      rate: rnd(0.85, 1.05),
      delay: 400 + s.distance * 25 + rnd(0, 500),
    });
  }

  // ---- critters ----

  private updateCritters(f: AmbientSoundFrame): void {
    if ((this.critterMs -= f.dt) > 0) return;
    this.critterMs = rnd(5000, 14000);
    const c = f.critterVoice();
    // Small things squeak higher
    if (c) this.audio.playAmbient(c.sound, { at: c, range: 12 * SQ, volume: 0.28, rate: rnd(1.15, 1.4) });
  }

  /** A pet's noise every minute or two, at the critters' quiet volume */
  private updatePets(f: AmbientSoundFrame): void {
    if ((this.petMs -= f.dt) > 0) return;
    this.petMs = rnd(60000, 120000);
    const p = f.petVoice();
    if (p) this.audio.playAmbient(p.sound, { at: p, range: 12 * SQ, volume: 0.28, rate: rnd(1.15, 1.4) });
  }

  // ---- puddles ----

  /** Splashing steps while we walk through a puddle */
  private updateSteps(f: AmbientSoundFrame): void {
    if (!f.wetUnderfoot || f.speed < 0.3) {
      this.stepMs = 0;
      return;
    }
    if ((this.stepMs -= f.dt) > 0) return;
    this.stepMs = f.speed > 1.4 ? 300 : 430;
    this.audio.playAmbient("weatstp1.ogg", { volume: 0.3, rate: rnd(0.9, 1.15) });
  }
}
