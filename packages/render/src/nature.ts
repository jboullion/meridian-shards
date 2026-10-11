// Ours: small life about the player, purely to look at: butterflies over the grass by day,
// fireflies blinking in the woods at night, leaves drifting down from the trees, and fish leaping
// out of lakes and rivers with a splash. There's no art for any of them in the game, so the
// pictures are drawn here into a small texture. They're points like the weather's (particles.ts)
// and the birds' (flyers.ts): facing the camera, sized by distance, hidden by walls in front, never
// picked. Fireflies shine (they're drawn in the glow pass, postFx.ts); the rest take the light
// where the player stands.
//
// Positions are client fine units (x east, y south, z up).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import { glowPass } from "./lighting.ts";

const FRAME = 64;
const COLS = 4,
  ROWS = 4;
/** Atlas rows */
const ROW = { BUTTERFLY: 0, LEAF: 1, FISH: 2, DOT: 3 } as const;
const MAX_POINTS = 384;
/** How long a firefly glows in each blink, ms */
const FIREFLY_LIT_MS = 1300;

/** What the room is like where nature happens */
export interface NatureRoom {
  /** Floor height, or -1 outside every sector */
  floor(x: number, y: number): number;
  /** Whether a ceiling texture is overhead (indoors) */
  roofed(x: number, y: number): boolean;
  /** The water's surface (the floor as drawn) where there's water under open sky, else null */
  water(x: number, y: number): number | null;
}

export interface NatureOptions {
  /** How many of each about the player at once (0 for none) */
  butterflies: number;
  fireflies: number;
  /** Leaves falling at once */
  leaves: number;
  /** Fish jumping: on or off (they need water nearby) */
  fish: boolean;
}

interface Sprite {
  row: number;
  frame: number;
  x: number;
  y: number;
  z: number;
  size: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  flip: boolean;
  emissive: boolean;
}

interface Butterfly {
  s: Sprite;
  vx: number;
  vy: number;
  turn: number;
  base: number;
  phase: number;
  rate: number;
  bob: number;
}

interface Firefly {
  s: Sprite;
  vx: number;
  vy: number;
  vz: number;
  turn: number;
  /** Blinking: where it is in its cycle (ms) and how long the cycle is */
  t: number;
  period: number;
}

interface Leaf {
  s: Sprite;
  vz: number;
  sway: number;
  swayRate: number;
  spin: number;
  spinRate: number;
  /** ms lying on the ground, once down */
  lying: number;
  ground: number;
  dx: number;
  dy: number;
}

interface Fish {
  s: Sprite;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  surface: number;
  t: number;
  duration: number;
  height: number;
}

