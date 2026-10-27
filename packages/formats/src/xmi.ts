// Ours: the game's music is XMI (Miles AIL extended MIDI, resource/audio/xmi in shards-server),
// which the original client played through the sound card. This converts it to a standard MIDI
// file, for the admin dashboard's Music & Sounds tab to render it as it was written
// (tools/music/render.ts), next to the OGG recordings the client plays.
//
// XMI differs from MIDI in three ways that matter here:
//   - a delta time is a run of bytes below 0x80 that add up, not a variable-length quantity;
//   - a note-on carries its own duration (a VLQ), and there are no note-offs;
//   - time runs at a fixed 120 ticks a second (AIL ignores the file's tempo events).
// The result is format 0 at 60 ticks a quarter and 120 bpm, so a tick stays 1/120 s.

const PPQN = 60;
const TEMPO = 500_000; // microseconds a quarter: 120 bpm
/** XMI ticks a second */
export const XMI_TICK_RATE = 120;

function readVlq(d: Uint8Array, i: number): [number, number] {
  let v = 0;
  for (;;) {
    const b = d[i++]!;
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [v, i];
  }
}

export function writeVlq(v: number): number[] {
  const out = [v & 0x7f];
  for (v >>>= 7; v; v >>>= 7) out.push(0x80 | (v & 0x7f));
  return out.reverse();
}

/** The first EVNT chunk (the nesting is FORM XDIR, CAT XMID, FORM XMID: only the first song matters) */
function findEvnt(d: Uint8Array): Uint8Array {
  for (let i = 0; i + 8 <= d.length; i++) {
    if (d[i] === 0x45 && d[i + 1] === 0x56 && d[i + 2] === 0x4e && d[i + 3] === 0x54) {
      const size = ((d[i + 4]! << 24) | (d[i + 5]! << 16) | (d[i + 6]! << 8) | d[i + 7]!) >>> 0;
      return d.subarray(i + 8, i + 8 + size);
    }
  }
  throw new Error("not an XMI file: no EVNT chunk");
}

type Ev = { t: number; order: number; raw: number[] };

/** The XMI's events, at absolute ticks, with note-offs made from the durations; and where it ends */
function parseEvents(evnt: Uint8Array): { events: Ev[]; end: number } {
  const events: Ev[] = [];
  let t = 0;
  let order = 0;
  let i = 0;
  while (i < evnt.length) {
    const status = evnt[i]!;
    if (status < 0x80) {
      while (i < evnt.length && evnt[i]! < 0x80) t += evnt[i++]!;
      continue;
    }
    const kind = status & 0xf0;
    if (status === 0xff) {
      const type = evnt[i + 1]!;
      const [len, j] = readVlq(evnt, i + 2);
      i = j + len;
      if (type === 0x2f) break;
      if (type === 0x51) continue; // tempo: AIL plays at a fixed rate
      events.push({ t, order, raw: [0xff, type, ...writeVlq(len), ...evnt.subarray(j, j + len)] });
    } else if (status === 0xf0 || status === 0xf7) {
      const [len, j] = readVlq(evnt, i + 1);
      events.push({ t, order, raw: [status, ...writeVlq(len), ...evnt.subarray(j, j + len)] });
      i = j + len;
    } else if (kind === 0x90) {
      const note = evnt[i + 1]!;
      const [dur, j] = readVlq(evnt, i + 3);
      events.push({ t, order, raw: [status, note, evnt[i + 2]!] });
      // Note-offs go before the note-ons at the same tick
      events.push({ t: t + dur, order: -1, raw: [0x80 | (status & 0x0f), note, 0] });
      i = j;
    } else if (kind === 0xc0 || kind === 0xd0) {
      events.push({ t, order, raw: [status, evnt[i + 1]!] });
      i += 2;
    } else {
      events.push({ t, order, raw: [status, evnt[i + 1]!, evnt[i + 2]!] });
      i += 3;
    }
    order++;
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  return { events, end: t };
}

/** A standard MIDI file of the XMI's first song; `seconds` is how long it runs */
export function xmiToMidi(xmi: Uint8Array): { midi: Uint8Array; seconds: number } {
  const { events, end } = parseEvents(findEvnt(xmi));
  const track: number[] = [0x00, 0xff, 0x51, 0x03, (TEMPO >> 16) & 0xff, (TEMPO >> 8) & 0xff, TEMPO & 0xff];
  let last = 0;
  for (const e of events) {
    track.push(...writeVlq(e.t - last), ...e.raw);
    last = e.t;
  }
  const stop = Math.max(end, last);
  track.push(...writeVlq(stop - last), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQN >> 8, PPQN & 0xff];
  const n = track.length;
  const midi = new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...track]);
  return { midi, seconds: stop / XMI_TICK_RATE };
}
