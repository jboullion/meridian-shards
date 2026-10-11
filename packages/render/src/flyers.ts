// Ours: birds in the sky and bats in caves, for life overhead. There's no art for either in the
// game, so their silhouettes are drawn here, four wing beats each, into a small texture. They're
// points like the weather's snow (particles.ts): facing the camera, sized by distance, hidden by
// walls and ceilings in front of them, and never picked. Nothing here is the server's.
//
// Birds fly in small flocks high across the sky, flapping and gliding. Bats flit about under a
// cave's ceiling close to the player, turning every moment; a few come out under the sky at night.
//
// Positions are client fine units (x east, y south, z up), as the weather's.

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import type { ParticleRoom } from "./particles.ts";

const FRAME = 64;
const FRAMES = 4;
/** Atlas rows */
const BIRD = 0,
  BAT = 1;
const MAX_FLYERS = 64;
/** Cave bats stay over floors this close to the player's (fine units) */
const SAME_LEVEL = 1.2 * 1024;

/** The flight's wing beat, as frames: up, level, down, level */
const BEAT = [0, 1, 2, 1];

interface Flyer {
  kind: number;
  x: number;
  y: number;
  z: number;
  /** Which way it's flying (fine units a second; drawn heading that way) */
  vx: number;
  vy: number;
  /** Wingspan, fine units */
  size: number;
  /** Beat phase (0..1) and beats a second; gliding holds the wings level */
  phase: number;
  rate: number;
  glide: number;
}

interface Flock {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  birds: { flyer: Flyer; ox: number; oy: number; oz: number; bob: number }[];
}

interface Bat {
  flyer: Flyer;
  vx: number;
  vy: number;
  /** ms to the next turn */
  turn: number;
  /** Height over the floor (caves: about head height, kept under the ceiling) */
  below: number;
}

export interface FlyerOptions {
  /** Flocks of birds overhead (0 for none) */
  flocks: number;
  /** Bats about the player (0 for none) */
  bats: number;
  /** Bats under a cave's ceiling, or out under the sky */
  cave: boolean;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// ---- the silhouettes ----

/**
 * A shape at a point: 0 outside, else how light it is there (bats' wings are lighter than their
 * bodies, so they read against dark rock)
 */
type Shape = (x: number, y: number) => number;

/** How much of a pixel (4 x 4 samples) a shape covers, and how light it is there on average */
function coverage(shape: Shape, px: number, py: number): { a: number; tone: number } {
  let n = 0,
    tone = 0;
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const t = shape(px + (sx + 0.5) / 4, py + (sy + 0.5) / 4);
      if (t) {
        n++;
        tone += t;
      }
    }
  return { a: n / 16, tone: n ? tone / n : 0 };
}

function inPolygon(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearSegment(ax: number, ay: number, bx: number, by: number, x: number, y: number, r: number): boolean {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y) <= r;
}

/** A bird from below: a small body and two long wings bent at the wrist, tips raised by `lift` px */
function birdShape(lift: number): Shape {
  const c = FRAME / 2,
    y0 = 34;
  const inside = (x: number, y: number): boolean => {
    const dx = Math.abs(x - c);
    if (((x - c) / 3.2) ** 2 + ((y - y0) / 7) ** 2 <= 1) return true; // body
    if (Math.hypot(x - c, y - (y0 - 7)) <= 2.4) return true; // head
    if (nearSegment(c - 2.5, y0 + 6, c, y0 + 10, x, y, 1.6) || nearSegment(c + 2.5, y0 + 6, c, y0 + 10, x, y, 1.6)) return true; // tail
    // Each wing: shoulder to wrist (thick), wrist to tip (thinning)
    const wx = 13,
      wy = y0 - 1 - lift * 0.55;
    const tx = 29,
      ty = y0 - lift;
    const dyy = y;
    if (nearSegment(3, y0 - 1, wx, wy, dx, dyy, 2.6)) return true;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const r = 2.4 - 1.6 * t;
      if (Math.hypot(dx - (wx + (tx - wx) * t), dyy - (wy + (ty - wy) * t)) <= r) return true;
    }
    return false;
  };
  return (x, y) => (inside(x, y) ? 1 : 0);
}

