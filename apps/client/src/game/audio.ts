// Sound and music, after clientd3d/audio.c (irrKlang) and game.c GamePlaySound:
//   - music: one looping track; asking for the playing track again does nothing, a new
//     one replaces it at once (MusicPlayFile).
//   - sounds: at most 24 at once (MAXSOUNDS); 2D at the player, or 3D at a point with
//     the listener at the player facing their way; volume rolls off as
//     1 / (1 + 0.00016 * distance) in fine units. audio.c sets irrKlang's max distance
//     to 32 squares; in irrKlang that's where a sound stops getting quieter (its docs:
//     "the sound stops attenuating after it reaches the max distance"), so far sounds such
//     as the terrain ambience at square (1, 1) stay audible at about 16%.
//   - SF_LOOP sounds loop until the player leaves the room; the loop and random-place
//     sounds can be switched off (config.play_loop_sounds / play_random_sounds).
// Files come from dist/assets by the name the resource string gives (e.g. login.ogg).

import { FINENESS } from "@shards/formats";
import { SF } from "@shards/protocol";
import type { SoundEvent } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { getSettings, onSettings, type Settings } from "./settings.ts";

const MAX_SOUNDS = 24;
const ROLLOFF = 0.00016;
const MAX_DIST = FINENESS * 32;

interface Voice {
  file: string;
  flags: number;
  /** Fine coordinates, or null for a 2D sound */
  pos: { x: number; y: number } | null;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  private music: { file: string; source: AudioBufferSourceNode | null; gain: GainNode } | null = null;
  /** The room's track, kept while music is off so switching it on restarts it (MusicRestart). */
  private wantedMusic: string | null = null;
  private listener = { x: 0, y: 0, angle: 0 };
  private settings: Settings;
  private readonly assets: AssetStore;
  /** Where an object is, for sounds that come from one (GamePlaySound: obj->motion.x/y) */
  objectPosition: (id: number) => { x: number; y: number } | undefined = () => undefined;
  /** Log of what plays, for the dev console (window.shards.audio.log) */
  readonly log: string[] = [];

  private readonly offSettings: () => void;

  constructor(assets: AssetStore) {
    this.assets = assets;
    this.settings = getSettings();
    this.offSettings = onSettings((s) => this.setSettings(s));
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  /** Browsers start audio suspended until the page gets a click or key press. */
  private readonly unlock = () => {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  };

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    const key = file.toLowerCase();
    let p = this.buffers.get(key);
    if (!p) {
      p = this.assets.has(key)
        ? this.assets
            .fetchBytes(key)
            .then((b) => this.context().decodeAudioData(b.slice().buffer))
            .catch(() => null)
        : Promise.resolve(null);
      this.buffers.set(key, p);
    }
    return p;
  }

  handle(e: SoundEvent): void {
    switch (e.type) {
      case "music":
        void this.playMusic(e.file);
        break;
      case "stopLoops":
        this.stopWhere((v) => (v.flags & SF.LOOP) !== 0);
        break;
      case "stop":
        // audio.c SoundStopFile stops every voice playing that file
        this.stopWhere((v) => v.file === e.file.toLowerCase());
        break;
      case "play": {
        const w = e.wave;
        let pos: Voice["pos"] = null;
        if (w.object) pos = this.objectPosition(w.object) ?? null;
        else if (w.row > 0 || w.col > 0) {
          // big row/col (1-based) to the middle of that square
          pos = { x: (w.col - 1) * FINENESS + FINENESS / 2, y: (w.row - 1) * FINENESS + FINENESS / 2 };
        }
        void this.playSound(e.file, w.flags, pos);
        break;
      }
    }
  }

  /** A sound the client plays itself (wading), at the player. */
  playLocal(file: string): void {
    void this.playSound(file, 0, null);
  }

