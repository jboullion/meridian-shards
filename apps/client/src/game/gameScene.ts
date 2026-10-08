// The in-game 3D view: the player's room with its objects, seen from the player's eyes,
// with the original client's movement (move.c). Keys come from the settings (the modern
// or the original preset, rebindable; see settings.ts). Modern defaults:
//   click the view: capture the mouse (mouselook); Esc releases it
//   WASD / arrows: move and strafe (arrows left/right turn); Shift runs
//   Space or E: open a door / take the exit you stand on (BP_REQ_GO)
//   left click: select the object under the cursor as your target (crosshair when captured)
//   E: attack the target (or the closest thing you can attack); [ ] \ Esc: next, previous,
//   yourself, no target;  R: look at the target;  F or double click: pick up / activate
//   right click: actions menu (the original preset: look)
//   PgUp/PgDn/Home: look up, down, straight; End: turn around;  Enter: chat

import * as THREE from "three";
import { FINENESS, ceilingHeightAt, floorHeightAt, gridTextureName, leafAt, skyboxForBackground, type Bgf, type Room } from "@shards/formats";
import {
  DRAWFX, OF, ObjectsView, PARTICLE_STEPS_PER_SECOND, RoomView, SkyOverlaysView, TrailBlur, WeatherParticles, XlatTable, type ParticleRoom, disposeSkybox, objectBrightness, paletteTexture, type LightSource,
  type NameLabel, type ViewObject,
} from "@shards/render";
import { LiveRoom, PlayerMover, REMOTE_VIEW, animStep, type DamageDealt, type RemoteView, type GameSession, type WorldObject } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { RoomCache } from "../render/roomCache.ts";
import { loadSkybox, type LoadedRoom } from "../render/roomLoader.ts";
import { ORIGINAL_FOV } from "../viewer/roomScene.ts";
import type { GameAudio } from "./audio.ts";
import { ScreenOverlays } from "./screenOverlays.ts";
import { HALO_COLOR, actionsFor, getSettings, isHeld, mouseCode, onSettings, type Action, type Mods, type Settings } from "./settings.ts";

/** Eye height above the floor (clientd3d/game.c player.height = 3/4 square). */
const EYE_HEIGHT = 768;
/** Mouse sensitivity in client angle units per pixel (4096 per circle). */
const MOUSE_TURN = 2.5;
/** Keyboard look up/down speed, radians per second (A_LOOKUP / A_LOOKDOWN held). */
const PITCH_RATE = 1.2;
const MAX_PITCH = 1.2;
const OF_PLAYER = 0x4;
/** statmain.c STAT_VIGOR (in stat group 1) and MIN_VIGOR */
const STAT_VIGOR = 3;
const MIN_VIGOR = 10;
/** project.h PROJ_FLAG_FOLLOWGROUND */
const PROJ_FLAG_FOLLOWGROUND = 0x1;
const OF_ATTACKABLE = 0x8;
const OF_GETTABLE = 0x10;
const OF_CONTAINER = 0x20;
const OF_NOEXAMINE = 0x40;
const OF_ACTIVATABLE = 0x800;
/** gameuser.c: at most one attack every 250 ms; the closest target must be this near */
const ATTACK_DELAY = 250;
const CLOSE_DISTANCE = 5 * FINENESS;
/** effect.c SHAKE_AMPLITUDE */
const SHAKE_AMPLITUDE = FINENESS / 4;
/** A wall within this many squares of a label's anchor doesn't hide it: signs hang on walls */
const LABEL_OCCLUSION_SLACK = 0.1;
/** Damage numbers (ours): how long one shows, how far it rises on screen, and when it starts to fade (0..1) */
const DAMAGE_LIFE_MS = 1200;
const DAMAGE_RISE_PX = 48;
const DAMAGE_FADE = 0.6;

/** A damage number floating over what we hit */
interface DamageFloat {
  id: number;
  born: number;
  /** The top of the object's sprite, last seen (kept if it dies or goes out of sight) */
  pos: THREE.Vector3 | null;
  /** Pixels sideways, so quick hits don't stack exactly */
  dx: number;
  el: HTMLDivElement;
}

export interface GameSceneStatus {
  roomName: string;
  objects: number;
  lights: number;
  loading: boolean;
}