/** A bat: a round body with ears, and webbed wings with a scalloped trailing edge, tips raised by `lift` px */
function batShape(lift: number): Shape {
  const c = FRAME / 2,
    y0 = 32;
  const BODY = 0.35,
    WING = 1;
  return (x, y) => {
    const dx = Math.abs(x - c);
    if (((x - c) / 4) ** 2 + ((y - y0) / 6) ** 2 <= 1) return BODY;
    if (inPolygon([[c - 4, y0 - 4], [c - 3, y0 - 11], [c - 1, y0 - 5]], x, y) || inPolygon([[c + 4, y0 - 4], [c + 3, y0 - 11], [c + 1, y0 - 5]], x, y)) return BODY; // ears
    // The arm and the fingers are dark ridges across the wing
    const wrist: [number, number] = [15, y0 - 7 - lift * 0.7];
    const tipY = y0 - 4 - lift;
    const wing: [number, number][] = [[3, y0 - 4], wrist, [30, tipY], [28, tipY + 8], [21, y0 + 8 - lift * 0.4], [12, y0 + 11 - lift * 0.2], [3, y0 + 8]];
    if (!inPolygon(wing, dx, y)) return 0;
    // Bites out of the trailing edge between the fingers
    for (const [sx, sy] of [[25, tipY + 11], [17, y0 + 12 - lift * 0.3], [8, y0 + 13 - lift * 0.1]] as [number, number][])
      if (Math.hypot(dx - sx, y - sy) < 4.6) return 0;
    if (nearSegment(3, y0 - 4, wrist[0], wrist[1], dx, y, 1.3) || nearSegment(wrist[0], wrist[1], 30, tipY, dx, y, 1) || nearSegment(wrist[0], wrist[1], 21, y0 + 8 - lift * 0.4, dx, y, 0.8))
      return BODY;
    return WING;
  };
}

