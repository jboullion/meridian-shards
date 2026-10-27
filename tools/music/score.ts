// Ours: a small kit for writing new music in the manner of the game's General MIDI tracks
// (castle.xmi and the rest, resource/audio/xmi in shards-server). A piece (tools/music/pieces)
// builds a Score from parts and lines; tools/music/build.ts writes it out as MIDI and renders it.
//
//   const s = new Score({ bpm: 88, beatsPerBar: 3 });
//   const flute = s.part("flute", GM.flute);
//   flute.line(0, "G#5:1.5 F#5:.5 E5:1");
//   s.bars = 8;
//   s.toMidi();
//
// Times are bars and beats from a bar's start; a line is "pitch:beats" tokens, "r" a rest, a
// trailing "!" an accent. Notes get a little human unsteadiness, seeded by the part's name, so a
// rebuild is identical.

import { writeVlq } from "../../packages/formats/src/index.ts";

export const PPQ = 480;

/** General MIDI programs the game's tracks use, and a few more */
export const GM = {
  piano: 0, harpsichord: 6, celesta: 8, glockenspiel: 9, musicBox: 10, vibraphone: 11, marimba: 12, tubularBells: 14, dulcimer: 15,
  churchOrgan: 19, accordion: 21, nylonGuitar: 24, acousticBass: 32,
  violin: 40, viola: 41, cello: 42, contrabass: 43, tremoloStrings: 44, pizzicato: 45, harp: 46, timpani: 47,
  strings: 48, strings2: 49, synthStrings: 50, choir: 52, voiceOohs: 53, synthVoice: 54,
  trumpet: 56, trombone: 57, tuba: 58, frenchHorn: 60, brass: 61,
  oboe: 68, englishHorn: 69, bassoon: 70, clarinet: 71, piccolo: 72, flute: 73, recorder: 74, panFlute: 75, ocarina: 79,
  lute: 24, bagpipe: 109, fiddle: 110, shanai: 111,
} as const;

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" = 60; sharps "#", flats "b" */
export function pitch(name: string): number {
  let n = LETTERS[name[0]!.toUpperCase()];
  if (n === undefined) throw new Error(`not a pitch: ${name}`);
  let i = 1;
  for (; name[i] === "#" || name[i] === "b"; i++) n += name[i] === "#" ? 1 : -1;
  return n + 12 * (Number(name.slice(i)) + 1);
}

/** A small seeded random (mulberry32) */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ev = { tick: number; order: number; raw: number[] };

export interface PartOptions {
  volume?: number;
  pan?: number;
  reverb?: number;
  chorus?: number;
}

export class Part {
  readonly events: Ev[] = [];
  readonly name: string;
  readonly channel: number;
  private readonly score: Score;
  private readonly random: () => number;

  constructor(score: Score, name: string, channel: number, program: number, o: PartOptions) {
    this.score = score;
    this.name = name;
    this.channel = channel;
    this.random = rng(name);
    this.cc(0, 0, 7, o.volume ?? 100);
    this.cc(0, 0, 10, o.pan ?? 64);
    this.cc(0, 0, 91, o.reverb ?? 40);
    this.cc(0, 0, 93, o.chorus ?? 0);
    if (channel !== 9) this.events.push({ tick: 0, order: 1, raw: [0xc0 | channel, program] });
  }

  private tick(bar: number, beat: number): number {
    return Math.round((bar * this.score.beatsPerBar + beat) * PPQ);
  }

  private jitter(span: number): number {
    return Math.round((this.random() * 2 - 1) * span);
  }

  cc(bar: number, beat: number, controller: number, value: number): void {
    this.events.push({ tick: this.tick(bar, beat), order: 0, raw: [0xb0 | this.channel, controller, value] });
  }

