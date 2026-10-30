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
//
// Ours: ambient sounds (playAmbient: chatter, crowds, thunder, birds) on a bus of their own under
// the Sound Volume, with the Ambient Sounds option's volume, and voices of their own, so they
// never take the server's 24.

import { FINENESS } from "@shards/formats";
import { SF } from "@shards/protocol";
import type { SoundEvent } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { getSettings, onSettings, type Settings } from "./settings.ts";

const MAX_SOUNDS = 24;

const ROLLOFF = 0.00016;
const MAX_DIST = FINENESS * 32;
/** Ours: at most this many ambient sounds at once */
const MAX_AMBIENT = 16;
/** The gestures that let a page play sound (GameAudio.unlock): a key, a mouse press, or a touch ending */
const UNLOCK_EVENTS = ["keydown", "pointerdown", "pointerup", "touchend", "click"] as const;
/** Ours: how far an ambient sound carries unless told (fine units) */
const AMBIENT_RANGE = FINENESS * 20;

/** Ours: how an ambient sound plays (GameAudio.playAmbient) */
export interface AmbientSoundOptions {
  /** Where it sounds from (fine units); none: about us (2D) */
  at?: { x: number; y: number } | null;
  /** How far it carries (fine units), falling off to nothing there */
  range?: number;
  /** Against the ambient volume, 1 as recorded */
  volume?: number;
  loop?: boolean;
  /** Playback rate (pitch) */
  rate?: number;
  /** A low-pass cutoff in Hz: far off, or muffled by a wall or the rain */
  lowpass?: number;
  /** A fixed pan, -1 (left) .. 1, for a sound about us */
  pan?: number;
  /** ms to fade in */
  fadeIn?: number;
  /** Where to start in it, seconds; "random" for a loop not to start the same way each time */
  offset?: number | "random";
  /** ms to wait before it plays (thunder after the flash) */
  delay?: number;
  /** Seconds of it to play, from `offset`, then a quick fade (one cough of a recording of several) */
  duration?: number;
}

/** Ours: an ambient sound playing (or about to) */
export interface AmbientSound {
  readonly done: boolean;
  setVolume(volume: number, ms?: number): void;
  setAt(x: number, y: number): void;
  setPan(pan: number): void;
  setLowpass(hz: number, ms?: number): void;
  stop(fadeMs?: number): void;
}

class AmbientVoice implements AmbientSound {
  done = false;
  at: { x: number; y: number } | null;
  range: number;
  volume: number;
  fixedPan: number;
  source: AudioBufferSourceNode | null = null;
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
  readonly filter: BiquadFilterNode;
  private readonly owner: GameAudio;
  constructor(owner: GameAudio, ctx: AudioContext, bus: AudioNode, o: AmbientSoundOptions) {
    this.owner = owner;
    this.at = o.at ? { ...o.at } : null;
    this.range = o.range ?? AMBIENT_RANGE;
    this.volume = o.volume ?? 1;
    this.fixedPan = o.pan ?? 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = o.lowpass ?? 22000;
    this.filter.connect(this.gain).connect(this.pan).connect(bus);
  }
  setVolume(volume: number, ms = 300): void {
    this.volume = volume;
    this.owner.placeAmbient(this, ms);
  }
  setAt(x: number, y: number): void {
    if (!this.at) this.at = { x, y };
    else {
      this.at.x = x;
      this.at.y = y;
    }
    this.owner.placeAmbient(this, 100);
  }
  setPan(pan: number): void {
    this.fixedPan = pan;
    this.owner.placeAmbient(this, 100);
  }
  setLowpass(hz: number, ms = 500): void {
    const t = this.filter.context.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(hz, t, ms / 3000);
  }
  stop(fadeMs = 0): void {
    if (this.done) return;
    this.done = true;
    const ctx = this.gain.context;
    const t = ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
    const src = this.source;
    setTimeout(() => {
      try {
        src?.stop();
      } catch {
        // never started
      }
      this.pan.disconnect();
      this.owner.dropAmbient(this);
    }, fadeMs + 50);
  }
}