/** The atlas: four wing beats a row, birds then bats; grey by the shape's tone, with its alpha (tinted in the shader) */
function atlas(): THREE.DataTexture {
  const w = FRAME * FRAMES,
    h = FRAME * 2;
  const px = new Uint8Array(w * h * 4);
  const rows = [
    [12, 2, -9, 2].map(birdShape),
    [14, 2, -12, 2].map(batShape),
  ];
  rows.forEach((frames, row) =>
    frames.forEach((shape, f) => {
      for (let y = 0; y < FRAME; y++)
        for (let x = 0; x < FRAME; x++) {
          const { a, tone } = coverage(shape, x, y);
          if (!a) continue;
          const i = ((row * FRAME + y) * w + f * FRAME + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = Math.round(tone * 255);
          px[i + 3] = Math.round(a * 255);
        }
    }),
  );
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const vertex = /* glsl */ `
in float aFrame;
in float aKind;
in float aSize;
in vec3 aDir;
out float vFrame;
out float vKind;
out vec2 vTurn;
uniform float uScale;
uniform float uAspect;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vFrame = aFrame;
  vKind = aKind;
  // Which way it heads on screen (pixels, y up), from a step along its flight; none: as drawn
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position + aDir, 1.0);
  vec2 d = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * vec2(uAspect, 1.0);
  vTurn = length(d) > 1e-5 && length(aDir) > 0.0 ? normalize(d) : vec2(0.0, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
in float vFrame;
in float vKind;
in vec2 vTurn;
out vec4 fragColor;
uniform sampler2D uAtlas;
uniform vec3 uBird;
uniform vec3 uBat;
void main() {
  // Turn the picture (head up) to face its heading: the point's y runs down, the screen's up
  vec2 p = gl_PointCoord - 0.5;
  vec2 q = vec2(p.x * vTurn.y + p.y * vTurn.x, p.y * vTurn.y - p.x * vTurn.x) + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;
  // The atlas's rows run down each picture, as the point's y does (the data's first row is v = 0)
  vec2 uv = vec2((vFrame + q.x) / ${FRAMES}.0, (vKind + q.y) / 2.0);
  vec4 t = texture(uAtlas, uv);
  if (t.a < 0.08) discard;
  fragColor = vec4((vKind < 0.5 ? uBird : uBat) * t.rgb, t.a);
}
`;

export class Flyers {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly position = new Float32Array(MAX_FLYERS * 3);
  private readonly frame = new Float32Array(MAX_FLYERS);
  private readonly kind = new Float32Array(MAX_FLYERS);
  private readonly size = new Float32Array(MAX_FLYERS);
  private readonly dir = new Float32Array(MAX_FLYERS * 3);
  private flocks: Flock[] = [];
  private bats: Bat[] = [];
  /** The player's floor this frame: cave bats keep to floors about that level */
  private viewerFloor = 0;

  constructor() {
    this.group.name = "flyers";
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.position, 3));
    g.setAttribute("aFrame", new THREE.BufferAttribute(this.frame, 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(this.kind, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aDir", new THREE.BufferAttribute(this.dir, 3));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uAtlas: { value: atlas() },
        uScale: { value: 1 },
        uAspect: { value: 1 },
        uBird: { value: new THREE.Vector3(0.1, 0.1, 0.12) },
        uBat: { value: new THREE.Vector3(0.29, 0.23, 0.19) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {}; // never picked
    this.group.add(this.points);
  }

  /**
   * The camera's projection, for sizing: half the drawing buffer's height over tan(fov / 2)
   * (three.js sizes points the same way)
   */
  setProjection(bufferHeight: number, fovYDegrees: number, aspect = 1): void {
    this.points.material.uniforms.uScale.value = bufferHeight / 2 / Math.tan((fovYDegrees * Math.PI) / 360);
    this.points.material.uniforms.uAspect.value = aspect;
  }

  /** How light it is where the player is (0..1): bats' wings catch a little of it */
  setLight(light: number): void {
    const k = 0.6 + 0.4 * Math.max(0, Math.min(1, light));
    (this.points.material.uniforms.uBat.value as THREE.Vector3).set(0.29 * k, 0.23 * k, 0.19 * k);
  }

  /** Everyone goes (a new room) */
  clear(): void {
    this.flocks = [];
    this.bats = [];
    this.points.geometry.setDrawRange(0, 0);
  }

  /**
   * One frame: flocks come and go about the viewer, bats flit. `viewer` is where the player
   * stands (z: their floor); `facing` their angle (client units), so newcomers turn up behind.
   */
  update(dt: number, viewer: { x: number; y: number; z: number }, facing: number, room: ParticleRoom, opts: FlyerOptions): void {
    dt = Math.min(dt, 100);
    this.viewerFloor = viewer.z;
    this.updateFlocks(dt, viewer, opts.flocks);
    this.updateBats(dt, viewer, facing, room, opts);
    this.write();
  }

  private updateFlocks(dt: number, v: { x: number; y: number; z: number }, wanted: number): void {
    const s = dt / 1000;
    for (const f of this.flocks) {
      f.x += f.vx * s;
      f.y += f.vy * s;
      for (const b of f.birds) {
        b.bob += s;
        const fl = b.flyer;
        fl.x = f.x + b.ox;
        fl.y = f.y + b.oy;
        fl.vx = f.vx;
        fl.vy = f.vy;
        fl.z = f.z + b.oz + Math.sin(b.bob * 1.3) * 60;
        this.beat(fl, s, 0.25);
      }
    }
    // Gone once well past us, heading away
    this.flocks = this.flocks.filter((f) => {
      const dx = f.x - v.x,
        dy = f.y - v.y;
      return Math.hypot(dx, dy) < 34 * FINENESS || dx * f.vx + dy * f.vy < 0;
    });
    if (this.flocks.length < wanted && Math.random() < s * 0.25) this.flocks.push(this.newFlock(v));
    if (this.flocks.length > wanted) this.flocks.length = wanted;
  }

  /** A flock from far off, crossing near overhead */
  private newFlock(v: { x: number; y: number; z: number }): Flock {
    const from = Math.random() * 2 * Math.PI;
    const x = v.x + Math.cos(from) * 30 * FINENESS,
      y = v.y + Math.sin(from) * 30 * FINENESS;
    // Toward somewhere within 10 squares of us
    const tx = v.x + rnd(-10, 10) * FINENESS,
      ty = v.y + rnd(-10, 10) * FINENESS;
    const speed = rnd(3, 5) * FINENESS;
    const d = Math.hypot(tx - x, ty - y) || 1;
    const n = Math.floor(rnd(2, 8));
    const flock: Flock = { x, y, z: v.z + rnd(9, 15) * FINENESS, vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed, birds: [] };
    for (let k = 0; k < n; k++) {
      flock.birds.push({
        flyer: { kind: BIRD, x, y, z: flock.z, vx: flock.vx, vy: flock.vy, size: rnd(450, 650), phase: Math.random(), rate: rnd(3, 4.5), glide: Math.random() * 2000 },
        ox: rnd(-2, 2) * FINENESS,
        oy: rnd(-2, 2) * FINENESS,
        oz: rnd(-1, 1) * FINENESS,
        bob: Math.random() * 10,
      });
    }
    return flock;
  }

  /** Beat the wings, or hold them level a while (a bird gliding now and then) */
  private beat(fl: Flyer, s: number, glideChance: number): void {
    if (fl.glide > 0) {
      fl.glide -= s * 1000;
      return;
    }
    const before = fl.phase;
    fl.phase = (fl.phase + fl.rate * s) % 1;
    // A beat done: sometimes glide
    if (fl.phase < before && Math.random() < glideChance) fl.glide = rnd(800, 2500);
  }

  private updateBats(dt: number, v: { x: number; y: number; z: number }, facing: number, room: ParticleRoom, opts: FlyerOptions): void {
    const s = dt / 1000;
    for (const b of this.bats) {
      const fl = b.flyer;
      if ((b.turn -= dt) <= 0) {
        // A sudden new heading, mostly back toward us when they stray
        b.turn = rnd(150, 600);
        const home = Math.atan2(v.y - fl.y, v.x - fl.x);
        const far = Math.hypot(fl.x - v.x, fl.y - v.y) > 7 * FINENESS;
        const a = far ? home + rnd(-0.8, 0.8) : Math.random() * 2 * Math.PI;
        const speed = rnd(2.5, 5) * FINENESS;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      }
      const nx = fl.x + b.vx * s,
        ny = fl.y + b.vy * s;
      const z = this.batHeight(nx, ny, b, room, opts.cave);
      if (z === null) {
        // A wall or the room's edge: turn back
        b.vx = -b.vx;
        b.vy = -b.vy;
        b.turn = rnd(150, 400);
      } else {
        fl.x = nx;
        fl.y = ny;
        fl.z += (z - fl.z) * Math.min(1, s * 4);
      }
      fl.vx = b.vx;
      fl.vy = b.vy;
      this.beat(fl, s, 0);
    }
    this.bats = this.bats.filter((b) => Math.hypot(b.flyer.x - v.x, b.flyer.y - v.y) < 16 * FINENESS);
    if (this.bats.length < opts.bats && Math.random() < s * 2) {
      const bat = this.newBat(v, facing, room, opts.cave);
      if (bat) this.bats.push(bat);
    }
    if (this.bats.length > opts.bats) this.bats.length = opts.bats;
  }

  /**
   * Where a bat flies at a point: about the player's head in a cave, a little more under a high
   * ceiling, never into it (cramped crypts too); over the floor outdoors; null if it can't be there
   */
  private batHeight(x: number, y: number, b: Bat, room: ParticleRoom, cave: boolean): number | null {
    const floor = room.floor(x, y);
    if (floor < 0) return null;
    if (!cave) return room.roofed(x, y) ? null : floor + b.below;
    // Not over the tops of a maze's walls, nor a ledge high above us
    if (Math.abs(floor - this.viewerFloor) > SAME_LEVEL) return null;
    const ceiling = room.ceiling(x, y);
    if (ceiling - floor < 0.9 * FINENESS) return null;
    return Math.min(floor + b.below, ceiling - 0.2 * FINENESS);
  }

  /** A bat about us, behind if it can be */
  private newBat(v: { x: number; y: number; z: number }, facing: number, room: ParticleRoom, cave: boolean): Bat | null {
    for (let k = 0; k < 12; k++) {
      const a = ((facing + 2048) * 2 * Math.PI) / 4096 + rnd(-1.2, 1.2);
      const r = rnd(3, 9) * FINENESS;
      const x = v.x + Math.cos(a) * r,
        y = v.y + Math.sin(a) * r;
      const bat: Bat = {
        flyer: { kind: BAT, x, y, z: 0, vx: 0, vy: 0, size: rnd(260, 380), phase: Math.random(), rate: rnd(9, 13), glide: 0 },
        vx: 0,
        vy: 0,
        turn: 0,
        // Above the floor: head height in caves (the eyes are at three quarters of a square)
        below: cave ? rnd(0.75, 1.3) * FINENESS : rnd(2, 4) * FINENESS,
      };
      const z = this.batHeight(x, y, bat, room, cave);
      if (z === null) continue;
      bat.flyer.z = z;
      return bat;
    }
    return null;
  }

  /** Fill the points: scene X = x, Y = z, Z = y, in squares */
  private write(): void {
    let n = 0;
    const put = (f: Flyer) => {
      if (n >= MAX_FLYERS) return;
      this.position[n * 3] = f.x / FINENESS;
      this.position[n * 3 + 1] = f.z / FINENESS;
      this.position[n * 3 + 2] = f.y / FINENESS;
      this.frame[n] = f.glide > 0 ? 1 : BEAT[Math.floor(f.phase * BEAT.length) % BEAT.length];
      this.kind[n] = f.kind;
      this.size[n] = f.size / FINENESS;
      // A second's flight, in the scene's axes. Birds turn to it (seen from below, overhead);
      // bats stay upright, ears up, as seen beside us
      const turn = f.kind === BIRD ? 1 : 0;
      this.dir[n * 3] = (f.vx / FINENESS) * turn;
      this.dir[n * 3 + 1] = 0;
      this.dir[n * 3 + 2] = (f.vy / FINENESS) * turn;
      n++;
    };
    for (const f of this.flocks) for (const b of f.birds) put(b.flyer);
    for (const b of this.bats) put(b.flyer);
    const g = this.points.geometry;
    for (const name of ["position", "aFrame", "aKind", "aSize", "aDir"]) g.getAttribute(name).needsUpdate = true;
    g.setDrawRange(0, n);
  }

  /** How many are about now (dev tools, tests) */
  get count(): { birds: number; bats: number } {
    return { birds: this.flocks.reduce((s, f) => s + f.birds.length, 0), bats: this.bats.length };
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material.uniforms.uAtlas.value as THREE.Texture).dispose();
    this.points.material.dispose();
  }
}