/** The longest the view waits for a new room's sprites and sky before showing it anyway. */
const ENTER_TIMEOUT_MS = 4000;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(ORIGINAL_FOV.vertical, 1, 0.05, 400);
  readonly mover: PlayerMover;
  private readonly session: GameSession;
  private readonly assets: AssetStore;
  private readonly labelsEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private palette: THREE.Texture | null = null;
  private xlats: XlatTable | null = null;
  private objects: ObjectsView | null = null;
  /** The sun and the moon (boverlay.c) */
  private skyOverlays: SkyOverlaysView | null = null;
  private room: Room | null = null;
  private roomView: RoomView | null = null;
  private roomRes = 0;
  /** The current room as the cache loaded it (shared; never changed) */
  private loaded: LoadedRoom | null = null;
  /** The current room with the server's changes (roomanim.c); `room` is its room */
  private live: LiveRoom | null = null;
  /** How many of the world's room changes `live` has applied */
  private liveApplied = 0;
  /** The live room's version `roomView` shows */
  private liveDrawn = 0;
  /** Our own view of the changed room (the cache's view stays as the file has it) */
  private ownView: RoomView | null = null;
  /** Rain, snow, sand and fireworks (d3dparticle.c) */
  private weather: WeatherParticles | null = null;
  /** Particle steps owed (they run at the original's 70 frames a second) */
  private particleTime = 0;
  /** Blurred and wavering vision (EFFECT_BLUR, EFFECT_WAVER), made when first needed */
  private blur: TrailBlur | null = null;
  /** Grid textures a change asked for that are loading */
  private textureLoads = new Set<number>();
  /** This room and the ones next to it, loaded ahead */
  private rooms: RoomCache | null = null;
  /**
   * Between leaving a room and having the next one ready (its geometry, the sprites of
   * what's in it and its sky), the view keeps its last picture instead of drawing the
   * objects in a half-loaded room.
   */
  private entering = false;
  /** Resolves when the server has sent the current room's contents (BP_ROOM_CONTENTS). */
  private contentsArrived: Promise<void> = Promise.resolve();
  private contentsResolve: (() => void) | null = null;
  private sky: THREE.Group | null = null;
  private skyName = "";
  private readonly bgfs = new Map<number, Bgf | null | undefined>();
  private readonly bgfLoads = new Map<number, Promise<void>>();
  private lights: LightSource[] = [];
  private pitch = 0;
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private hovered: number | null = null;
  /** graphics.c UserStartDrag: a room object being dragged towards the inventory */
  private drag: number | null = null;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver;
  private labelPool: HTMLDivElement[] = [];
  private damageFloats: DamageFloat[] = [];
  private readonly raycaster = new THREE.Raycaster();
  /** For hiding name labels behind walls */
  private readonly labelRay = new THREE.Raycaster();
  private overlays: ScreenOverlays | null = null;
  /** The selected target (gameuser.c idTarget), or null */
  target: number | null = null;
  /** Waiting for the user to pick a spell target (GAME_SELECT); called with the pick */
  private selectCallback: ((id: number) => void) | null = null;
  private lastAttack = 0;
  private settings: Settings = getSettings();
  private altDown = false;
  private ctrlDown = false;
  /** Frames since the last FPS report (Show FPS) */
  private fpsFrames = 0;
  private fpsSince = performance.now();
  readonly audio: GameAudio;
  private readonly offSettings: () => void;
  fog = true;
  /** command.c pinfo.resting: no moving, attacking or going through doors (mermain.c InterfaceAction) */
  resting = false;
  onStatus?: (s: GameSceneStatus) => void;
  /** Enter pressed: focus the chat input */
  onChatKey?: () => void;
  /** Look at a room object (A_LOOKMOUSE, A_LOOK): the description dialog */
  onLook?: (id: number) => void;
  /** Pick up (A_PICKUP): the gettable objects to choose from; just one is picked up at once */
  onPickup?: (ids: number[]) => void;
  /**
   * Several objects qualify (lookdlg.c DisplayLookList with LD_SINGLEAUTO): ask which one, under
   * `title` (IDS_LOOK, IDS_ATTACK, IDS_ACTIVATE, IDS_GET), with `initial` chosen to start with
   */
  onChoose?: (title: string, ids: number[], then: (id: number) => void, initial?: number) => void;
  /** Look inside a container (BP_SEND_OBJECT_CONTENTS; the contents come back as BP_OBJECT_CONTENTS) */
  onContents?: (id: number) => void;
  /** A key bound to a panel action (inventory, settings, map zoom) */
  onAction?: (a: Action) => void;
  /** Say, Tell, Yell, Broadcast, Emote keys: start a chat line with this command */
  onChatPrefix?: (prefix: string) => void;
  /** A function key with no action bound: its hotkey alias (alias.c AliasKey), 1..12 */
  onHotkey?: (n: number) => void;
  /** Show FPS: frames per second, about twice a second */
  onFps?: (fps: number) => void;
  /** Type-to-chat: a printable key starts a chat line with this text */
  onTypeChat?: (text: string) => void;
  /** The target changed (the interface shows it) */
  onTarget?: (id: number | null) => void;
  /** Selecting a spell target started (true) or ended (false) */
  onSelecting?: (on: boolean) => void;
  /** A line for the chat window from the client itself */
  onMessage?: (text: string) => void;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, session: GameSession, assets: AssetStore, audio: GameAudio) {
    this.canvas = canvas;
    this.labelsEl = labels;
    this.session = session;
    this.assets = assets;
    this.audio = audio;
    this.audio.objectPosition = (id) => session.world.objects.get(id);
    this.offSettings = onSettings((s) => {
      this.settings = s;
      this.applyViewSettings();
    });
    this.mover = new PlayerMover({
      move: (x, y, speed) => session.requestMove(x, y, speed),
      turn: (angle) => session.requestTurn(angle),
      wade: () => {
        const file = this.session.resource(this.session.world.player?.wadingSoundRes ?? 0);
        if (file) this.audio.playLocal(file);
      },
    });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.background = new THREE.Color(0x000000);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.unsubscribe = session.world.on((e) => {
      const self = session.world.self;
      switch (e.type) {
        case "player":
          if (e.roomChanged) {
            // BP_ROOM_CONTENTS follows BP_PLAYER on entering a room
            this.contentsArrived = new Promise((r) => (this.contentsResolve = r));
            // game.c EnterNewRoom: SetUserTargetID(INVALID_ID)
            this.setTarget(null);
            this.clearDamage();
          }
          // BP_PLAYER carries the room's background too (teleports change both)
          void this.syncRoom();
          break;
        case "background":
          void this.syncSky();
          break;
        case "roomChange":
          this.applyRoomChanges();
          break;
        case "roomContents":
          this.contentsResolve?.();
          this.contentsResolve = null;
          if (self) {
            this.mover.place(self.x, self.y, performance.now());
            this.mover.setAngle(self.angle);
            this.pitch = 0;
          }
          break;
        case "selfMoved":
          this.mover.place(e.x, e.y, performance.now());
          break;
        case "selfTurned":
          this.mover.setAngle(e.angle);
          break;
        case "objectRemoved":
          if (this.target !== null && e.id === this.target) this.setTarget(null);
          break;
        case "wait":
          // cursor.c GameWindowSetCursor: the wait cursor in GAME_WAIT
          this.canvas.classList.toggle("server-wait", e.waiting);
          break;
        case "idsStale":
          // server.c HandleWait / HandleInvalidateData: SetUserTargetID(INVALID_ID)
          this.setTarget(null);
          if (this.selecting) this.select(null);
          this.drag = null;
          this.clearDamage();
          break;

      }
    });
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("mousemove", this.onCanvasMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    void this.init();
    if (import.meta.env.DEV) (window as unknown as { shards: unknown }).shards = { gameScene: this, session, audio: this.audio, THREE };
  }

  private async init(): Promise<void> {
    const [pal, lightPal] = await Promise.all([this.assets.palette(), this.assets.lightPalettes()]);
    if (this.disposed) return;
    this.palette = paletteTexture(pal);
    this.rooms = new RoomCache(this.assets, this.palette);
    this.xlats = new XlatTable(pal.rgb, lightPal);
    this.objects = new ObjectsView(this.palette, this.xlats, (id) => this.bgf(id), (id) => this.session.resource(id));
    this.scene.add(this.objects.group);
    this.skyOverlays = new SkyOverlaysView(pal.rgb);
    this.scene.add(this.skyOverlays.group);
    this.applyViewSettings();
    this.overlays = new ScreenOverlays(this.labelsEl.parentElement!, pal.rgb, this.xlats, (id) => this.bgf(id));
    this.weather = new WeatherParticles(await this.snowTexture());
    this.weather.onFireworkSound = (x, y) => this.audio.playAt("firework.ogg", x, y);
    this.scene.add(this.weather.group);
    await this.syncRoom();
    const loop = (t: number) => {
      this.frame(Math.min(250, t - this.last), t);
      this.last = t;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The .bgf for an icon resource: loads on first use, undefined while loading. */
  private bgf(resource: number): Bgf | null | undefined {
    if (!this.bgfLoads.has(resource)) void this.loadBgf(resource);
    return this.bgfs.get(resource);
  }

  /** Loads an icon resource's .bgf once; resolves when it's there (or known missing). */
  private loadBgf(resource: number): Promise<void> {
    let p = this.bgfLoads.get(resource);
    if (!p) {
      this.bgfs.set(resource, undefined);
      const name = this.session.resource(resource);
      if (!name) {
        this.bgfs.set(resource, null);
        p = Promise.resolve();
      } else
        p = this.assets.bgf(name).then(
          (b) => void this.bgfs.set(resource, b),
          () => void this.bgfs.set(resource, null),
        );
      this.bgfLoads.set(resource, p);
    }
    return p;
  }

  /** The sprites of everything in the room, once the server has said what's in it. */
  private async objectsReady(): Promise<void> {
    await this.contentsArrived;
    const res = new Set<number>();
    for (const o of this.session.world.objects.values()) {
      res.add(o.info.iconRes);
      for (const ov of o.look.overlays) res.add(ov.iconRes);
    }
    await Promise.all([...res].map((r) => this.loadBgf(r)));
  }

  private async syncRoom(): Promise<void> {
    const p = this.session.world.player;
    if (!p || !this.rooms || p.roomRes === this.roomRes) {
      // game.c HandlePlayer loads the room again even when it's the same one; the server
      // then sends its changes again (user.kod ToCliPlayer)
      if (!this.entering) this.resetLiveRoom();
      return void this.syncSky();
    }
    this.roomRes = p.roomRes;
    const name = this.session.resource(p.roomRes);
    if (!name) return;
    this.entering = true;
    this.status(true);
    void this.rooms.enter(name);
    let loaded;
    try {
      loaded = await this.rooms.get(name);
    } catch (e) {
      console.error(`room ${name}: ${(e as Error).message}`);
      this.entering = false;
      this.status(false);
      return;
    }
    if (this.disposed || this.roomRes !== p.roomRes) return;
    // The cache owns room views: neighbours stay loaded for when you walk back
    this.loaded = loaded;
    this.resetLiveRoom();
    const self = this.session.world.self;
    if (self) {
      this.mover.place(self.x, self.y, performance.now());
      this.mover.setAngle(self.angle);
    }
    // Show it all at once; a slow sprite or sky can't hold the view for more than a few seconds
    await Promise.race([Promise.all([this.objectsReady(), this.syncSky()]), new Promise((r) => setTimeout(r, ENTER_TIMEOUT_MS))]);
    if (this.disposed || this.roomRes !== p.roomRes) return;
    this.entering = false;
    this.applyRoomChanges();
    this.status(false);
  }

  /**
   * Starts the current room over as the file has it (the cache's view), then applies the
   * changes the server has sent since BP_PLAYER.
   */
  private resetLiveRoom(): void {
    const loaded = this.loaded;
    if (!loaded) return;
    if (this.roomView) this.scene.remove(this.roomView.group);
    this.ownView?.dispose();
    this.ownView = null;
    this.live = new LiveRoom(loaded.room);
    // bspload.c: loading a room starts the particle emitters over
    this.weather?.reset();
    this.live.numGroups = (id) => this.roomBgf(id)?.groups.length ?? 0;
    this.liveApplied = 0;
    this.liveDrawn = 0;
    this.room = this.live.room;
    this.roomView = loaded.view;
    this.scene.add(loaded.view.group);
    this.mover.room = this.live.room;
    this.applyRoomChanges();
  }

  /** Applies the room changes the live room hasn't seen yet (BP_SECTOR_MOVE and the rest). */
  private applyRoomChanges(): void {
    const live = this.live;
    if (!live || this.entering) return;
    const changes = this.session.world.roomChanges;
    if (this.liveApplied > changes.length) this.liveApplied = 0; // a BP_PLAYER started a new list
    for (; this.liveApplied < changes.length; this.liveApplied++) live.apply(changes[this.liveApplied]);
    this.loadRoomTextures();
  }

  private roomBgf(id: number): Bgf | undefined {
    return this.loaded?.bgfs.get(id) ?? this.ownViewTextures.get(id);
  }

  /** Grid textures that changes brought in (BP_CHANGE_TEXTURE), beyond the room's own */
  private ownViewTextures = new Map<number, Bgf>();

  /** BP_CHANGE_TEXTURE can name textures the room file doesn't use: load them, then redraw */
  private loadRoomTextures(): void {
    const live = this.live;
    if (!live) return;
    for (const id of live.textureIds()) {
      if (this.roomBgf(id) || this.textureLoads.has(id)) continue;
      this.textureLoads.add(id);
      this.assets.bgf(gridTextureName(id)).then(
        (b) => {
          this.textureLoads.delete(id);
          if (!b?.bitmaps.length || this.disposed) return;
          this.ownViewTextures.set(id, b);
          this.ownView?.addTexture(id, b);
          if (this.live) this.live.version++;
        },
        () => this.textureLoads.delete(id),
      );
    }
  }

  /** Draws the live room's changes: our own view of it, built again when it changed. */
  private drawRoomChanges(dt: number): void {
    const live = this.live;
    if (!live || !this.loaded || !this.palette) return;
    live.tick(dt);
    if (live.version === this.liveDrawn) return;
    this.liveDrawn = live.version;
    if (!this.ownView) {
      const textures = new Map(this.loaded.bgfs);
      for (const [id, b] of this.ownViewTextures) textures.set(id, b);
      this.ownView = new RoomView(live.room, textures, this.palette);
      if (this.roomView) this.scene.remove(this.roomView.group);
      this.roomView = this.ownView;
      this.scene.add(this.ownView.group);
    } else this.ownView.rebuild(live.room);
  }

  private async syncSky(): Promise<void> {
    const bg = this.session.resource(this.session.world.background) ?? "";
    const bsf = skyboxForBackground(bg);
    if ((bsf ?? "") === this.skyName) return;
    this.skyName = bsf ?? "";
    if (this.sky) {
      this.scene.remove(this.sky);
      disposeSkybox(this.sky);
      this.sky = null;
    }
    if (!bsf) return;
    const sky = await loadSkybox(this.assets, bsf);
    if (this.disposed || this.skyName !== bsf) return disposeSkybox(sky);
    this.sky = sky;
    this.scene.add(sky);
  }

  private frame(dt: number, now: number): void {
    const world = this.session.world;
    const self = world.self;
    const room = this.room;
    // Entering a room: keep the last picture until the new room is ready
    if (this.entering) return;
    if (!(room && this.roomView && this.objects && self && this.mover.room === room)) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // The room's lifts and wall changes first: collision uses the heights they leave
    this.drawRoomChanges(dt);
    // --- movement (move.c) ---
    const held = (a: Action) => (isHeld(this.settings.keys, a, this.keys, this.mods()) ? 1 : 0);
    // EFFECT_PARALYZE, and GAME_WAIT while the server saves: no motion
    // and move.c: through another object's eyes, only with REMOTE_VIEW_MOVE (and not CONTROL)
    const remote = this.remoteView();
    const rv = remote?.view.flags ?? 0;
    const still = world.effects.paralyzed || world.waiting || this.resting || (remote !== null && (rv & REMOTE_VIEW.CONTROL || !(rv & REMOTE_VIEW.MOVE)));
    const forward = still ? 0 : held("forward") - held("backward");
    const strafe = still ? 0 : held("strafeRight") - held("strafeLeft");
    const turn = remote && !(rv & REMOTE_VIEW.TURN) ? 0 : held("turnRight") - held("turnLeft");
    // Always Run (config.ini alwaysrun): the Run/Walk key walks instead
    // mermain.c: too tired to run below MIN_VIGOR (10)
    const vigor = world.stats.get(1)?.find((st) => st.num === STAT_VIGOR)?.numeric?.value ?? MIN_VIGOR;
    const run = (held("run") === 1) !== this.settings.alwaysRun && vigor >= MIN_VIGOR;
    const angleBefore = this.mover.angle;
    this.mover.turnKeys(turn, run, dt);
    if (remote && rv & REMOTE_VIEW.CONTROL) {
      // move.c UserTurnPlayer, REMOTE_VIEW_CONTROL: the turn turns the object we see through
      remote.obj.angle = (remote.obj.angle + this.mover.angle - angleBefore + 4096) & 4095;
      this.mover.setAngle(angleBefore);
    }
    const pitchDir = held("lookUp") - held("lookDown");
    if (pitchDir) this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + (pitchDir * PITCH_RATE * dt) / 1000));
    this.mover.roomFlags = world.player?.roomFlags ?? 0;
    this.mover.overrideDepths = (world.player?.depths ?? [0, 0, 0]).map((d) => d << 4) as [number, number, number];
    this.mover.update({ forward, strafe, run }, dt, now, world.objects.values(), self.id);
    self.x = this.mover.x;
    self.y = this.mover.y;
    self.angle = this.mover.angle;
    world.tick(dt);
    this.audio.setListener(this.mover.x, this.mover.y, this.mover.angle);

    // --- camera: our eyes, or the object's we see through (draw.c DrawRoom) ---
    const eye = remote ? this.remoteEye(remote) : { x: this.mover.x, y: this.mover.y, z: this.mover.z + EYE_HEIGHT + (this.settings.bounce ? this.mover.bounce : 0), angle: this.mover.angle };
    const a = (eye.angle * 2 * Math.PI) / 4096;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); // client (cos a, sin a) -> scene (X, Z)
    // effect.c EffectShake: jiggle the view by up to a quarter square
    let jx = 0,
      jy = 0,
      jz = 0;
    if (world.effects.shake > 0) {
      const amp = Math.min(SHAKE_AMPLITUDE, world.effects.shake / 3) + 1;
      const jiggle = () => Math.floor(Math.random() * amp) - amp / 2;
      [jx, jy, jz] = [jiggle(), jiggle(), jiggle()];
    }
    this.camera.position.set((eye.x + jx) / FINENESS, (eye.z + jz) / FINENESS, (eye.y + jy) / FINENESS);
    this.camera.rotation.set(this.pitch, yaw, 0, "YXZ");

    this.animate(world.objects.values(), dt);
    const lighting = world.lighting;
    const ctx = {
      room,
      roomFlags: world.player?.roomFlags ?? 0,
      overrideDepths: this.mover.overrideDepths,
      ambient: lighting.ambient,
      viewerLight: remote && rv & REMOTE_VIEW.VALID_LIGHT ? remote.view.light : lighting.playerLight,
      viewer: { x: eye.x, y: eye.y },
      yaw,
      fog: this.fog,
      dt,
    };
    const drawn = [...world.objects.values(), ...this.projectileViews()];
    // Dynamic Lighting off: no light maps from torches and lamps, nor the targeting light
    this.lights = this.settings.dynamicLighting ? this.objects.lights(drawn, ctx) : [];
    const targeted = this.target !== null && this.target !== self.id ? world.objects.get(this.target) : undefined;
    if (targeted && this.settings.dynamicLighting && this.settings.targetLight && targeted.info.drawingType !== DRAWFX.INVISIBLE)
      this.lights.push(this.objects.targetLight(targeted, ctx));
    this.roomView.setLights(this.lights);
    this.roomView.setLighting({
      viewerLight: lighting.playerLight,
      ambient: lighting.ambient,
      sunAngle: lighting.sunAngle,
      shade: lighting.shadeIntensity,
      fog: this.fog,
    });
    this.roomView.update(now);
    const labels = this.objects.update(drawn, ctx, this.lights, self.id);
    this.sky?.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    // drawbsp.c doDrawBackground: no sun or moon when blind
    this.skyOverlays?.update(
      [...world.bgOverlays.values()].map((b) => ({
        id: b.info.id, bgf: this.bgf(b.info.iconRes), group: b.look.anim.group, angle: b.info.angle, height: b.info.height,
      })),
      this.camera,
      !world.effects.blind,
    );
    this.updateHover();
    this.objects.setTarget(this.target);
    this.updateWeather(dt, room);
    this.renderer.render(this.scene, this.camera);
    if (world.effects.blur > 0 || world.effects.waver > 0) (this.blur ??= new TrailBlur()).apply(this.renderer);
    this.drawLabels(labels);
    this.drawDamage();
    this.drawOverlays(room, lighting);
    this.countFrame(now);
  }

  /** d3drender.c PARTICLES: weather follows the viewer; nothing is drawn while blind */
  private updateWeather(dt: number, room: Room): void {
    const weather = this.weather;
    if (!weather) return;
    const fx = this.session.world.effects;
    weather.group.visible = !fx.blind;
    if (fx.blind) return;
    this.particleTime += dt;
    const steps = Math.min(10, Math.floor((this.particleTime * PARTICLE_STEPS_PER_SECOND) / 1000));
    this.particleTime = steps === 10 ? 0 : this.particleTime - (steps * 1000) / PARTICLE_STEPS_PER_SECOND;
    weather.setDensity(this.settings.particleDensity);
    weather.setFov(this.camera.fov);
    const at: ParticleRoom = {
      floor: (x, y) => {
        const leaf = leafAt(room, x, y);
        return leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
      },
      ceiling: (x, y) => {
        const leaf = leafAt(room, x, y);
        return leaf?.sector ? ceilingHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
      },
      roofed: (x, y) => {
        const leaf = leafAt(room, x, y);
        return !!leaf?.sector && room.sectors[leaf.sector - 1].ceilingType !== 0;
      },
    };
    const weatherOn = this.settings.weather;
    weather.update(
      { x: this.mover.x, y: this.mover.y, z: this.mover.z + EYE_HEIGHT },
      { sand: fx.sand, rain: fx.raining && weatherOn, snow: fx.snowing && weatherOn, fireworks: fx.fireworks },
      steps,
      at,
    );
  }

  /** ui/weather_snow.png from the asset build (d3dparticle.c), or null to draw snow as lines */
  private async snowTexture(): Promise<THREE.Texture | null> {
    if (!this.assets.has("ui/weather_snow.png")) return null;
    try {
      const bytes = await this.assets.fetchBytes("ui/weather_snow.png");
      const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      // The flakes are drawn white (SNOW_R/G/B 255), so keep only the alpha: the black of the
      // transparent texels would otherwise darken them as they shrink with distance (mipmaps)
      const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
      const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer), image.width, image.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    } catch {
      return null;
    }
  }

  /** Show FPS (config.showFPS): frames over the last half second. */
  private countFrame(now: number): void {
    if (!this.settings.showFps) return;
    this.fpsFrames++;
    if (now - this.fpsSince < 500) return;
    this.onFps?.(Math.round((this.fpsFrames * 1000) / (now - this.fpsSince)));
    this.fpsFrames = 0;
    this.fpsSince = now;
  }

  /** The Preferences that change how objects are drawn. */
  private applyViewSettings(): void {
    if (!this.objects) return;
    const s = this.settings;
    this.objects.haloColor = HALO_COLOR[s.haloColor];
    this.objects.names = { players: s.drawPlayerNames, npcs: s.drawNpcNames, signs: s.drawSignNames };
  }

  private mods(): Mods {
    return { alt: this.altDown, ctrl: this.ctrlDown };
  }

  /** The player's light for the hand overlays (D3DObjectLightingCalc on the player). */
  private drawOverlays(room: Room, lighting: { ambient: number; playerLight: number }): void {
    const world = this.session.world;
    const self = world.self;
    if (!this.overlays || !self) return;
    const leaf = leafAt(room, this.mover.x, this.mover.y);
    const sectorLight = leaf?.sector ? room.sectors[leaf.sector - 1].light : 0;
    const dt = self.info.drawingType;
    const light: [number, number, number] =
      dt === DRAWFX.BLACK
        ? [0, 0, 0]
        : objectBrightness({ x: this.mover.x, y: this.mover.y, z: this.mover.z }, sectorLight, lighting.playerLight, lighting.ambient, this.lights);
    const alpha = dt === DRAWFX.TRANSLUCENT25 ? 0.25 : dt === DRAWFX.TRANSLUCENT75 ? 0.75 : dt === DRAWFX.TRANSLUCENT50 || dt === DRAWFX.DITHERTRANS || dt === DRAWFX.DITHERINVIS || dt === DRAWFX.DITHERGREY ? 0.5 : dt === DRAWFX.INVISIBLE ? 0.2 : 1;
    // Show your pain (config.pain) off: no red flash when hurt
    const effects = this.settings.pain ? world.effects : { ...world.effects, pain: 0 };
    this.overlays.draw(world.playerOverlays, effects, light, alpha);
  }

  /** BP_SET_VIEW's object, when it's in the room (game.c SetPlayerRemoteView falls back to our eyes) */
  private remoteView(): { obj: WorldObject; view: RemoteView } | null {
    const view = this.session.world.remoteView;
    const obj = view ? this.session.world.objects.get(view.id) : undefined;
    return view && obj ? { obj, view } : null;
  }

  /** Where the remote eyes are: the object's place and angle, at the height the flags ask for */
  private remoteEye({ obj, view }: { obj: WorldObject; view: RemoteView }): { x: number; y: number; z: number; angle: number } {
    const ext = this.objects?.extentOf(obj.id) ?? null;
    const base = ext?.z ?? 0;
    const height = ext?.height ?? 0;
    const room = this.room;
    const leaf = room ? leafAt(room, obj.x, obj.y) : null;
    const floor = room && leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], obj.x, obj.y) : 0;
    const f = view.flags;
    const z =
      f & REMOTE_VIEW.VALID_HEIGHT ? floor + view.height
      : f & REMOTE_VIEW.TOP ? base + height
      : f & REMOTE_VIEW.BOTTOM ? base
      : f & REMOTE_VIEW.MID ? base + height / 2
      : EYE_HEIGHT; // player.viewHeight = player.height
    return { x: obj.x, y: obj.y, z, angle: obj.angle };
  }

  /** Projectiles as sprites for ObjectsView: fully lit, no name. */
  private projectileViews(): ViewObject[] {
    const room = this.room;
    // client3d.c GetPointFloor: the floor's height there, or -1 off the map
    const floor = (x: number, y: number) => {
      const leaf = room ? leafAt(room, x, y) : null;
      return room && leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
    };
    return [...this.session.world.projectiles.values()].map((p) => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y), angle: p.angle, version: 0, fullBright: true,
      // project.c: from the source's height to the target's, or along the ground (PROJ_FLAG_FOLLOWGROUND)
      z: p.flags & PROJ_FLAG_FOLLOWGROUND
        ? floor(p.x, p.y)
        : floor(p.sourceX, p.sourceY) + Math.min(1, p.progress) * (floor(p.destX, p.destY) - floor(p.sourceX, p.sourceY)),
      info: { iconRes: p.info.iconRes, nameRes: 0, flags: 0, drawingType: 0, nameColor: 0, light: p.info.light },
      look: p.look,
    }));
  }

  // ---- targeting and combat (gameuser.c) ----

  setTarget(id: number | null): void {
    if (id === this.target) return;
    this.target = id;
    this.objects?.setTarget(id);
    this.onTarget?.(id);
  }

  /** Objects on screen with a flag, nearest first (client3d.c GetObjects3D over the drawn objects). */
  private visibleObjects(flag: number, maxDistance = 0): WorldObject[] {
    const world = this.session.world;
    const self = world.self;
    if (!self || world.effects.blind) return [];
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    // "on screen": any part of a body-sized sphere around the object is in view
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.6);
    const out: { o: WorldObject; d: number }[] = [];
    for (const o of world.objects.values()) {
      if (o.id === self.id || (flag && !(o.info.flags & flag)) || o.info.drawingType === DRAWFX.INVISIBLE) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (maxDistance > 0 && d > maxDistance) continue;
      sphere.center.set(o.x / FINENESS, (this.mover.z + EYE_HEIGHT / 2) / FINENESS, o.y / FINENESS);
      if (!frustum.intersectsSphere(sphere)) continue;
      out.push({ o, d });
    }
    return out.sort((a, b) => a.d - b.d).map((e) => e.o);
  }

  private isVisible(id: number): boolean {
    return this.visibleObjects(0).some((o) => o.id === id);
  }

  /** gameuser.c UserTargetNextOrPrevious: cycle through attackable objects on screen. */
  private cycleTarget(next: boolean): void {
    const list = this.visibleObjects(OF_ATTACKABLE);
    if (!list.length) return this.setTarget(null);
    const i = this.target === null ? -1 : list.findIndex((o) => o.id === this.target);
    if (next) this.setTarget(list[i < 0 || i + 1 === list.length ? 0 : i + 1].id);
    else this.setTarget(list[i <= 0 ? list.length - 1 : i - 1].id);
  }

  /** gameuser.c UserAttackClosest: the target if we can see it, else the closest attackable thing. */
  attack(): void {
    // intrface.c A_ATTACK: not while seeing through another object's eyes; mermain.c: nor resting
    if (this.remoteView() || this.resting || this.session.world.effects.paralyzed) return;
    const now = performance.now();
    if (now - this.lastAttack < ATTACK_DELAY) return;
    this.lastAttack = now;
    this.mover.flush(now); // MoveUpdatePosition: attack from where we really stand
    if (this.target !== null && this.target !== this.session.world.player?.id) {
      if (this.isVisible(this.target)) this.session.attack(this.target);
      else this.onMessage?.("You can't see your selected target.");
      return;
    }
    const closest = this.visibleObjects(OF_ATTACKABLE, CLOSE_DISTANCE)[0];
    if (closest) this.session.attack(closest.id);
  }

  /**
   * spells.c SpellCast: a spell that needs a target goes to the selected one (if it can be
   * seen), else the user picks one (GAME_SELECT).
   */
  castSpell(spell: number, numTargets: number): void {
    if (numTargets === 0) return this.session.cast(spell, []);
    const self = this.session.world.player?.id;
    if (this.target !== null) {
      if (this.target === self || this.isVisible(this.target)) this.session.cast(spell, [{ id: this.target, amount: 1 }]);
      else this.onMessage?.("You can't see your selected target.");
      return;
    }
    this.beginSelect((id) => this.session.cast(spell, [{ id, amount: 1 }]));
  }

  /** Enter target selection (GAME_SELECT): the next object clicked is passed to `cb`. */
  beginSelect(cb: (id: number) => void): void {
    if (this.locked) document.exitPointerLock();
    this.selectCallback = cb;
    this.setCursor("target");
    this.onSelecting?.(true);
  }

  get selecting(): boolean {
    return this.selectCallback !== null;
  }

  /** Finish selection with an object (the view, our portrait or an inventory item); null cancels. */
  select(id: number | null): void {
    const cb = this.selectCallback;
    this.selectCallback = null;
    this.setCursor("");
    this.onSelecting?.(false);
    if (cb && id !== null) cb(id);
  }

  /** Step bitmap-group animations (animate.c) for the look each object shows now. */
  private animate(objects: Iterable<WorldObject>, dt: number): void {
    for (const o of objects) {
      // a group change shows up in ObjectsView's sprite key, which re-composites
      animStep(o.look.anim, this.bgf(o.info.iconRes)?.groups.length ?? 0, dt);
      for (const ov of o.look.overlays) animStep(ov.anim, this.bgf(ov.iconRes)?.groups.length ?? 0, dt);
    }
    for (const p of this.session.world.projectiles.values()) animStep(p.look.anim, this.bgf(p.info.iconRes)?.groups.length ?? 0, dt);
    // animate.c AnimationTimerProc: the background overlays animate too
    for (const b of this.session.world.bgOverlays.values()) animStep(b.look.anim, this.bgf(b.info.iconRes)?.groups.length ?? 0, dt);
    // the hands: a weapon swing is an animation on the player overlay
    for (const p of this.session.world.playerOverlays) {
      if (!p) continue;
      animStep(p.look.anim, this.bgf(p.info.iconRes)?.groups.length ?? 0, dt);
      for (const ov of p.look.overlays) animStep(ov.anim, this.bgf(ov.iconRes)?.groups.length ?? 0, dt);
    }
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** The object under the crosshair (mouse captured) or the mouse cursor. */
  private updateHover(): void {
    if (!this.objects) return;
    let ndc: THREE.Vector2 | null = null;
    if (this.locked) ndc = new THREE.Vector2(0, 0);
    else if (this.mouse) {
      const r = this.canvas.getBoundingClientRect();
      ndc = new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
    }
    let id: number | null = null;
    if (ndc) {
      this.raycaster.setFromCamera(ndc, this.camera);
      this.raycaster.far = 40;
      id = this.objects.pick(this.raycaster);
    }
    // cursor.c GameWindowSetCursor: a cross over an object (with Shift over a container, the
    // "inside" one), the target cursor while choosing; nothing more (the halo is the target's alone)
    if (id !== this.hovered || this.shift !== this.hoverShift) {
      this.hovered = id;
      this.hoverShift = this.shift;
      if (this.drag === null) this.setCursor(this.selecting ? "target" : id !== null && !this.locked ? this.objectCursor(id) : "");
    }
  }

  /** Shift held at the last mouse move (cursor.c: GetKeyState(VK_SHIFT) for the inside cursor) */
  private shift = false;
  private hoverShift = false;

  private objectCursor(id: number): "cross" | "inside" {
    const o = this.session.world.objects.get(id);
    return this.shift && o && o.info.flags & OF_CONTAINER ? "inside" : "cross";
  }

  /** The view's cursor (CSS: .viewport[data-cursor], the original's cursors from the asset build) */
  private setCursor(kind: "" | "target" | "cross" | "inside" | "get"): void {
    if (kind) this.canvas.dataset.cursor = kind;
    else delete this.canvas.dataset.cursor;
  }

  private drawLabels(labels: NameLabel[]): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    let n = 0;
    const eye = this.camera.position;
    const dir = new THREE.Vector3();
    for (const l of labels) {
      v.copy(l.position).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      // D3DRenderNamesDraw3D draws names in the scene with the depth test on, so walls hide
      // them: skip a label when the room is drawn between the eye and it.
      if (this.roomView) {
        dir.subVectors(l.position, eye);
        const dist = dir.length();
        this.labelRay.set(eye, dir.divideScalar(dist));
        this.labelRay.far = dist - LABEL_OCCLUSION_SLACK;
        if (this.labelRay.far > 0 && this.roomView.occludes(this.labelRay)) continue;
      }
      const el = this.labelPool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      this.labelPool[n++] = el;
      el.className = `name-label${l.id === this.hovered ? " hovered" : ""}${l.id === this.target ? " target" : ""}`;
      el.textContent = l.name;
      el.style.color = l.color;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -110%)`;
      el.style.display = "";
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
  }

  /**
   * A hit of ours (combatHit.ts): its damage floats up over what we hit. The message names it
   * rather than giving its id, so it's the target when the name matches (attacks and spells go
   * there), else the nearest object with that name.
   */
  showDamage(hit: DamageDealt): void {
    if (!this.settings.damageNumbers) return;
    const world = this.session.world;
    const self = world.self;
    const name = hit.name.toLowerCase();
    const named = (o: WorldObject) => o.id !== self?.id && (this.session.resource(o.info.nameRes) ?? "").toLowerCase() === name;
    let hurt = this.target !== null ? world.objects.get(this.target) : undefined;
    if (!hurt || !named(hurt)) {
      hurt = undefined;
      let best = Infinity;
      for (const o of world.objects.values()) {
        const d = self ? Math.hypot(o.x - self.x, o.y - self.y) : 0;
        if (d >= best || !named(o)) continue;
        hurt = o;
        best = d;
      }
    }
    if (!hurt) return;
    const el = this.labelsEl.appendChild(document.createElement("div"));
    el.className = "damage-number";
    el.textContent = String(hit.damage);
    el.style.display = "none";
    this.damageFloats.push({ id: hurt.id, born: performance.now(), pos: this.objects?.topOf(hurt.id) ?? null, dx: (Math.random() - 0.5) * 24, el });
  }

  private drawDamage(): void {
    if (!this.damageFloats.length) return;
    const now = performance.now();
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    this.damageFloats = this.damageFloats.filter((f) => {
      const t = (now - f.born) / DAMAGE_LIFE_MS;
      if (t >= 1) {
        f.el.remove();
        return false;
      }
      f.pos = this.objects?.topOf(f.id) ?? f.pos;
      if (!f.pos) return true;
      v.copy(f.pos).project(this.camera);
      if (v.z > 1 || v.z < -1) {
        f.el.style.display = "none";
        return true;
      }
      f.el.style.display = "";
      f.el.style.opacity = String(t < DAMAGE_FADE ? 1 : (1 - t) / (1 - DAMAGE_FADE));
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w + f.dx}px, ${((1 - v.y) / 2) * h - DAMAGE_RISE_PX * t}px) translate(-50%, -130%)`;
      return true;
    });
  }

  private clearDamage(): void {
    for (const f of this.damageFloats) f.el.remove();
    this.damageFloats = [];
  }

  /** The room being shown (for the minimap). */
  get currentRoom(): Room | null {
    return this.room;
  }

  private status(loading: boolean): void {
    const w = this.session.world;
    this.onStatus?.({
      roomName: w.player ? (this.session.resource(w.player.roomNameRes) ?? "") : "",
      objects: w.objects.size,
      lights: this.lights.length,
      loading,
    });
  }

  /** How far a room object is from us, in fine units (room_contents_node distance). */
  private distanceTo(id: number): number {
    const o = this.session.world.objects.get(id);
    const self = this.session.world.self;
    return o && self ? Math.hypot(o.x - self.x, o.y - self.y) : Infinity;
  }

  /** gameuser.c UserPickup: the gettable things in view close by; several are offered in a list. */
  pickUpNearby(): void {
    const ids = this.visibleObjects(OF_GETTABLE, CLOSE_DISTANCE).map((o) => o.id);
    if (ids.length) this.onPickup?.(ids);
  }

  /** gameuser.c UserLook (the Look key, typed "look"): everything in view that can be examined. */
  lookInView(): void {
    const ids = this.visibleObjects(0)
      .filter((o) => !(o.info.flags & OF_NOEXAMINE))
      .map((o) => o.id);
    this.choose("Look", ids, (id) => this.onLook?.(id), this.target ?? undefined);
  }

  /**
   * inventry.c InventoryLButtonUp: a container close by at a screen point (an item dropped
   * on it goes in it), or null.
   */
  containerAt(clientX: number, clientY: number): number | null {
    const saved = this.mouse;
    this.mouse = { x: clientX, y: clientY };
    const ids = this.objectsUnderCursor((o) => (o.info.flags & OF_CONTAINER) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE);
    this.mouse = saved;
    return ids[0] ?? null;
  }

  /**
   * client3d.c GetObjects3D at the mouse: the objects drawn under the cursor (the crosshair while
   * the mouse is captured), not hidden by a wall, that pass `test`, nearest first.
   */
  private objectsUnderCursor(test: (o: WorldObject) => boolean = () => true): number[] {
    if (!this.objects || !this.cursorRay()) return [];
    const hits = this.objects.pickAll(this.raycaster);
    const out: WorldObject[] = [];
    for (const h of hits) {
      const o = this.session.world.objects.get(h.id);
      if (!o || !test(o)) continue;
      if (this.roomView) {
        this.raycaster.far = h.distance - LABEL_OCCLUSION_SLACK;
        const hidden = this.raycaster.far > 0 && this.roomView.occludes(this.raycaster);
        this.raycaster.far = 40;
        if (hidden) continue;
      }
      out.push(o);
    }
    return out.sort((a, b) => this.distanceTo(a.id) - this.distanceTo(b.id)).map((o) => o.id);
  }

  /** The sun or moon under the cursor, where the sky shows (no wall in front of it). */
  private skyUnderCursor(): number | null {
    if (!this.skyOverlays || !this.cursorRay()) return null;
    const id = this.skyOverlays.pick(this.raycaster);
    if (id === null) return null;
    if (this.roomView) {
      this.raycaster.far = 400;
      const hidden = this.roomView.occludes(this.raycaster);
      this.raycaster.far = 40;
      if (hidden) return null;
    }
    return id;
  }

  /** Aim this.raycaster from the eye through the cursor (the crosshair while captured); false if there's no cursor. */
  private cursorRay(): boolean {
    let ndc: THREE.Vector2 | null = null;
    if (this.locked) ndc = new THREE.Vector2(0, 0);
    else if (this.mouse) {
      const r = this.canvas.getBoundingClientRect();
      ndc = new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
    }
    if (!ndc || this.session.world.effects.blind) return false;
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = 40;
    return true;
  }

  /** lookdlg.c DisplayLookList with LD_SINGLEAUTO: one object goes straight through, several are asked about. */
  private choose(title: string, ids: number[], then: (id: number) => void, initial?: number): void {
    if (!ids.length) return;
    if (ids.length === 1) return then(ids[0]);
    if (this.locked) document.exitPointerLock();
    this.onChoose?.(title, ids, then, initial);
  }

  // ---- input ----

  private readonly onMouseDown = (e: MouseEvent) => {
    // What the click is on: the cursor where it was pressed
    if (!this.locked) this.mouse = { x: e.clientX, y: e.clientY };
    if (this.selecting) {
      if (e.button === 0 && this.hovered !== null) this.select(this.hovered);
      return;
    }
    // Mouse buttons are bound like keys (config.ini mousetarget=mouse0, examine=mouse1)
    const actions = actionsFor(this.settings.keys, mouseCode(e.button), { alt: e.altKey, ctrl: e.ctrlKey });
    for (const a of actions) this.trigger(a);
    if (e.button !== 0 || this.locked) return;
    // Select Target took it (a player or a monster under the cursor)
    if (actions.includes("selectTarget") && this.objectsUnderCursor((o) => (o.info.flags & OF_ATTACKABLE) !== 0).length) return;
    // graphics.c UserStartDrag: the left button on something gettable (or a container) close by
    // starts dragging it; letting go over the inventory picks it up or looks inside
    // (mermain.c A_ENDDRAG). Several there: which one to get
    const near = this.objectsUnderCursor((o) => (o.info.flags & (OF_GETTABLE | OF_CONTAINER)) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE);
    if (near.length === 1) {
      this.drag = near[0];
      // graphics.c UserStartDrag: IDC_GETCURSOR while dragging
      this.setCursor("get");
      window.addEventListener("mouseup", this.onDragEnd);
      return;
    }
    if (near.length > 1) return this.choose("Get", near, (id) => this.getOrOpen(id));
    // A left click on nothing (or nothing we can use) captures the mouse for mouselook
    this.lockPointer();
  };

  /** mermain.c A_ENDDRAG: a container that can't be picked up is looked inside instead. */
  private getOrOpen(id: number): void {
    const o = this.session.world.objects.get(id);
    if (!o) return;
    if (o.info.flags & OF_CONTAINER && !(o.info.flags & OF_GETTABLE)) this.onContents?.(id);
    else this.session.pickUp(id);
  }

  private readonly onDragEnd = (e: MouseEvent) => {
    window.removeEventListener("mouseup", this.onDragEnd);
    const id = this.drag;
    this.drag = null;
    this.setCursor(this.hovered !== null ? this.objectCursor(this.hovered) : "");
    if (id === null) return;
    // mermain.c A_ENDDRAG: only a drop on the inventory counts
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over?.closest(".inventory-panel")) this.getOrOpen(id);
  };

  /**
   * Select Target (gameuser.c UserAttack, config.ini mousetarget): only something attackable
   * under the cursor, a player or a monster; Attack On Target attacks it too.
   */
  private selectHovered(): void {
    const ids = this.objectsUnderCursor((o) => (o.info.flags & OF_ATTACKABLE) !== 0);
    this.choose("Attack", ids, (id) => {
      this.setTarget(id);
      if (this.settings.attackOnTarget) this.attack();
    });
  }

  /**
   * Capture the mouse for mouselook (gameuser.c UserMouselookToggle confines the cursor with
   * ClipCursor). A plain pointer lock: the raw-input kind ({ unadjustedMovement: true }) let the
   * cursor wander out of the window on Windows while looking around. Chromium refuses a re-lock
   * for about a second after Esc, which is harmless here.
   */
  private lockPointer(): void {
    this.canvas.requestPointerLock().catch(() => {});
  }

  /**
   * Double click (merintr.c EventMouseClick: A_ACTIVATEMOUSE, gameuser.c UserActivateMouse):
   * activate what's under the cursor, or look inside a container, if it's close by and not a player.
   */
  private readonly onDoubleClick = (e: MouseEvent) => {
    if (!this.locked) this.mouse = { x: e.clientX, y: e.clientY };
    const ids = this.objectsUnderCursor(
      (o) => (o.info.flags & (OF_ACTIVATABLE | OF_CONTAINER)) !== 0 && !(o.info.flags & OF_PLAYER) && this.distanceTo(o.id) <= CLOSE_DISTANCE,
    );
    this.choose("Activate", ids, (id) => {
      const o = this.session.world.objects.get(id);
      if (o && o.info.flags & OF_CONTAINER) this.onContents?.(id);
      else this.session.activate(id);
    });
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    // No browser menu: the right button is bound like a key (Examine), acted on at mousedown
    e.preventDefault();
    if (this.selecting) this.select(null);
  };

  private readonly onCanvasMouseMove = (e: MouseEvent) => {
    this.mouse = { x: e.clientX, y: e.clientY };
    this.shift = e.shiftKey;
  };

  private readonly onMouseLeave = () => {
    this.mouse = null;
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // config.ini mouselookxscale / mouselookyscale, 1..30; 15 is our usual speed
    const sx = this.settings.mouseXScale / 15,
      sy = this.settings.mouseYScale / 15;
    const remote = this.remoteView();
    const rv = remote?.view.flags ?? 0;
    if (!remote) this.mover.turnBy(e.movementX * MOUSE_TURN * sx);
    else if (rv & REMOTE_VIEW.TURN) {
      // move.c: turning through another's eyes turns them only with REMOTE_VIEW_CONTROL
      const before = this.mover.angle;
      this.mover.turnBy(e.movementX * MOUSE_TURN * sx);
      if (rv & REMOTE_VIEW.CONTROL) {
        remote.obj.angle = (remote.obj.angle + this.mover.angle - before + 4096) & 4095;
        this.mover.setAngle(before);
      }
    }
    const dy = e.movementY * 0.0025 * sy * (this.settings.invertMouse ? -1 : 1);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    this.ctrlDown = e.ctrlKey;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t?.closest?.(".dialog")) return;
    // A modal window (the options, a message box) is up: the game takes no keys, like the original's
    if (document.querySelector(".mk-modal")) return;
    // Copying selected text (the chat window's) is the browser's: Ctrl+C isn't C (Mouselook Toggle)
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyC" || e.code === "KeyX") && !window.getSelection()?.isCollapsed) return;
    const actions = actionsFor(this.settings.keys, e.code, { alt: e.altKey, ctrl: e.ctrlKey });
    // Alt alone would focus the browser menu; Alt+arrows would navigate back/forward.
    if (e.key === "Alt" || actions.length || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    for (const a of actions) {
      // held keys repeat: zooming, and attacking (rate-limited like the original)
      if (e.repeat && a !== "mapZoomIn" && a !== "mapZoomOut" && a !== "attack") continue;
      // merintr.c interface_key_table: Shift+Tab is Tab Backward
      this.trigger(a === "tabForward" && e.shiftKey ? "tabBackward" : a);
    }
    // alias.c: F1..F12 send their hotkey aliases (when no action uses the key)
    const fkey = /^F(\d{1,2})$/.exec(e.code);
    if (!actions.length && fkey && Number(fkey[1]) >= 1 && Number(fkey[1]) <= 12 && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      if (!e.repeat) this.onHotkey?.(Number(fkey[1]));
      return;
    }
    const printable = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!actions.length && this.settings.typeToChat && printable) {
      // The original's A_TEXTINSERT keys: typing a letter starts a chat line
      e.preventDefault();
      if (this.locked) document.exitPointerLock();
      this.onTypeChat?.(e.key);
      return;
    }
    this.keys.add(e.code);
  };

  /** One-shot actions; held ones (movement, looking up and down) are polled each frame. */
  private trigger(a: Action): void {
    switch (a) {
      case "go":
        if (this.resting) break; // mermain.c A_GO: not while resting
        this.mover.flush(performance.now()); // A_GO: MoveUpdatePosition first
        this.session.go();
        break;
      case "attack":
        this.attack();
        break;
      case "targetNext":
        this.cycleTarget(true);
        break;
      case "targetPrevious":
        this.cycleTarget(false);
        break;
      case "targetSelf":
        this.setTarget(this.session.world.player?.id ?? null);
        break;
      case "targetClear":
        if (this.selecting) this.select(null);
        // intrface.c A_TARGETCLEAR: through another's eyes, Esc brings us back (UserMoveEsc)
        else if (this.remoteView()) this.session.world.endRemoteView();
        else this.setTarget(null);
        break;
      case "interact":
        // A_PICKUP: UserPickup
        this.pickUpNearby();
        break;
      case "lookAt":
        // A_LOOK: UserLook, everything in view (the target chosen to start with)
        this.lookInView();
        break;
      case "lookStraight":
        this.pitch = 0;
        break;
      case "flip":
        this.mover.turnBy(2048); // A_FLIP
        break;
      case "chat":
        if (this.locked) document.exitPointerLock();
        this.onChatKey?.();
        break;
      case "examine": {
        // A_LOOKMOUSE (config.ini examine=mouse1): UserLookMouseSquare, what's under the cursor;
        // with nothing there, the sun or moon (client3d.c GetObjects3D's background overlays)
        const ids = this.objectsUnderCursor();
        if (!ids.length) {
          const sky = this.skyUnderCursor();
          if (sky !== null) this.onLook?.(sky);
          break;
        }
        if (this.locked) document.exitPointerLock();
        this.choose("Look", ids, (id) => this.onLook?.(id));
        break;
      }
      case "selectTarget":
        this.selectHovered();
        break;
      case "mouselookToggle":
        // intrface.c A_MOUSELOOK: UserMouselookToggle. Only with the mouse over the view (the
        // original's main window): not while it's on the chat, the interface or a dialog
        if (this.locked) document.exitPointerLock();
        else if (this.mouse) this.lockPointer();
        break;
      case "say":
      case "tell":
      case "yell":
      case "broadcast":
      case "emote":
        // Start a chat line with the command, ready for the rest
        if (this.locked) document.exitPointerLock();
        this.onChatPrefix?.(`${a} `);
        break;
      case "inventory":
      case "mapZoomIn":
      case "mapZoomOut":
      case "map":
      case "settings":
      case "configuration":
      case "actions":
      case "who":
      case "offer":
      case "buy":
      case "deposit":
      case "withdraw":
        // Panels and dialogs: free the mouse for them
        if (this.locked && a !== "mapZoomIn" && a !== "mapZoomOut" && a !== "inventory" && a !== "map") document.exitPointerLock();
        this.onAction?.(a);
        break;
      case "tabForward":
      case "tabBackward":
        // intrface.c MainTab: from the view to the interface or the chat line
        if (this.locked) document.exitPointerLock();
        this.onAction?.(a);
        break;
      default:
        break;
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    this.ctrlDown = e.ctrlKey;
    this.keys.delete(e.code);
    if (e.key === "Alt") e.preventDefault();
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.altDown = false;
    this.ctrlDown = false;
  };

  private resize(): void {
    const w = this.canvas.clientWidth || 1,
      h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const deg = Math.PI / 180;
    const origAspect = Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / Math.tan((ORIGINAL_FOV.vertical / 2) * deg);
    this.camera.fov =
      this.camera.aspect >= origAspect
        ? ORIGINAL_FOV.vertical
        : (2 * Math.atan(Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / this.camera.aspect)) / deg;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.offSettings();
    this.resizeObserver.disconnect();
    window.removeEventListener("mouseup", this.onDragEnd);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("mousemove", this.onCanvasMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    if (this.locked) document.exitPointerLock();
    this.objects?.dispose();
    this.skyOverlays?.dispose();
    this.overlays?.dispose();
    this.rooms?.dispose();
    this.ownView?.dispose();
    this.blur?.dispose();
    this.weather?.dispose();
    if (this.sky) disposeSkybox(this.sky);
    this.renderer.dispose();
    this.labelsEl.replaceChildren();
  }
}

export { OF };
