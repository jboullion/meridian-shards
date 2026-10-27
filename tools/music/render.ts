// Ours: renders MIDI to an OGG the client can loop, with a General MIDI sound bank, the way the
// game's own tracks are recordings of its XMI music. Used by tools/music/build.ts (our pieces)
// and the admin dashboard's Music & Sounds tab (tools/dev/audioApi.ts: the originals as written).
//
//   node tools/music/render.ts <in.mid|in.xmi> <out.ogg> [--bank gm|generaluser|<file.sf2|.dls>]
//                              [--no-loop] [--rate 48000] [--quality 4] [--loudness -15.5]
//
// Sound banks: "gm" (the default) is Windows' own gm.dls, the Roland GS set PCs played MIDI with
// in the 90s, closest to the game's sound (its licence for released music is still to be
// settled); "generaluser" is GeneralUser GS (free for released music: dist/soundfonts, from
// https://github.com/mrbumpy409/GeneralUser-GS).
//
// The client loops a track by restarting the buffer (audio.ts playMusic), so by default the
// reverb and release tail that rings past the end is folded back onto the start: the seam then
// sounds as the piece would played twice through.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer, type BasicSoundBank } from "spessasynth_core";
import { createOggEncoder } from "wasm-media-encoders";
import { xmiToMidi } from "../../packages/formats/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BANKS: Record<string, string> = {
  gm: "C:\\Windows\\System32\\drivers\\gm.dls",
  generaluser: join(ROOT, "dist", "soundfonts", "GeneralUser-GS.sf2"),
};
const BLOCK = 128;
const TAIL_SECONDS = 6;
const PEAK = 0.89; // -1 dBFS
const KNEE = 0.6;
/** RMS dBFS: the game's tracks run -13 to -20, castle.ogg -14.3, the median about -16 */
export const LOUDNESS = -15.5;

export interface RenderOptions {
  bank?: string;
  /** Fold the tail onto the start, for a seamless loop (default true) */
  loop?: boolean;
  rate?: number;
  loudness?: number;
  /** Vorbis quality, -1 to 10 (default 4: about the game's own tracks' 110 kbps) */
  quality?: number;
}

/** A file's own bytes (a small Buffer's .buffer is Node's shared pool, larger than the file) */
const arrayBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const banks = new Map<string, BasicSoundBank>();
function soundBank(name: string): BasicSoundBank {
  const file = BANKS[name] ?? name;
  let b = banks.get(file);
  if (!b) {
    b = SoundBankLoader.fromArrayBuffer(arrayBuffer(readFileSync(file)));
    banks.set(file, b);
  }
  return b;
}

/** MIDI bytes to stereo samples at the loudness asked for */
export async function render(midi: Uint8Array, o: RenderOptions = {}) {
  const rate = o.rate ?? 48000;
  const synth = new SpessaSynthProcessor(rate, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(soundBank(o.bank ?? "gm"), "main");
  await synth.processorInitialized;

  const seq = new SpessaSynthSequencer(synth);
  seq.skipToFirstNoteOn = false;
  seq.loopCount = 0;
  seq.loadNewSongList([BasicMIDI.fromArrayBuffer(arrayBuffer(midi))]);
  seq.play();

  const length = Math.round(seq.duration * rate);
  const total = length + TAIL_SECONDS * rate;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let i = 0; i < total; i += BLOCK) {
    if (i >= length) {
      if (!seq.isFinished) seq.pause();
      synth.stopAllChannels(false);
    } else seq.processTick();
    synth.process(left, right, i, Math.min(BLOCK, total - i));
  }

  let outL = left;
  let outR = right;
  if (o.loop ?? true) {
    outL = left.slice(0, length);
    outR = right.slice(0, length);
    for (let i = length; i < total; i++) {
      outL[i - length]! += left[i]!;
      outR[i - length]! += right[i]!;
    }
  }
  // Gain to the loudness asked for, then a soft knee keeps the peaks under -1 dBFS
  let sum = 0;
  for (let i = 0; i < outL.length; i++) sum += outL[i]! * outL[i]! + outR[i]! * outR[i]!;
  const rms = Math.sqrt(sum / (2 * outL.length));
  const gain = rms > 0 ? 10 ** ((o.loudness ?? LOUDNESS) / 20) / rms : 1;
  const soft = (x: number) => {
    const a = Math.abs(x);
    return a <= KNEE ? x : Math.sign(x) * (KNEE + (PEAK - KNEE) * Math.tanh((a - KNEE) / (PEAK - KNEE)));
  };
  for (let i = 0; i < outL.length; i++) {
    outL[i] = soft(outL[i]! * gain);
    outR[i] = soft(outR[i]! * gain);
  }
  return { left: outL, right: outR, rate, seconds: outL.length / rate, gain };
}

export async function encodeOgg(left: Float32Array, right: Float32Array, rate: number, quality = 4): Promise<Buffer> {
  const enc = await createOggEncoder();
  enc.configure({ channels: 2, sampleRate: rate, vbrQuality: quality });
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += rate) {
    chunks.push(enc.encode([left.subarray(i, i + rate), right.subarray(i, i + rate)]).slice());
  }
  chunks.push(enc.finalize().slice());
  return Buffer.concat(chunks);
}

/** MIDI (or XMI) bytes to an OGG file's bytes */
export async function renderOgg(data: Uint8Array, o: RenderOptions = {}) {
  const isXmi = data[0] === 0x46 && data[1] === 0x4f && data[2] === 0x52 && data[3] === 0x4d; // "FORM"
  const r = await render(isXmi ? xmiToMidi(data).midi : data, o);
  return { ogg: await encodeOgg(r.left, r.right, r.rate, o.quality), seconds: r.seconds, gain: r.gain };
}

if (process.argv[1]?.endsWith("render.ts")) {
  const valued = new Set(["--bank", "--rate", "--quality", "--loudness"]);
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const num = (name: string) => (arg(name) === undefined ? undefined : Number(arg(name)));
  const [src, out] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !valued.has(all[i - 1]!));
  if (!src || !out) {
    console.error("usage: node tools/music/render.ts <in.mid|in.xmi> <out.ogg> [--bank gm|generaluser|file] [--no-loop] [--rate 48000] [--quality 4] [--loudness -15.5]");
    process.exit(1);
  }
  const t0 = Date.now();
  const bank = arg("bank") ?? "gm";
  const r = await renderOgg(new Uint8Array(readFileSync(src)), { bank, loop: !process.argv.includes("--no-loop"), rate: num("rate"), quality: num("quality"), loudness: num("loudness") });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, r.ogg);
  console.log(`${out}: ${r.seconds.toFixed(1)}s, ${(r.ogg.length / 1024).toFixed(0)} KB, bank ${bank}, gain ${r.gain.toFixed(2)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