interface Voice {
  file: string;
  flags: number;
  /** Fine coordinates, or null for a 2D sound */
  pos: { x: number; y: number } | null;
  /** Ours: how loud against the Sound Volume (1 the original's) */
  volume: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

/** Silence's muffle (setMuffle): the low-pass from wide open down to this, and this much quieter */
const MUFFLE_OPEN_HZ = 20000;
const MUFFLE_SHUT_HZ = 700;
const MUFFLE_QUIETER = 0.35;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  /** Ours: the ambient sounds, on their own bus */
  private ambientVoices: AmbientVoice[] = [];
  private ambientBus: GainNode | null = null;
  /** Ours (the spell revamp, V4): the room's sounds (not the music), through Silence's muffle */
  private roomBus: GainNode | null = null;
  private muffleFilter: BiquadFilterNode | null = null;
  private muffled = 0;
  private music: { file: string; source: AudioBufferSourceNode | null; gain: GainNode } | null = null;
  /** The room's track, kept while music is off so switching it on restarts it (MusicRestart). */
  private wantedMusic: string | null = null;
  /** Ours: the room's track while the dashboard previews another (previewMusic); "" none */
  private roomMusic: string | null = null;
  private listener = { x: 0, y: 0, angle: 0 };
  /** What's playing by: the settings (the Preferences window applies its choices as they're made) */
  private settings: Settings;
  private readonly assets: AssetStore;
  /** Where an object is, for sounds that come from one (GamePlaySound: obj->motion.x/y) */
  objectPosition: (id: number) => { x: number; y: number } | undefined = () => undefined;
  /** The name of an object a sound comes from, for the log */
  objectName: (id: number) => string | undefined = () => undefined;
  /** Log of what plays, for the dev console (window.shards.audio.log) */
  readonly log: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();

  private readonly offSettings: () => void;

