// Ours: the sounds of ambient life and the weather (the Ambient Sounds option), none of them the
// server's. Each frame the scene says what's about (how many townsfolk, the room's kind, the
// rain) and what happened (a swing, a cheer, a strike), and this plays it:
//   - a bed of chatter under the townsfolk, inn patrons, courtiers and the arena's crowd, as loud
//     as how many are about, muffled in the rain;
//   - the arena: weapons swinging and striking armour, spells cast and landing, cheers and
//     applause from the stands;
//   - inns: dice and drinks now and then;
//   - thunder after each lightning strike, later and duller the further off;
//   - critters squeaking now and then, fish splashing;
//   - splashing steps through puddles.
// Birds, bats, butterflies, fireflies and leaves are silent.
// Only where people live (towns, inns, castles, the arena): the wilds keep the original's sounds
// alone, but for thunder with the lightning.
// The game's own sounds where they fit; the chatter, crowd and thunder recordings are CC0
// (tools/assets/fetch-sounds.ts). docs/ambient-sounds.md lists every cue.

import { FINENESS } from "@shards/formats";
import type { AmbientEvent, AmbientKind, ArenaSpell } from "@shards/world";
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
  raining: boolean;
  events: AmbientEvent[];
  /** A lightning strike just now (which way from the eye, radians from east toward south, and how far, squares) */
  strike: { yaw: number; distance: number } | null;
  /** A fish leaping (small) or landing (big) */
  splashes: { x: number; y: number; big: boolean }[];
  /** A critter about us to make a noise, asked now and then */
  critterVoice: () => { x: number; y: number; sound: string } | null;
  /** Standing in a puddle, and how fast we move (fine units a ms) */
  wetUnderfoot: boolean;
  speed: number;
}

/** The chatter under each kind of crowd: the file, how loud, and how many people make it full */
const BEDS: Record<AmbientKind, { file: string; indoorFile?: string; volume: number; full: number }> = {
  town: { file: "amb_town_talk.ogg", volume: 0.18, full: 7 },
  inn: { file: "amb_inn_talk.ogg", volume: 0.28, full: 4 },
  castle: { file: "amb_town_talk.ogg", indoorFile: "amb_hall_talk.ogg", volume: 0.15, full: 5 },
  arena: { file: "amb_hall_talk.ogg", volume: 0.29, full: 10 },
};

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length) % list.length];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const SWISH = ["swswish1.ogg", "swswish2.ogg", "swswish3.ogg", "swswish4.ogg", "swswish5.ogg"];
const HITS = {
  metal: ["mhit1b.ogg", "mhit2b.ogg", "mhit3b.ogg", "swrdmtl1.ogg", "swrdmtl2.ogg", "swrdmtl3.ogg"],
  leather: ["lhit1b.ogg", "lhit2b.ogg", "lhit3b.ogg"],
  flesh: ["fhit1b.ogg", "fhit2b.ogg", "fhit3b.ogg"],
} as const;
const OUCH = { male: ["ouchm1.ogg", "ouchm2.ogg", "ouchm3.ogg", "ouchm4.ogg"], female: ["ouchf1.ogg", "ouchf2.ogg", "ouchf3.ogg", "ouchf4.ogg"] };
const CHEERS: [string, number][] = [["huzzah.ogg", 0.5], ["arena.ogg", 0.45], ["amb_cheer1.ogg", 0.32], ["amb_cheer2.ogg", 0.32]];
/** Each spell's own sound (its vrSucceed_wav: boltspel/*.kod, walspell/*.kod) */
const SPELL_SOUNDS: Record<ArenaSpell, string> = {
  fireball: "ffirebal.ogg",
  lightning: "fbolt.ogg",
  firewall: "farenwala822m.ogg",
  bramble: "faren.ogg",
  poisonfog: "qor.ogg",
  ring: "frngfir.ogg",
  web: "farenwala822m.ogg",
};
const THUNDER = ["thunderclap.ogg", "amb_thunder1.ogg", "amb_thunder2.ogg", "amb_thunder3.ogg", "amb_thunder4.ogg"];