  note(bar: number, beat: number, p: string | number, beats: number, velocity = 90, o: { legato?: number; steady?: boolean } = {}): void {
    const n = typeof p === "string" ? pitch(p) : p;
    let t0 = this.tick(bar, beat);
    let v = velocity;
    if (!o.steady && t0 > 0) {
      t0 += this.jitter(8);
      v += this.jitter(6);
    }
    const t1 = Math.max(t0 + 1, this.tick(bar, beat + beats * (o.legato ?? 0.95)));
    v = Math.max(1, Math.min(127, v));
    this.events.push({ tick: t0, order: 2, raw: [0x90 | this.channel, n, v] });
    this.events.push({ tick: t1, order: -1, raw: [0x80 | this.channel, n, 0] });
  }

  chord(bar: number, beat: number, pitches: (string | number)[], beats: number, velocity = 70, legato = 1): void {
    for (const p of pitches) this.note(bar, beat, p, beats, velocity, { legato });
  }

  /** Lays a "pitch:beats ..." line from `bar`; returns the beat where it ended */
  line(bar: number, line: string, velocity = 90, o: { beat?: number; legato?: number; transpose?: number } = {}): number {
    let beat = o.beat ?? 0;
    for (const tok of line.trim().split(/\s+/)) {
      const [name, dur] = tok.replace("!", "").split(":");
      const d = Number(dur ?? 1);
      if (name !== "r") this.note(bar, beat, pitch(name!) + (o.transpose ?? 0), d, velocity + (tok.includes("!") ? 12 : 0), { legato: o.legato });
      beat += d;
    }
    return beat;
  }
}

export class Score {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly parts: Part[] = [];
  /** How long the piece runs: the file ends exactly here, which is where it loops */
  bars = 0;

  constructor(o: { bpm: number; beatsPerBar?: number }) {
    this.bpm = o.bpm;
    this.beatsPerBar = o.beatsPerBar ?? 4;
  }

  part(name: string, program: number, o: PartOptions & { drums?: boolean } = {}): Part {
    const used = new Set(this.parts.map((p) => p.channel));
    const ch = o.drums ? 9 : [...Array(16).keys()].find((c) => c !== 9 && !used.has(c));
    if (ch === undefined) throw new Error("no MIDI channels left (15 parts at most)");
    const p = new Part(this, name, ch, program, o);
    this.parts.push(p);
    return p;
  }

  get seconds(): number {
    return (this.bars * this.beatsPerBar * 60) / this.bpm;
  }

  /** Format 1: a tempo track, then one a part */
  toMidi(): Uint8Array {
    const end = this.bars * this.beatsPerBar * PPQ;
    const tempo = Math.round(60_000_000 / this.bpm);
    const tracks: number[][] = [
      [0, 0xff, 0x51, 3, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff, 0, 0xff, 0x58, 4, this.beatsPerBar, 2, 24, 8, ...writeVlq(end), 0xff, 0x2f, 0],
    ];
    for (const p of this.parts) {
      const name = [...new TextEncoder().encode(p.name)];
      const t: number[] = [0, 0xff, 0x03, ...writeVlq(name.length), ...name];
      let last = 0;
      const evs = p.events.map((e) => ({ ...e, tick: Math.max(0, Math.min(e.tick, end)) })).sort((a, b) => a.tick - b.tick || a.order - b.order);
      for (const e of evs) {
        t.push(...writeVlq(e.tick - last), ...e.raw);
        last = e.tick;
      }
      t.push(...writeVlq(end - last), 0xff, 0x2f, 0);
      tracks.push(t);
    }
    const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, PPQ >> 8, PPQ & 0xff];
    for (const t of tracks) out.push(0x4d, 0x54, 0x72, 0x6b, (t.length >>> 24) & 0xff, (t.length >> 16) & 0xff, (t.length >> 8) & 0xff, t.length & 0xff, ...t);
    return new Uint8Array(out);
  }
}

/** A piece of ours: tools/music/pieces/<file>.ts exports one as `piece` */
export interface Piece {
  /** The OGG it becomes, which rooms name in their Kod (`castle2a_music = princess.ogg`) */
  file: string;
  title: string;
  /** What it's for and what it's after, for the dashboard */
  about: string;
  build(): Score;
}