  constructor(assets: AssetStore) {
    this.assets = assets;
    this.settings = getSettings();
    this.offSettings = onSettings((s) => this.setSettings(s));
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, true);
  }

  /**
   * Browsers start audio suspended until the page gets a click or key press (the apps don't:
   * Electron's autoplayPolicy, the Android WebView's setMediaPlaybackRequiresUserGesture), so the
   * login screen's music starts with the player's first one. A touch only counts once the finger
   * lifts (pointerup, touchend, click), so those are listened for as well as a mouse's press.
   */
  private readonly unlock = () => {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  };

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.muffleFilter = this.ctx.createBiquadFilter();
      this.muffleFilter.type = "lowpass";
      this.muffleFilter.frequency.value = MUFFLE_OPEN_HZ;
      this.muffleFilter.connect(this.master);
      this.roomBus = this.ctx.createGain();
      this.roomBus.connect(this.muffleFilter);
      this.ambientBus = this.ctx.createGain();
      this.ambientBus.gain.value = this.ambientLevel();
      this.ambientBus.connect(this.roomBus);
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
        this.roomMusic = null;
        void this.playMusic(e.file);
        break;
      case "stopLoops":
        this.note("server: stop the looping sounds");
        this.stopWhere((v) => (v.flags & SF.LOOP) !== 0);
        break;
      case "stop":
        // audio.c SoundStopFile stops every voice playing that file
        this.note(`server: stop ${e.file.toLowerCase()}`);
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
        const from = w.object ? `server, from ${this.objectName(w.object) ?? "object"} (${w.object})` : w.row > 0 || w.col > 0 ? `server, at row ${w.row} col ${w.col}` : "server";
        void this.playSound(e.file, w.flags, pos, 1, from);
        break;
      }
    }
  }

  /** A sound the client plays itself (wading), at the player. */
  playLocal(file: string): void {
    void this.playSound(file, 0, null, 1, "client");
  }

  /** A sound the client plays itself at a spot (audio.c SoundPlayFile with x, y: fireworks). */
  /** A sound at a place; `volume` scales it (ours: ambient critters die quieter than monsters) */
  playAt(file: string, x: number, y: number, volume = 1): void {
    void this.playSound(file, 0, { x, y }, volume, "client");
  }

  /** Ours: whether ambient sounds can be heard at all */
  get ambientOn(): boolean {
    return this.ambientLevel() > 0;
  }

  /** Ours: how loud the ambient bus is (the Sound Volume and the Ambient Sounds option) */
  private ambientLevel(): number {
    const s = this.settings;
    return s.sound && s.ambientSounds ? (s.soundVolume / 100) * (s.ambientVolume / 100) : 0;
  }

  /**
   * Ours: an ambient sound (chatter, crowds, thunder, birds). It returns at once; the sound starts
   * when its file has loaded (and after `delay`), unless stopped before.
   */
  playAmbient(file: string, o: AmbientSoundOptions = {}): AmbientSound {
    const ctx = this.context();
    const v = new AmbientVoice(this, ctx, this.ambientBus!, o);
    if (this.ambientVoices.length >= MAX_AMBIENT || this.ambientLevel() === 0) {
      v.done = true;
      v.pan.disconnect();
      return v;
    }
    this.ambientVoices.push(v);
    const name = file.toLowerCase();
    void this.buffer(name).then((buf) => {
      if (!buf || v.done) {
        if (!buf) this.dropAmbient(v);
        v.done = true;
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = !!o.loop;
      src.playbackRate.value = o.rate ?? 1;
      src.connect(v.filter);
      v.source = src;
      const start = ctx.currentTime + (o.delay ?? 0) / 1000;
      const offset = o.offset === "random" ? Math.random() * buf.duration : Math.min(o.offset ?? 0, buf.duration);
      this.placeAmbient(v, 0, start);
      if (o.fadeIn) {
        // What placeAmbient just set. Not gain.value: that's what was last rendered, still 0 here,
        // and a bed whose volume never changes (the court's) stayed silent (2026-10-27)
        const target = this.ambientGain(v);
        v.gain.gain.cancelScheduledValues(ctx.currentTime);
        v.gain.gain.setValueAtTime(0, start);
        v.gain.gain.linearRampToValueAtTime(target, start + o.fadeIn / 1000);
      }
      src.start(start, offset);
      if (o.duration !== undefined && !o.loop) {
        // Fade out over the last 80 ms, so it doesn't click off
        const end = start + Math.max(0.1, Math.min(o.duration, buf.duration - offset));
        v.gain.gain.setValueAtTime(this.ambientGain(v), end - 0.08);
        v.gain.gain.linearRampToValueAtTime(0, end);
        src.stop(end + 0.01);
      }
      if (!o.loop)
        src.onended = () => {
          v.done = true;
          v.pan.disconnect();
          this.dropAmbient(v);
        };
      this.note(`ambient (ours): ${name}${o.loop ? " (loops)" : ""}`);
    });
    return v;
  }

  /** Ours: an ambient voice's gain and pan from where it is (falling off to nothing at its range) */
  placeAmbient(v: AmbientVoice, ms: number, at?: number): void {
    if (v.done) return;
    const { g, pan } = this.ambientPlace(v);
    const t = at ?? v.gain.context.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    if (ms <= 0) v.gain.gain.setValueAtTime(g, t);
    else v.gain.gain.setTargetAtTime(g, t, ms / 3000);
    v.pan.pan.setTargetAtTime(pan, t, 0.03);
  }

  /** An ambient voice's gain (its volume, falling off with distance) and pan, from where it is */
  private ambientPlace(v: AmbientVoice): { g: number; pan: number } {
    let g = v.volume,
      pan = v.fixedPan;
    if (v.at) {
      const dx = v.at.x - this.listener.x,
        dy = v.at.y - this.listener.y;
      const d = Math.hypot(dx, dy);
      g *= Math.pow(Math.max(0, 1 - d / v.range), 2);
      const a = (this.listener.angle * 2 * Math.PI) / 4096;
      // Never hard to one side: a sound beside us still reaches the other ear
      pan = d < 1 ? 0 : 0.85 * Math.max(-1, Math.min(1, (dx * -Math.sin(a) + dy * Math.cos(a)) / d));
    }
    return { g, pan };
  }

  private ambientGain(v: AmbientVoice): number {
    return this.ambientPlace(v).g;
  }

  dropAmbient(v: AmbientVoice): void {
    const i = this.ambientVoices.indexOf(v);
    if (i >= 0) this.ambientVoices.splice(i, 1);
  }

  /** Ours: every ambient sound stops (the option turned off, the game left) */
  stopAmbient(fadeMs = 0): void {
    for (const v of [...this.ambientVoices]) v.stop(fadeMs);
  }

  /**
   * Ours (the admin dashboard's Music & Sounds tab, development only): plays a track in place of
   * the room's until it's called with null, which brings the room's back, or the next room sends
   * its own.
   */
  previewMusic(file: string | null): void {
    if (file) {
      this.roomMusic ??= this.wantedMusic ?? "";
      if (this.music?.file === file.toLowerCase()) this.stopMusic();
      void this.playMusic(file);
      return;
    }
    const room = this.roomMusic;
    this.roomMusic = null;
    if (room === null) return;
    this.stopMusic();
    if (room) void this.playMusic(room);
    else this.wantedMusic = null;
  }

  /** Ours (development only): a file changed on the server: fetched anew next time, the track restarted if it's playing */
  forget(file: string): void {
    const key = file.toLowerCase();
    this.buffers.delete(key);
    if (this.music?.file === key) {
      this.stopMusic();
      void this.playMusic(key);
    }
  }

  /** Ours: music that fades in from silence over `fadeInMs` once it starts (the login screen's) */
  fadeInMusic(file: string, fadeInMs: number): void {
    void this.playMusic(file, fadeInMs);
  }

  private async playMusic(file: string, fadeInMs = 0): Promise<void> {
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
    if (fadeInMs > 0) {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(this.settings.musicVolume / 100, t + fadeInMs / 1000);
    }
    src.start();
    entry.source = src;
    this.note(`server: music ${name}`);
  }

  private stopMusic(): void {
    if (!this.music) return;
    this.music.source?.stop();
    this.music.gain.disconnect();
    this.music = null;
  }

  private async playSound(file: string, flags: number, pos: Voice["pos"], volume = 1, from = "client"): Promise<void> {
    const s = this.settings;
    const loop = (flags & SF.LOOP) !== 0;
    if (!s.sound || (loop && !s.loopSounds) || (flags & SF.RANDOM_PLACE && !s.randomSounds)) return;
    if (this.voices.length >= MAX_SOUNDS) return this.note(`${from}: skipped ${file} (${MAX_SOUNDS} playing)`);
    const name = file.toLowerCase();
    const buf = await this.buffer(name);
    if (!buf || this.voices.length >= MAX_SOUNDS) return;
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = loop;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    source.connect(gain).connect(pan).connect(this.roomBus!);
    const v: Voice = { file: name, flags, pos, volume, source, gain, pan };
    this.voices.push(v);
    this.place(v);
    source.onended = () => this.remove(v);
    source.start();
    // What kind of sound it is: a room's loops and random sounds can be switched off in Preferences
    const kind = [loop && "loops", flags & SF.RANDOM_PLACE && "random sound", flags & SF.RANDOM_PITCH && "random pitch"].filter(Boolean).join(", ");
    this.note(`${from}: ${name}${kind ? ` (${kind})` : ""}${pos ? ` at ${(pos.x / FINENESS).toFixed(1)}, ${(pos.y / FINENESS).toFixed(1)}` : ""}`);
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
    const vol = (this.settings.soundVolume / 100) * v.volume;
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
    for (const v of this.ambientVoices) if (v.at) this.placeAmbient(v, 60);
  }

  private setSettings(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (this.music && s.musicVolume !== prev.musicVolume) {
      // Ends a fade-in (fadeInMusic) at the new volume
      this.music.gain.gain.cancelScheduledValues(0);
      this.music.gain.gain.value = s.musicVolume / 100;
    }
    if (!s.music) this.stopMusic();
    else if (!prev.music && this.wantedMusic) void this.playMusic(this.wantedMusic);
    if (!s.sound) this.stopWhere(() => true);
    if (!s.loopSounds) this.stopWhere((v) => (v.flags & SF.LOOP) !== 0);
    if (!s.randomSounds) this.stopWhere((v) => (v.flags & SF.RANDOM_PLACE) !== 0);
    if (s.soundVolume !== prev.soundVolume) for (const v of this.voices) this.place(v);
    if (this.ambientBus) this.ambientBus.gain.setTargetAtTime(this.ambientLevel(), this.ambientBus.context.currentTime, 0.05);
  }

  /**
   * Ours (the spell revamp, V4): how muffled the room's sounds are, 0 (clear) to 1 (Silence on
   * the room, Enhanced Visuals): quieter and dull, the music left alone
   */
  setMuffle(k: number): void {
    const m = Math.max(0, Math.min(1, k));
    if (Math.abs(m - this.muffled) < 0.01 || !this.ctx || !this.roomBus || !this.muffleFilter) return;
    this.muffled = m;
    const t = this.ctx.currentTime;
    this.muffleFilter.frequency.setTargetAtTime(MUFFLE_OPEN_HZ * (MUFFLE_SHUT_HZ / MUFFLE_OPEN_HZ) ** m, t, 0.15);
    this.roomBus.gain.setTargetAtTime(1 - MUFFLE_QUIETER * m, t, 0.15);
  }

  private note(line: string): void {
    this.log.push(line);
    if (this.log.length > 200) this.log.shift();
    for (const fn of this.listeners) fn(line);
  }

  /** Each line of the log as it's written (the admins' Debug tab) */
  onLog(fn: (line: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.offSettings();
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, true);
    this.stopMusic();
    this.stopWhere(() => true);
    this.stopAmbient();
    void this.ctx?.close();
    this.ctx = null;
  }
}