  private async playMusic(file: string): Promise<void> {
    const name = file.toLowerCase();
    this.wantedMusic = name;
    if (!this.settings.music || this.music?.file === name) return;
    this.stopMusic();
    const ctx = this.context();
    const gain = ctx.createGain();
    gain.gain.value = this.settings.musicVolume / 100;
    gain.connect(this.master!);
    const entry: NonNullable<GameAudio["music"]> = { file: name, source: null, gain };
    this.music = entry;
    const buf = await this.buffer(name);
    if (!buf || this.music !== entry) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    entry.source = src;
    this.note(`music ${name}`);
  }

  private stopMusic(): void {
    if (!this.music) return;
    this.music.source?.stop();
    this.music.gain.disconnect();
    this.music = null;
  }

  private async playSound(file: string, flags: number, pos: Voice["pos"]): Promise<void> {
    const s = this.settings;
    const loop = (flags & SF.LOOP) !== 0;
    if (!s.sound || (loop && !s.loopSounds) || (flags & SF.RANDOM_PLACE && !s.randomSounds)) return;
    if (this.voices.length >= MAX_SOUNDS) return this.note(`skip ${file} (max reached)`);
    const name = file.toLowerCase();
    const buf = await this.buffer(name);
    if (!buf || this.voices.length >= MAX_SOUNDS) return;
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = loop;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    source.connect(gain).connect(pan).connect(this.master!);
    const v: Voice = { file: name, flags, pos, source, gain, pan };
    this.voices.push(v);
    this.place(v);
    source.onended = () => this.remove(v);
    source.start();
    this.note(`play ${name}${loop ? " loop" : ""}${pos ? ` at ${(pos.x / FINENESS).toFixed(1)},${(pos.y / FINENESS).toFixed(1)}` : ""}`);
  }

  private remove(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    v.pan.disconnect();
  }

  private stopWhere(pred: (v: Voice) => boolean): void {
    for (const v of [...this.voices]) {
      if (!pred(v)) continue;
      v.source.onended = null;
      v.source.stop();
      this.remove(v);
    }
  }

  /** Volume and pan of a voice from the listener (irrKlang 3D with audio.c's rolloff). */
  private place(v: Voice): void {
    const vol = this.settings.soundVolume / 100;
    if (!v.pos) {
      v.gain.gain.value = vol;
      v.pan.pan.value = 0;
      return;
    }
    const dx = v.pos.x - this.listener.x,
      dy = v.pos.y - this.listener.y;
    const d = Math.hypot(dx, dy);
    v.gain.gain.value = vol / (1 + ROLLOFF * Math.min(d, MAX_DIST));
    if (d < 1) {
      v.pan.pan.value = 0;
      return;
    }
    // listener faces (cos a, sin a) with y south; its right hand is (-sin a, cos a)
    const a = (this.listener.angle * 2 * Math.PI) / 4096;
    v.pan.pan.value = Math.max(-1, Math.min(1, (dx * -Math.sin(a) + dy * Math.cos(a)) / d));
  }

  /** The player moved or turned (move.c SoundSetListenerPosition). */
  setListener(x: number, y: number, angle: number): void {
    const l = this.listener;
    if (l.x === x && l.y === y && l.angle === angle) return;
    this.listener = { x, y, angle };
    for (const v of this.voices) if (v.pos) this.place(v);
  }

  setSettings(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (this.music) this.music.gain.gain.value = s.musicVolume / 100;
    if (!s.music) this.stopMusic();
    else if (!prev.music && this.wantedMusic) void this.playMusic(this.wantedMusic);
    if (!s.sound) this.stopWhere(() => true);
    if (!s.loopSounds) this.stopWhere((v) => (v.flags & SF.LOOP) !== 0);
    if (!s.randomSounds) this.stopWhere((v) => (v.flags & SF.RANDOM_PLACE) !== 0);
    if (s.soundVolume !== prev.soundVolume) for (const v of this.voices) this.place(v);
  }

  private note(line: string): void {
    this.log.push(line);
    if (this.log.length > 200) this.log.shift();
  }

  dispose(): void {
    this.offSettings();
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    this.stopMusic();
    this.stopWhere(() => true);
    void this.ctx?.close();
    this.ctx = null;
  }
}
