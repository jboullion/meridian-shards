// The in-game 3D view: the player's room with its objects, seen from the player's eyes,
// with the original client's movement (move.c). Keys come from the settings (the modern
// or the original preset, rebindable; see settings.ts). Modern defaults:
//   click the view: capture the mouse (mouselook); Esc releases it
//   WASD / arrows: move and strafe (arrows left/right turn); Shift runs
//   Space or E: open a door / take the exit you stand on (BP_REQ_GO)
//   left click: look at the object under the cursor (crosshair when captured)
//   F or double click: pick up / activate;  right click: actions menu
//   PgUp/PgDn/Home: look up, down, straight; End: turn around;  Enter: chat

import * as THREE from "three";
import { FINENESS, skyboxForBackground, type Bgf, type Room } from "@shards/formats";
import {
  OF, ObjectsView, RoomView, XlatTable, disposeSkybox, paletteTexture, type LightSource, type NameLabel,
} from "@shards/render";
import { PlayerMover, animStep, type GameSession, type WorldObject } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { loadRoomView, loadSkybox } from "../render/roomLoader.ts";
import { ORIGINAL_FOV } from "../viewer/roomScene.ts";
import type { GameAudio } from "./audio.ts";
import { actionsFor, getSettings, isHeld, onSettings, type Action, type Settings } from "./settings.ts";

/** Eye height above the floor (clientd3d/game.c player.height = 3/4 square). */
const EYE_HEIGHT = 768;
/** Mouse sensitivity in client angle units per pixel (4096 per circle). */
const MOUSE_TURN = 2.5;
/** Keyboard look up/down speed, radians per second (A_LOOKUP / A_LOOKDOWN held). */
const PITCH_RATE = 1.2;
const MAX_PITCH = 1.2;
const OF_GETTABLE = 0x10;
const OF_ACTIVATABLE = 0x800;

export interface GameSceneStatus {
  roomName: string;
  objects: number;
  lights: number;
  loading: boolean;
}