export class AmbientSounds {
  private readonly audio: GameAudio;
  private bed: { file: string; sound: AmbientSound; volume: number } | null = null;
  private critterMs = 4000;
  private cheerMs = 0;
  private stepMs = 0;

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
    for (const s of f.splashes) this.audio.playAmbient("splash.ogg", { at: s, range: 22 * SQ, volume: s.big ? 0.45 : 0.25, rate: s.big ? 1 : 1.3 });
    this.updateCritters(f);
    this.updateSteps(f);
  }

  /**
   * Dev tools: hear one cue by itself, about us (window.shards.gameScene.ambientSoundBoard.audition("thunder")).
   * Cues: town, inn, hall (5 s of each chatter), swing, hit, cast-fire, cast-lightning, zap, cheer,
   * applause, thunder, critter, splash, step, dice, drink, ouch, death
   */
  audition(cue: string): string[] {
    const a = this.audio;
    const once = (file: string, volume = 0.6, o = {}) => a.playAmbient(file, { volume, ...o });
    const taste = (file: string, volume: number) => {
      const s = a.playAmbient(file, { volume, offset: "random", fadeIn: 500 });
      setTimeout(() => s.stop(800), 5000);
    };
    switch (cue) {
      case "town": taste(BEDS.town.file, BEDS.town.volume); break;
      case "inn": taste(BEDS.inn.file, BEDS.inn.volume); break;
      case "hall": taste(BEDS.arena.file, BEDS.arena.volume); break;
      case "swing": once(pick(SWISH), 0.45); break;
      case "hit": once(pick(HITS.metal), 0.55); break;
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
      case "drink": once("drink.ogg", 0.35); break;
      case "ouch": once(pick(OUCH.male), 0.35); break;
      case "death": once("pdeath.ogg", 0.5); break;
    }
    return ["town", "inn", "hall", "swing", "hit", "cast-fire", "cast-lightning", "zap", "cheer", "applause", "thunder", "critter", "splash", "step", "dice", "drink", "ouch", "death"];
  }

  /** Everything stops: another room's sounds start from nothing */
  stop(fadeMs = 800): void {
    this.bed?.sound.stop(fadeMs);
    this.bed = null;
  }

  // ---- chatter ----

  private updateBed(f: AmbientSoundFrame): void {
    const spec = f.kind ? BEDS[f.kind] : null;
    const file = spec ? (f.indoors && spec.indoorFile) || spec.file : null;
    let volume = spec && f.people > 0 ? spec.volume * Math.min(1, 0.25 + (0.75 * f.people) / spec.full) : 0;
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

  // ---- what the crowd did ----

  private event(e: AmbientEvent): void {
    const at = { x: e.x, y: e.y };
    const a = this.audio;
    switch (e.type) {
      case "swing":
        a.playAmbient(pick(SWISH), { at, range: 16 * SQ, volume: 0.45, rate: rnd(0.95, 1.1) });
        if (e.hit) {
          a.playAmbient(pick(HITS[e.hit]), { at, range: 16 * SQ, volume: 0.55, delay: 180, rate: rnd(0.95, 1.05) });
          if (Math.random() < 0.2) a.playAmbient(pick(e.female ? OUCH.female : OUCH.male), { at, range: 16 * SQ, volume: 0.35, delay: 260 });
        }
        break;
      case "cast":
        a.playAmbient(SPELL_SOUNDS[e.spell ?? "fireball"], { at, range: 22 * SQ, volume: 0.5 });
        break;
      case "impact":
        if (e.bolt === "lightning") a.playAmbient(pick(["zaphit1.ogg", "zaphit2.ogg", "zaphit3.ogg"]), { at, range: 18 * SQ, volume: 0.35 });
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
      case "flee":
        a.playAmbient(pick(e.female ? OUCH.female : OUCH.male), { at, range: 18 * SQ, volume: 0.35, rate: rnd(1.05, 1.2) });
        break;
      case "dice":
        a.playAmbient("dice.ogg", { at, range: 12 * SQ, volume: 0.45 });
        break;
      case "drink":
        a.playAmbient("drink.ogg", { at, range: 10 * SQ, volume: 0.35 });
        break;
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
