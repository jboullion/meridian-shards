// The Bourgeois Castle: the Princess's court (castle2a-castle2d in shards-server: the banquet
// hall, the castle's hall, her Assembly Chamber, the library). A minuet in E major after
// castle.xmi: its palette (strings, oboe, bassoon, glockenspiel, timpani, tubular bells) and its
// key, leaning to C# minor, made lighter for the Princess with 3/4, harp and celesta, and a flute
// tune. 48 bars that end on B7 and loop back to the opening E.

import { GM, pitch, Score, type Piece } from "../score.ts";

/** name: bass, pad, harp arpeggio in six eighths */
const CHORDS: Record<string, [string, string, string]> = {
  E: ["E2", "G#3 B3 E4", "E3 B3 E4 G#4 B4 G#4"],
  "C#m": ["C#3", "G#3 C#4 E4", "C#3 G#3 C#4 E4 G#4 E4"],
  Amaj7: ["A2", "G#3 C#4 E4", "A2 E3 G#3 C#4 E4 C#4"],
  A: ["A2", "A3 C#4 E4", "A2 E3 A3 C#4 E4 C#4"],
  B: ["B2", "F#3 B3 D#4", "B2 F#3 B3 D#4 F#4 D#4"],
  B7: ["B2", "A3 B3 D#4 F#4", "B2 F#3 A3 D#4 F#4 A4"],
  "G#m": ["G#2", "G#3 B3 D#4", "G#2 D#3 G#3 B3 D#4 B3"],
  "G#7": ["G#2", "G#3 C4 D#4 F#4", "G#2 D#3 F#3 C4 D#4 C4"],
  "F#m": ["F#2", "F#3 A3 C#4", "F#2 C#3 F#3 A3 C#4 A3"],
};

const INTRO = ["E", "C#m", "Amaj7", "B"];
const A1 = ["E", "C#m", "Amaj7", "B", "E", "G#m", "B7", "E"];
const A2 = ["E", "C#m", "Amaj7", "B", "E", "G#m", "B7", "G#7"];
const B1 = ["C#m", "G#m", "A", "G#7", "C#m", "F#m", "B", "B7"];
const CODA = ["E", "C#m", "A", "B7"];

const TUNE_A = ["G#5:1.5 F#5:.5 E5:1", "C#5:2 E5:1", "A5:1.5 G#5:.5 E5:1", "F#5:2 D#5:1",
  "G#5:1 B5:1 A5:.5 G#5:.5", "G#5:1.5 F#5:.5 D#5:1", "C#5:1 E5:1 D#5:1", "E5:3"];
/** A2's last two bars, into the minor */
const TUNE_A_TURN = ["C#5:1 E5:1 F#5:1", "G#5:3"];
const TUNE_B = ["E5:1 D#5:.5 C#5:.5 G#4:1", "B4:2 G#4:1", "A4:1 C#5:1 E5:1", "D#5:2 C5:1",
  "C#5:1 E5:1 G#5:1", "A5:1.5 G#5:.5 F#5:1", "F#5:1 D#5:1 B4:1", "F#5:2 D#5:1"];
const BASSOON_B = "C#4:3 B3:3 A3:3 G#3:3 E4:3 C#4:3 B3:3 A3:3";

const SCALE = "E4 F#4 G#4 A4 B4 C#5 D#5".split(" ").map((n) => pitch(n) % 12);

/** The line a diatonic third lower in E major, as (pitch, beats): the oboe under the flute in A'' */
function thirdBelow(line: string): [number, number][] {
  return line.split(" ").map((tok) => {
    const [name, d] = tok.split(":");
    const p = pitch(name!);
    const i = SCALE.indexOf(p % 12);
    return [p - ((SCALE[i]! - SCALE[(i + 5) % 7]! + 12) % 12), Number(d)];
  });
}