export interface ObjectAction {
  id: number;
  name: string;
  canGet: boolean;
  canActivate: boolean;
  /** screen position for a menu */
  x: number;
  y: number;
}

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
  private room: Room | null = null;
  private roomView: RoomView | null = null;
  private roomRes = 0;
  private sky: THREE.Group | null = null;
  private skyName = "";
  private readonly bgfs = new Map<number, Bgf | null | undefined>();
  private lights: LightSource[] = [];
  private pitch = 0;
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private hovered: number | null = null;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver;
  private labelPool: HTMLDivElement[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private settings: Settings = getSettings();
  private altDown = false;
  readonly audio: GameAudio;
  private readonly offSettings: () => void;
  fog = true;
  onStatus?: (s: GameSceneStatus) => void;
  /** Enter pressed: focus the chat input */
  onChatKey?: () => void;
  /** Right click on an object: show an actions menu */
  onObjectMenu?: (a: ObjectAction) => void;
  /** A key bound to a panel action (inventory, settings, map zoom) */
  onAction?: (a: Action) => void;
  /** Type-to-chat: a printable key starts a chat line with this text */
  onTypeChat?: (text: string) => void;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, session: GameSession, assets: AssetStore, audio: GameAudio) {
    this.canvas = canvas;
    this.labelsEl = labels;
    this.session = session;
    this.assets = assets;
    this.audio = audio;
    this.audio.objectPosition = (id) => session.world.objects.get(id);
    this.offSettings = onSettings((s) => (this.settings = s));
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
          // BP_PLAYER carries the room's background too (teleports change both)
          void this.syncRoom().then(() => this.syncSky());
          break;
        case "background":
          void this.syncSky();
          break;
        case "roomContents":
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
    this.xlats = new XlatTable(pal.rgb, lightPal);
    this.objects = new ObjectsView(this.palette, this.xlats, (id) => this.bgf(id), (id) => this.session.resource(id));
    this.scene.add(this.objects.group);
    await this.syncRoom();
    await this.syncSky();
    const loop = (t: number) => {
      this.frame(Math.min(250, t - this.last), t);
      this.last = t;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The .bgf for an icon resource: loads on first use, undefined while loading. */
  private bgf(resource: number): Bgf | null | undefined {
    if (this.bgfs.has(resource)) return this.bgfs.get(resource);
    this.bgfs.set(resource, undefined);
    const name = this.session.resource(resource);
    if (!name) {
      this.bgfs.set(resource, null);
      return null;
    }
    this.assets
      .bgf(name)
      .then((b) => this.bgfs.set(resource, b))
      .catch(() => this.bgfs.set(resource, null));
    return undefined;
  }

  private async syncRoom(): Promise<void> {
    const p = this.session.world.player;
    if (!p || !this.palette || p.roomRes === this.roomRes) return;
    this.roomRes = p.roomRes;
    const name = this.session.resource(p.roomRes);
    this.status(true);
    if (!name) return;
    const loaded = await loadRoomView(this.assets, name, this.palette);
    if (this.disposed || this.roomRes !== p.roomRes) {
      loaded.view.dispose();
      return;
    }
    if (this.roomView) {
      this.scene.remove(this.roomView.group);
      this.roomView.dispose();
    }
    this.room = loaded.room;
    this.roomView = loaded.view;
    this.scene.add(loaded.view.group);
    this.mover.room = loaded.room;
    const self = this.session.world.self;
    if (self) {
      this.mover.place(self.x, self.y, performance.now());
      this.mover.setAngle(self.angle);
    }
    this.status(false);
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
    if (!(room && this.roomView && this.objects && self && this.mover.room === room)) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // --- movement (move.c) ---
    const held = (a: Action) => (isHeld(this.settings.keys, a, this.keys, this.altDown) ? 1 : 0);
    const forward = held("forward") - held("backward");
    const strafe = held("strafeRight") - held("strafeLeft");
    const turn = held("turnRight") - held("turnLeft");
    const run = held("run") === 1;
    this.mover.turnKeys(turn, run, dt);
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

    // --- camera: our eyes ---
    const a = (this.mover.angle * 2 * Math.PI) / 4096;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); // client (cos a, sin a) -> scene (X, Z)
    this.camera.position.set(
      this.mover.x / FINENESS,
      (this.mover.z + EYE_HEIGHT + this.mover.bounce) / FINENESS,
      this.mover.y / FINENESS,
    );
    this.camera.rotation.set(this.pitch, yaw, 0, "YXZ");

    this.animate(world.objects.values(), dt);
    const lighting = world.lighting;
    const ctx = {
      room,
      roomFlags: world.player?.roomFlags ?? 0,
      overrideDepths: this.mover.overrideDepths,
      ambient: lighting.ambient,
      viewerLight: lighting.playerLight,
      viewer: { x: this.mover.x, y: this.mover.y },
      yaw,
      fog: this.fog,
    };
    this.lights = this.objects.lights(world.objects.values(), ctx);
    this.roomView.setLights(this.lights);
    this.roomView.setLighting({
      viewerLight: lighting.playerLight,
      ambient: lighting.ambient,
      sunAngle: lighting.sunAngle,
      shade: lighting.shadeIntensity,
      fog: this.fog,
    });
    this.roomView.update(now);
    const labels = this.objects.update(world.objects.values(), ctx, this.lights, self.id);
    this.sky?.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    this.updateHover();
    this.renderer.render(this.scene, this.camera);
    this.drawLabels(labels);
  }

  /** Step bitmap-group animations (animate.c) for the look each object shows now. */
  private animate(objects: Iterable<WorldObject>, dt: number): void {
    for (const o of objects) {
      // a group change shows up in ObjectsView's sprite key, which re-composites
      animStep(o.look.anim, this.bgf(o.info.iconRes)?.groups.length ?? 0, dt);
      for (const ov of o.look.overlays) animStep(ov.anim, this.bgf(ov.iconRes)?.groups.length ?? 0, dt);
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
    if (id !== this.hovered) {
      this.hovered = id;
      this.objects.setHighlight(id);
      this.canvas.style.cursor = id !== null && !this.locked ? "pointer" : "";
    }
  }

  private drawLabels(labels: NameLabel[]): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    let n = 0;
    for (const l of labels) {
      v.copy(l.position).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const el = this.labelPool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      this.labelPool[n++] = el;
      el.className = l.id === this.hovered ? "name-label hovered" : "name-label";
      el.textContent = l.name;
      el.style.color = l.color;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -110%)`;
      el.style.display = "";
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
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

  private actionFor(id: number, x: number, y: number): ObjectAction | null {
    const o = this.session.world.objects.get(id);
    if (!o) return null;
    return {
      id,
      name: this.session.resource(o.info.nameRes) ?? "",
      canGet: (o.info.flags & OF_GETTABLE) !== 0,
      canActivate: (o.info.flags & OF_ACTIVATABLE) !== 0,
      x,
      y,
    };
  }

  /** F key / menu default: pick up if gettable, else activate. */
  private interact(id: number): void {
    const o = this.session.world.objects.get(id);
    if (!o) return;
    if (o.info.flags & OF_GETTABLE) this.session.pickUp(id);
    else if (o.info.flags & OF_ACTIVATABLE) this.session.activate(id);
    else this.session.look(id);
  }

  // ---- input ----

  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      if (this.hovered !== null) this.session.look(this.hovered);
      else if (!this.locked) this.canvas.requestPointerLock();
    }
  };

  /** Double click: pick up or activate (merintr EventMouseClick: A_ACTIVATEMOUSE). */
  private readonly onDoubleClick = () => {
    if (this.hovered !== null) this.interact(this.hovered);
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.locked) document.exitPointerLock();
    if (this.hovered === null) return;
    const a = this.actionFor(this.hovered, e.clientX, e.clientY);
    if (a) this.onObjectMenu?.(a);
  };

  private readonly onCanvasMouseMove = (e: MouseEvent) => {
    this.mouse = { x: e.clientX, y: e.clientY };
  };

  private readonly onMouseLeave = () => {
    this.mouse = null;
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    const speed = this.settings.mouseSpeed;
    this.mover.turnBy(e.movementX * MOUSE_TURN * speed);
    const dy = e.movementY * 0.0025 * speed * (this.settings.invertMouse ? -1 : 1);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t?.closest?.(".dialog")) return;
    const actions = actionsFor(this.settings.keys, e.code, e.altKey);
    // Alt alone would focus the browser menu; Alt+arrows would navigate back/forward.
    if (e.key === "Alt" || actions.length || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    for (const a of actions) {
      if (e.repeat && a !== "mapZoomIn" && a !== "mapZoomOut") continue;
      this.trigger(a);
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
        this.session.go();
        break;
      case "interact":
        if (this.hovered !== null) this.interact(this.hovered);
        break;
      case "lookAt":
        if (this.hovered !== null) this.session.look(this.hovered);
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
      case "inventory":
      case "mapZoomIn":
      case "mapZoomOut":
      case "settings":
        if (a === "settings" && this.locked) document.exitPointerLock();
        this.onAction?.(a);
        break;
      default:
        break;
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    this.keys.delete(e.code);
    if (e.key === "Alt") e.preventDefault();
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.altDown = false;
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
    this.roomView?.dispose();
    if (this.sky) disposeSkybox(this.sky);
    this.renderer.dispose();
    this.labelsEl.replaceChildren();
  }
}

export { OF };