interface Drop {
  s: Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  surface: number;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

const BUTTERFLY_COLORS: [number, number, number][] = [[1, 0.85, 0.2], [1, 0.5, 0.12], [0.95, 0.95, 0.88], [0.35, 0.55, 1], [0.9, 0.25, 0.2], [0.75, 0.45, 0.9]];
const LEAF_COLORS: [number, number, number][] = [[0.35, 0.6, 0.18], [0.5, 0.65, 0.2], [0.85, 0.7, 0.2], [0.85, 0.42, 0.12], [0.55, 0.35, 0.18]];

// ---- the pictures ----

/** 0 outside, else how light the picture is there */
type Shape = (x: number, y: number) => number;

function drawCell(px: Uint8Array, width: number, row: number, col: number, shape: Shape): void {
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) {
      let n = 0,
        tone = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const t = shape(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
          if (t) {
            n++;
            tone += t;
          }
        }
      if (!n) continue;
      const i = ((row * FRAME + y) * width + col * FRAME + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = Math.round((tone / n) * 255);
      px[i + 3] = Math.round((n / 16) * 255);
    }
}

/** A butterfly seen from the front, its wings `open` wide (1) to edge-on (0) */
function butterfly(open: number): Shape {
  const c = FRAME / 2,
    y0 = 32;
  return (x, y) => {
    const dx = Math.abs(x - c),
      dy = y - y0;
    if (dx < 1.3 && dy > -9 && dy < 9) return 0.25; // body
    if (dy < -9 && dy > -14 && Math.abs(dx - (14 + dy) * 0.5) < 0.6) return 0.25; // antennae
    const w = Math.max(0.08, open);
    // Wings measured across as if open: the forewing up and out, the hindwing below
    const ux = dx / w;
    const fore = ((ux - 11) / 11) ** 2 + ((dy + 5) / 8.5) ** 2;
    const hind = ((ux - 8) / 8) ** 2 + ((dy - 6) / 6.5) ** 2;
    if (dx < 1.3 || (fore > 1 && hind > 1)) return 0;
    // A dark rim and a spot on each forewing
    const rim = Math.min(fore, hind) > 0.62;
    const spot = Math.hypot(ux - 14, dy + 6) < 2.6;
    return rim || spot ? 0.45 : 1;
  };
}

/** A leaf, turned edge-on by `turn` (1 full face, 0 edge) and tilted by `tilt` radians, with a vein */
function leaf(turn: number, tilt: number): Shape {
  const c = FRAME / 2;
  const ca = Math.cos(tilt),
    sa = Math.sin(tilt);
  return (x, y) => {
    const lx = (x - c) * ca + (y - c) * sa,
      ly = -(x - c) * sa + (y - c) * ca;
    const w = 7 * Math.max(0.12, turn);
    // Pointed at both ends: wider in the middle
    const half = 15;
    if (Math.abs(ly) > half) return Math.abs(lx) < 0.7 && ly > half && ly < half + 4 ? 0.5 : 0; // stalk
    const width = w * Math.cos((ly / half) * (Math.PI / 2)) ** 0.8;
    if (Math.abs(lx) > width) return 0;
    return Math.abs(lx) < 0.6 ? 0.55 : 1;
  };
}

/** A fish from the side, facing right, nose up by `pitch` radians */
function fish(pitch: number): Shape {
  const c = FRAME / 2;
  const ca = Math.cos(pitch),
    sa = Math.sin(pitch);
  return (x, y) => {
    const lx = (x - c) * ca - (y - c) * sa,
      ly = (x - c) * sa + (y - c) * ca;
    if ((lx / 14) ** 2 + (ly / 5) ** 2 <= 1) {
      if (Math.hypot(lx - 9, ly + 1) < 1.3) return 0.15; // eye
      return ly > 1.5 ? 0.85 : 0.6; // a lighter belly
    }
    // The tail: a fork behind
    if (lx < -11 && lx > -20 && Math.abs(ly) < (-11 - lx) * 0.75) return 0.55;
    // A fin on the back
    if (ly < -4 && ly > -8 && lx > -4 && lx < 4 && -ly - 4 < (4 - Math.abs(lx)) * 0.9) return 0.5;
    return 0;
  };
}

/** A soft round glow (fireflies, splashes) */
const dot: Shape = (x, y) => {
  const d = Math.hypot(x - FRAME / 2, y - FRAME / 2) / (FRAME / 2);
  return d < 1 ? Math.max(0.01, (1 - d) ** 1.5) : 0;
};

function atlas(): THREE.DataTexture {
  const w = FRAME * COLS,
    h = FRAME * ROWS;
  const px = new Uint8Array(w * h * 4);
  [1, 0.55, 0.12, 0.55].forEach((open, f) => drawCell(px, w, ROW.BUTTERFLY, f, butterfly(open)));
  [[1, 0.3], [0.55, 1.2], [0.15, 2], [0.55, 2.8]].forEach(([turn, tilt], f) => drawCell(px, w, ROW.LEAF, f, leaf(turn, tilt)));
  [0.6, 0, -0.6, 0].forEach((pitch, f) => drawCell(px, w, ROW.FISH, f, fish(pitch)));
  drawCell(px, w, ROW.DOT, 0, dot);
  // The dot's alpha is its glow: keep the colour full and fade by alpha
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) {
      const i = ((ROW.DOT * FRAME + y) * w + x) * 4;
      px[i + 3] = px[i];
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const vertex = /* glsl */ `
in float aFrame;
in float aRow;
in float aSize;
in vec3 aColor;
in float aAlpha;
in float aFlip;
in float aEmissive;
out float vFrame;
out float vRow;
out vec3 vColor;
out float vAlpha;
out float vFlip;
out float vEmissive;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vFrame = aFrame;
  vRow = aRow;
  vColor = aColor;
  vAlpha = aAlpha;
  vFlip = aFlip;
  vEmissive = aEmissive;
}
`;

const fragment = /* glsl */ `
precision highp float;
in float vFrame;
in float vRow;
in vec3 vColor;
in float vAlpha;
in float vFlip;
in float vEmissive;
out vec4 fragColor;
uniform sampler2D uAtlas;
uniform float uLight;
uniform float uGlowPass;
void main() {
  vec2 pc = gl_PointCoord;
  if (vFlip > 0.5) pc.x = 1.0 - pc.x;
  vec4 t = texture(uAtlas, vec2((vFrame + pc.x) / ${COLS}.0, (vRow + pc.y) / ${ROWS}.0));
  float a = t.a * vAlpha;
  if (a < 0.03) discard;
  vec3 rgb = vColor * t.rgb * (vEmissive > 0.5 ? 1.0 : uLight);
  // The glow pass: only fireflies shine
  if (uGlowPass > 0.5 && vEmissive < 0.5) rgb = vec3(0.0);
  fragColor = vec4(rgb, a);
}
`;

export class Nature {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pos = new Float32Array(MAX_POINTS * 3);
  private readonly frame = new Float32Array(MAX_POINTS);
  private readonly row = new Float32Array(MAX_POINTS);
  private readonly size = new Float32Array(MAX_POINTS);
  private readonly color = new Float32Array(MAX_POINTS * 3);
  private readonly alpha = new Float32Array(MAX_POINTS);
  private readonly flip = new Float32Array(MAX_POINTS);
  private readonly emissive = new Float32Array(MAX_POINTS);
  private butterflies: Butterfly[] = [];
  private fireflies: Firefly[] = [];
  private leaves: Leaf[] = [];
  private fish: Fish[] = [];
  /** Splashes not yet heard (client units) */
  private splashes: { x: number; y: number; big: boolean }[] = [];

  /** The fish's splashes since the last call, for their sound */
  takeSplashes(): { x: number; y: number; big: boolean }[] {
    const s = this.splashes;
    this.splashes = [];
    return s;
  }
  private drops: Drop[] = [];
  /** Open water in the room: x, y, surface a spot, found a few rows a frame */
  private water: number[] = [];
  private waterSampler: Generator<void, void> | null = null;
  private nextJump = 2000;

  constructor() {
    this.group.name = "nature";
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aFrame", new THREE.BufferAttribute(this.frame, 1));
    g.setAttribute("aRow", new THREE.BufferAttribute(this.row, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute("aFlip", new THREE.BufferAttribute(this.flip, 1));
    g.setAttribute("aEmissive", new THREE.BufferAttribute(this.emissive, 1));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uAtlas: { value: atlas() }, uScale: { value: 1 }, uLight: { value: 1 }, uGlowPass: glowPass },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {}; // never picked
    this.group.add(this.points);
  }

  /** Half the drawing buffer's height over tan(fov / 2), as three.js sizes points */
  setProjection(bufferHeight: number, fovYDegrees: number): void {
    this.points.material.uniforms.uScale.value = bufferHeight / 2 / Math.tan((fovYDegrees * Math.PI) / 360);
  }

  /** How light it is where the player stands (0..1) */
  setLight(light: number): void {
    this.points.material.uniforms.uLight.value = 0.35 + 0.65 * Math.max(0, Math.min(1, light));
  }

  /**
   * A new room: everything goes, and its open water is looked for (`size` the room's extent,
   * fine units), a few rows a frame
   */
  setRoom(room: NatureRoom, size: { maxX: number; maxY: number }): void {
    this.butterflies = [];
    this.fireflies = [];
    this.leaves = [];
    this.fish = [];
    this.drops = [];
    this.water = [];
    this.waterSampler = this.findWater(room, size);
    this.points.geometry.setDrawRange(0, 0);
  }

  private *findWater(room: NatureRoom, size: { maxX: number; maxY: number }): Generator<void, void> {
    const step = FINENESS / 2;
    let row = 0;
    for (let y = step / 2; y < size.maxY; y += step, row++) {
      for (let x = step / 2; x < size.maxX; x += step) {
        const surface = room.water(x, y);
        if (surface !== null) this.water.push(x, y, surface);
      }
      if (row % 8 === 7) yield;
    }
    // A puddle or two is no place for fish
    if (this.water.length < 3 * 24) this.water = [];
  }

  /**
   * One frame. `viewer` is where the player stands (z: their floor); `facing` their angle
   * (client units), to turn fish the way they leap as seen.
   */
  update(dt: number, viewer: { x: number; y: number; z: number }, facing: number, room: NatureRoom, opts: NatureOptions): void {
    dt = Math.min(dt, 100);
    const s = dt / 1000;
    if (this.waterSampler) {
      const start = performance.now();
      while (performance.now() - start < 2) if (this.waterSampler.next().done) {
        this.waterSampler = null;
        break;
      }
    }
    this.updateButterflies(s, viewer, room, opts.butterflies);
    this.updateFireflies(s, viewer, room, opts.fireflies);
    this.updateLeaves(s, viewer, room, opts.leaves);
    this.updateFish(dt, viewer, facing, opts.fish);
    this.write();
  }

  // ---- butterflies: fluttering low over the ground, turning often ----

  private updateButterflies(s: number, v: { x: number; y: number; z: number }, room: NatureRoom, wanted: number): void {
    for (const b of this.butterflies) {
      if ((b.turn -= s * 1000) <= 0) {
        b.turn = rnd(300, 1200);
        const far = Math.hypot(b.s.x - v.x, b.s.y - v.y) > 8 * FINENESS;
        const a = far ? Math.atan2(v.y - b.s.y, v.x - b.s.x) + rnd(-1, 1) : Math.random() * 2 * Math.PI;
        const speed = rnd(0.5, 1.2) * FINENESS;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      }
      const nx = b.s.x + b.vx * s,
        ny = b.s.y + b.vy * s;
      const floor = room.floor(nx, ny);
      if (floor < 0 || room.roofed(nx, ny) || room.water(nx, ny) !== null) {
        b.vx = -b.vx;
        b.vy = -b.vy;
      } else {
        b.s.x = nx;
        b.s.y = ny;
        b.base += (floor - b.base) * Math.min(1, s * 3);
      }
      b.bob += s;
      // Low over the grass: about a sixth to two thirds of a square up
      b.s.z = b.base + FINENESS * (0.4 + 0.18 * Math.sin(b.bob * 1.7) + 0.07 * Math.sin(b.bob * 5.3));
      b.phase = (b.phase + b.rate * s) % 1;
      b.s.frame = Math.floor(b.phase * 4) % 4;
    }
    this.butterflies = this.butterflies.filter((b) => Math.hypot(b.s.x - v.x, b.s.y - v.y) < 14 * FINENESS);
    if (this.butterflies.length < wanted && Math.random() < s * 3) {
      const at = this.groundSpot(v, room, 3, 10);
      if (at)
        this.butterflies.push({
          s: this.sprite(ROW.BUTTERFLY, at.x, at.y, at.floor + FINENESS * 0.4, rnd(150, 210), pick(BUTTERFLY_COLORS), false),
          vx: 0, vy: 0, turn: 0, base: at.floor, phase: Math.random(), rate: rnd(6, 9), bob: Math.random() * 10,
        });
    }
    if (this.butterflies.length > wanted) this.butterflies.length = wanted;
  }

  // ---- fireflies: drifting slowly and blinking, a little above the ground ----

  private updateFireflies(s: number, v: { x: number; y: number; z: number }, room: NatureRoom, wanted: number): void {
    for (const f of this.fireflies) {
      if ((f.turn -= s * 1000) <= 0) {
        f.turn = rnd(800, 2500);
        const far = Math.hypot(f.s.x - v.x, f.s.y - v.y) > 9 * FINENESS;
        const a = far ? Math.atan2(v.y - f.s.y, v.x - f.s.x) + rnd(-1, 1) : Math.random() * 2 * Math.PI;
        const speed = rnd(0.15, 0.45) * FINENESS;
        f.vx = Math.cos(a) * speed;
        f.vy = Math.sin(a) * speed;
        f.vz = rnd(-0.15, 0.15) * FINENESS;
      }
      const nx = f.s.x + f.vx * s,
        ny = f.s.y + f.vy * s;
      const floor = room.floor(nx, ny);
      if (floor < 0 || room.roofed(nx, ny)) {
        f.vx = -f.vx;
        f.vy = -f.vy;
      } else {
        f.s.x = nx;
        f.s.y = ny;
        f.s.z = Math.max(floor + FINENESS * 0.3, Math.min(floor + FINENESS * 2.5, f.s.z + f.vz * s));
      }
      // Lit for a moment in each cycle, fading in and out
      f.t = (f.t + s * 1000) % f.period;
      const on = Math.max(0, Math.sin((f.t / FIREFLY_LIT_MS) * Math.PI));
      f.s.alpha = f.t < FIREFLY_LIT_MS ? on : 0;
    }
    this.fireflies = this.fireflies.filter((f) => Math.hypot(f.s.x - v.x, f.s.y - v.y) < 14 * FINENESS);
    if (this.fireflies.length < wanted && Math.random() < s * 8) {
      const at = this.groundSpot(v, room, 2, 10);
      if (at) {
        const f: Firefly = {
          s: this.sprite(ROW.DOT, at.x, at.y, at.floor + FINENESS * rnd(0.3, 2), rnd(50, 75), [0.75, 1, 0.35], true),
          vx: 0, vy: 0, vz: 0, turn: 0, t: 0, period: rnd(2000, 5000),
        };
        f.t = Math.random() * f.period;
        f.s.alpha = 0;
        this.fireflies.push(f);
      }
    }
    if (this.fireflies.length > wanted) this.fireflies.length = wanted;
  }

  // ---- leaves: falling from the trees, swaying and turning; they lie a while, then go ----

  private updateLeaves(s: number, v: { x: number; y: number; z: number }, room: NatureRoom, wanted: number): void {
    for (const l of this.leaves) {
      if (l.lying > 0) {
        l.lying -= s * 1000;
        l.s.alpha = Math.min(1, l.lying / 1000);
        continue;
      }
      l.sway += l.swayRate * s;
      l.spin = (l.spin + l.spinRate * s) % 1;
      l.s.x += (l.dx + Math.cos(l.sway) * 0.5 * FINENESS) * s;
      l.s.y += (l.dy + Math.sin(l.sway * 0.7) * 0.3 * FINENESS) * s;
      l.s.z -= l.vz * s * (0.8 + 0.4 * Math.abs(Math.sin(l.sway)));
      l.s.frame = Math.floor(l.spin * 4) % 4;
      const floor = room.floor(l.s.x, l.s.y);
      l.ground = floor < 0 ? l.ground : floor;
      if (l.s.z <= l.ground + 20) {
        // Landed: flat on the ground (face up) a while; on water, it floats off sooner
        l.s.z = l.ground + 20;
        l.s.frame = 2;
        // On water a leaf floats off sooner
        l.lying = room.water(l.s.x, l.s.y) !== null ? 1500 : rnd(3000, 6000);
      }
    }
    this.leaves = this.leaves.filter((l) => l.s.alpha > 0 && Math.hypot(l.s.x - v.x, l.s.y - v.y) < 14 * FINENESS);
    const falling = this.leaves.filter((l) => l.lying <= 0).length;
    if (falling < wanted && Math.random() < s * 4) {
      const at = this.groundSpot(v, room, 1, 6);
      if (at) {
        const wind = Math.random() * 2 * Math.PI;
        // From about the treetops in view (higher ones drift down out of sight above)
        this.leaves.push({
          s: this.sprite(ROW.LEAF, at.x, at.y, at.floor + FINENESS * rnd(2, 4.5), rnd(120, 170), pick(LEAF_COLORS), false),
          vz: rnd(0.35, 0.6) * FINENESS, sway: Math.random() * 6, swayRate: rnd(1.5, 3), spin: Math.random(),
          spinRate: rnd(0.6, 1.5), lying: 0, ground: at.floor, dx: Math.cos(wind) * 0.2 * FINENESS, dy: Math.sin(wind) * 0.2 * FINENESS,
        });
      }
    }
  }

  // ---- fish: now and then one leaps out of the water near us and splashes back ----

  private updateFish(dt: number, v: { x: number; y: number; z: number }, facing: number, on: boolean): void {
    const s = dt / 1000;
    for (const f of this.fish) {
      f.t += dt;
      const k = Math.min(1, f.t / f.duration);
      f.s.x = f.x0 + f.dx * k;
      f.s.y = f.y0 + f.dy * k;
      f.s.z = f.surface + f.height * 4 * k * (1 - k) - 60;
      f.s.frame = k < 0.35 ? 0 : k < 0.65 ? 1 : 2;
      if (k >= 1) this.splash(f.s.x, f.s.y, f.surface, 10);
    }
    this.fish = this.fish.filter((f) => f.t < f.duration);
    for (const d of this.drops) {
      d.life -= dt;
      d.vz -= 5 * FINENESS * s;
      d.s.x += d.vx * s;
      d.s.y += d.vy * s;
      d.s.z = Math.max(d.surface, d.s.z + d.vz * s);
      d.s.alpha = Math.max(0, Math.min(1, d.life / 300));
    }
    this.drops = this.drops.filter((d) => d.life > 0);
    if (!on || !this.water.length || (this.nextJump -= dt) > 0) return;
    this.nextJump = rnd(3000, 12000);
    // A spot of water between 3 and 14 squares off
    const w = this.water;
    for (let k = 0; k < 30; k++) {
      const i = Math.floor(Math.random() * (w.length / 3)) * 3;
      const d = Math.hypot(w[i] - v.x, w[i + 1] - v.y);
      if (d < 3 * FINENESS || d > 14 * FINENESS) continue;
      const a = Math.random() * 2 * Math.PI;
      const len = rnd(0.4, 0.9) * FINENESS;
      const dx = Math.cos(a) * len,
        dy = Math.sin(a) * len;
      // Seen from where we look: heading right on screen or left (the picture faces right)
      const right = { x: -Math.sin((facing * 2 * Math.PI) / 4096), y: Math.cos((facing * 2 * Math.PI) / 4096) };
      const fish: Fish = {
        s: this.sprite(ROW.FISH, w[i], w[i + 1], w[i + 2], rnd(260, 360), [0.72, 0.78, 0.82], false),
        x0: w[i], y0: w[i + 1], dx, dy, surface: w[i + 2], t: 0, duration: rnd(650, 950), height: rnd(0.35, 0.6) * FINENESS,
      };
      fish.s.flip = dx * right.x + dy * right.y < 0;
      this.fish.push(fish);
      this.splash(w[i], w[i + 1], w[i + 2], 6);
      return;
    }
  }

  private splash(x: number, y: number, surface: number, n: number): void {
    if (this.splashes.length < 8) this.splashes.push({ x, y, big: n >= 10 });
    for (let k = 0; k < n && this.drops.length < 60; k++) {
      const a = Math.random() * 2 * Math.PI;
      const out = rnd(0.2, 0.6) * FINENESS;
      this.drops.push({
        s: this.sprite(ROW.DOT, x, y, surface + 10, rnd(40, 65), [0.85, 0.92, 1], false),
        vx: Math.cos(a) * out, vy: Math.sin(a) * out, vz: rnd(0.8, 1.6) * FINENESS, life: rnd(450, 750), surface,
      });
    }
  }

  // ---- shared ----

  /** A place on dry, open ground between `near` and `far` squares from us, or null */
  private groundSpot(v: { x: number; y: number }, room: NatureRoom, near: number, far: number): { x: number; y: number; floor: number } | null {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * 2 * Math.PI,
        r = rnd(near, far) * FINENESS;
      const x = v.x + Math.cos(a) * r,
        y = v.y + Math.sin(a) * r;
      const floor = room.floor(x, y);
      if (floor < 0 || room.roofed(x, y) || room.water(x, y) !== null) continue;
      return { x, y, floor };
    }
    return null;
  }

  private sprite(row: number, x: number, y: number, z: number, size: number, rgb: [number, number, number], emissive: boolean): Sprite {
    return { row, frame: 0, x, y, z, size, r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1, flip: Math.random() < 0.5, emissive };
  }

  /** Fill the points: scene X = x, Y = z, Z = y, in squares */
  private write(): void {
    let n = 0;
    const put = (p: Sprite) => {
      if (n >= MAX_POINTS || p.alpha <= 0) return;
      this.pos[n * 3] = p.x / FINENESS;
      this.pos[n * 3 + 1] = p.z / FINENESS;
      this.pos[n * 3 + 2] = p.y / FINENESS;
      this.frame[n] = p.frame;
      this.row[n] = p.row;
      this.size[n] = p.size / FINENESS;
      this.color[n * 3] = p.r;
      this.color[n * 3 + 1] = p.g;
      this.color[n * 3 + 2] = p.b;
      this.alpha[n] = p.alpha;
      this.flip[n] = p.flip ? 1 : 0;
      this.emissive[n] = p.emissive ? 1 : 0;
      n++;
    };
    for (const b of this.butterflies) put(b.s);
    for (const f of this.fireflies) put(f.s);
    for (const l of this.leaves) put(l.s);
    for (const f of this.fish) put(f.s);
    for (const d of this.drops) put(d.s);
    const g = this.points.geometry;
    for (const name of ["position", "aFrame", "aRow", "aSize", "aColor", "aAlpha", "aFlip", "aEmissive"]) g.getAttribute(name).needsUpdate = true;
    g.setDrawRange(0, n);
  }

  /** How many are about now (dev tools, tests) */
  get count(): { butterflies: number; fireflies: number; leaves: number; fish: number; water: number } {
    return { butterflies: this.butterflies.length, fireflies: this.fireflies.length, leaves: this.leaves.length, fish: this.fish.length, water: this.water.length / 3 };
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material.uniforms.uAtlas.value as THREE.Texture).dispose();
    this.points.material.dispose();
  }
}