function build(): Score {
  const s = new Score({ bpm: 84, beatsPerBar: 3 });
  const harp = s.part("harp", GM.harp, { volume: 96, pan: 44, reverb: 60 });
  const pad = s.part("strings", GM.strings, { volume: 84, pan: 72, reverb: 70 });
  const low = s.part("low strings", GM.strings2, { volume: 90, pan: 60, reverb: 70 });
  const pizz = s.part("pizzicato", GM.pizzicato, { volume: 92, pan: 80, reverb: 50 });
  const flute = s.part("flute", GM.flute, { volume: 100, pan: 56, reverb: 60 });
  const oboe = s.part("oboe", GM.oboe, { volume: 96, pan: 76, reverb: 60 });
  const bassoon = s.part("bassoon", GM.bassoon, { volume: 90, pan: 50, reverb: 55 });
  const celesta = s.part("celesta", GM.celesta, { volume: 100, pan: 64, reverb: 70 });
  const glock = s.part("glockenspiel", GM.glockenspiel, { volume: 78, pan: 90, reverb: 70 });
  const bells = s.part("bells", GM.tubularBells, { volume: 70, pan: 40, reverb: 80 });
  const timp = s.part("timpani", GM.timpani, { volume: 86, pan: 64, reverb: 60 });
  const choir = s.part("choir", GM.choir, { volume: 72, pan: 64, reverb: 80 });

  const accompany = (chords: string[], start: number, o: { harp?: number; pad?: number; pizz?: number; lows?: boolean } = {}) => {
    chords.forEach((name, i) => {
      const [bass, voicing, arp] = CHORDS[name]!;
      arp.split(" ").forEach((p, k) => harp.note(start + i, k * 0.5, p, 1.5, (o.harp ?? 62) + (k === 0 ? 6 : 0), { legato: 1 }));
      pad.chord(start + i, 0, voicing.split(" "), 3, o.pad ?? 50);
      pizz.note(start + i, 0, bass, 1, o.pizz ?? 70);
      if (o.lows) low.note(start + i, 0, bass, 3, 80, { legato: 1 });
    });
  };
  const sparkle = (bar: number, vel = 70) => "E6 G#6 B6 E7".split(" ").forEach((p, k) => glock.note(bar, 1 + k * 0.5, p, 1, vel - k * 6));
  const tune = (part: typeof flute, lines: string[], start: number, vel: number, transpose = 0) =>
    lines.forEach((l, i) => part.line(start + i, l, vel, { transpose }));

  let bar = 0;
  // Intro: harp and strings, a bell
  accompany(INTRO, bar, { harp: 58, pad: 44 });
  bells.note(bar, 0, "E4", 3, 70);
  bar += 4;

  // A: the flute's tune
  accompany(A1, bar);
  tune(flute, TUNE_A, bar, 84);
  sparkle(bar + 7);
  bar += 8;

  // A': the oboe takes it, and turns toward C# minor
  accompany(A2, bar, { pad: 54 });
  tune(oboe, [...TUNE_A.slice(0, 6), ...TUNE_A_TURN], bar, 86);
  bar += 8;

  // B: the court in C# minor: strings sing, bassoon below, choir, timpani at the dominants
  accompany(B1, bar, { harp: 52, pad: 40, pizz: 76, lows: true });
  tune(pad, TUNE_B, bar, 82);
  bassoon.line(bar, BASSOON_B, 76);
  B1.forEach((name, i) => choir.chord(bar + i, 0, CHORDS[name]![1].split(" "), 3, 40));
  for (const [b, p] of [[bar + 3, "G#2"], [bar + 7, "B2"]] as const) {
    // a roll, swelling over the bar's last beat and a half
    for (let k = 0; k < 12; k++) timp.note(b, 1.5 + k * 0.125, p, 0.125, 50 + k * 5, { legato: 1, steady: true });
  }
  bells.note(bar, 0, "C#4", 3, 60);
  bar += 8;

  // A'': flute and oboe together, in thirds
  accompany(A1, bar, { harp: 66, pad: 56 });
  tune(flute, TUNE_A, bar, 90);
  TUNE_A.forEach((l, i) => {
    let beat = 0;
    for (const [p, d] of thirdBelow(l)) {
      oboe.note(bar + i, beat, p, d, 72);
      beat += d;
    }
  });
  bells.note(bar, 0, "E4", 3, 74);
  sparkle(bar + 7, 76);
  bar += 8;

  // A''': quiet, the celesta an octave up, the harp alone beneath
  A1.forEach((name, i) => {
    const [, voicing, arp] = CHORDS[name]!;
    arp.split(" ").forEach((p, k) => harp.note(bar + i, k * 0.5, p, 1.5, 50, { legato: 1 }));
    pad.chord(bar + i, 0, voicing.split(" "), 3, 34);
  });
  tune(celesta, TUNE_A, bar, 80, 12);
  bar += 8;

  // Coda, ending on B7 to lead back to the opening E
  accompany(CODA, bar, { harp: 54, pad: 42 });
  flute.line(bar + 2, "E5:1.5 C#5:.5 A4:1", 66);
  flute.line(bar + 3, "B4:2 D#5:1", 60);
  bar += 4;

  s.bars = bar;
  return s;
}

export const piece: Piece = {
  file: "princess.ogg",
  title: "The Bourgeois Castle",
  about: "The Princess's court: a minuet in E major after castle.xmi, with harp, flute and celesta.",
  build,
};
