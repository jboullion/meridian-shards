// Ours (Ground Detail): tufts of grass, little flowers and rocks on the ground about the player, so
// open country isn't a flat texture. What grows where comes from the floor's texture
// (floortextures.json: grass, earth or rock, and its colour, which the tufts take). Where each one
// stands is a hash of the room and the spot, so everyone sees the same tuft in the same place, and
// it's there again when you come back. The tufts are drawn here; the rocks are the game's own rock
// ornaments (setRockArt), mostly much smaller than they're drawn as objects. They're points like
// the weather's, alpha-tested and opaque so they need no sorting, never picked, and drawn black in
// the glow pass.
//
// Positions are client fine units (x east, y south, z up).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import { glowPass } from "./lighting.ts";
import { renderTune } from "./tuning.ts";

const FRAME = 64;
const COLS = 4,
  ROWS = 2;
/** Atlas cells: [row, col] */
const ART = {
  tuft: [[0, 0], [0, 1], [0, 2], [0, 3]],
  flower: [[1, 0], [1, 1]],
  dry: [[1, 2], [1, 3]],
} as const;
type Art = keyof typeof ART | "rock";

/** The rocks' atlas: cells of ROCK_CELL pixels, four across and two down */
const ROCK_CELL = 128;
const ROCK_COLS = 4,
  ROCK_ROWS = 2;
// Rocks are drawn a fraction of the size they'd have (mostly pebbles, never bigger than the ornament):
// tuning.ts rockSize

/** A cell of ground half a square across; the cover is looked at out to tuning.ts groundRadius about the player */
const CELL = FINENESS / 2;
/** Out to here, shrunk to nothing toward the edge (from groundFadeFrom), so nothing pops in */
const radius = () => renderTune("groundRadius") * FINENESS;
const fadeFrom = () => Math.min(renderTune("groundFadeFrom"), renderTune("groundRadius") - 1) * FINENESS;
const MAX_POINTS = 6000;
/** Rebuilt when the player has moved this far, and relit this often (the hour changes the light) */
const MOVE = FINENESS / 2;
const RELIGHT_MS = 2000;

export type GroundKind = "grass" | "earth" | "rocky";

/** A rock's picture (a game bitmap: palette indices, 254 see-through) and where it lies about */
export interface RockArt {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** The bitmap's shrink: a pixel is 16 / shrink fine units */
  shrink: number;
  kinds: GroundKind[];
}

/** A rock as the cover draws it: its atlas cell, how much of the cell it fills, its true size */
interface Rock {
  kinds: GroundKind[];
  /** Fraction of the (square) cell the picture fills across and up, from the bottom middle */
  fw: number;
  fh: number;
  /** Its width as an object, fine units: drawn at a fraction of it, never more */
  width: number;
}

/** The ground at a point, as GroundCover asks the room */
export interface GroundSpot {
  floor: number;
  kind: GroundKind;
  /** The floor texture's average colour, 0..1 */
  color: [number, number, number];
  /** Whether the room is a town's, a castle's or the like: no rocks there */
  town: boolean;
  /** Paving or cobbles: nothing strewn on it */
  bare?: boolean;
}

export interface GroundRoom {
  /** What's on the ground at a point, or null for none here (no sky, water, paving, indoors) */
  spot(x: number, y: number): GroundSpot | null;
  /** How lit a point is, 0..1 each (the sector's light and the hour; no torches) */
  light(x: number, y: number, z: number): [number, number, number];
}

interface Piece {
  x: number;
  y: number;
  floor: number;
  art: Art;
  /** The tuft's picture, or the rock's (its index in setRockArt's list) */
  variant: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Lit colour, refreshed now and then */
  lr: number;
  lg: number;
  lb: number;
}

/** A fixed pseudo-random number 0..1 for a cell, a salt and the room */
function hash(cx: number, cy: number, salt: number, seed: number): number {
  let h = (Math.imul(cx, 374761393) + Math.imul(cy, 668265263) + Math.imul(salt, -2048144777) + Math.imul(seed, -1028477379)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- the pictures (base at the bottom of each cell): 0..1 shading of the floor's colour, past 1 toward white ----

type Shape = (x: number, y: number) => number;

function drawCell(px: Uint8Array, width: number, row: number, col: number, shape: Shape): void {
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) {
      let n = 0,
        tone = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const t = shape(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
          if (t) {
            n++;
            tone += t;
          }
        }
      if (!n) continue;
      const i = ((row * FRAME + y) * width + col * FRAME + x) * 4;
      // Half scale: 128 is the floor's own colour, up to 255 lighter (petals)
      px[i] = px[i + 1] = px[i + 2] = Math.round((Math.min(2, tone / n) / 2) * 255);
      px[i + 3] = Math.round((n / 9) * 255);
    }
}

/** Blades of grass fanning up from the ground; `seed` varies how many and how they lean */
function tuft(seed: number, dry = false): Shape {
  const rand = (k: number) => hash(seed, k, 7, 11);
  const blades = Array.from({ length: dry ? 7 : 9 + Math.floor(rand(0) * 4) }, (_, k) => {
    const base = 32 + (rand(k + 1) - 0.5) * 22;
    const lean = (rand(k + 20) - 0.5) * 30 + (base - 32) * 0.6;
    const height = (dry ? 34 : 40) + rand(k + 40) * (dry ? 16 : 22);
    return { base, lean, height, width: 1.6 + rand(k + 60) * 1.4, tone: 0.65 + rand(k + 80) * 0.45 };
  });
  return (x, y) => {
    const up = 63 - y; // height above the ground, in pixels
    if (up < 0) return 0;
    for (const b of blades) {
      if (up > b.height) continue;
      const t = up / b.height;
      // A curve: leaning more toward the tip, narrowing to a point
      const cx = b.base + b.lean * t * t;
      if (Math.abs(x - cx) <= b.width * (1 - t * 0.85)) return Math.min(1, b.tone * (0.7 + 0.3 * t));
    }
    return 0;
  };
}

/** A tuft with a few small flowers on stalks; the petals are lighter (tinted in the shader) */
function flowers(seed: number): Shape {
  const grass = tuft(seed + 100);
  const rand = (k: number) => hash(seed, k, 9, 13);
  const heads = Array.from({ length: 3 }, (_, k) => ({ x: 20 + rand(k) * 24, y: 63 - (30 + rand(k + 5) * 20) }));
  return (x, y) => {
    for (const h of heads) {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d < 1.4) return 0.35; // the middle
      if (d < 4) return 2; // petals: drawn white, lightened past the grass's colour
    }
    return grass(x, y);
  };
}

function atlas(): THREE.DataTexture {
  const w = FRAME * COLS,
    h = FRAME * ROWS;
  const px = new Uint8Array(w * h * 4);
  ART.tuft.forEach(([r, c], k) => drawCell(px, w, r, c, tuft(k)));
  ART.flower.forEach(([r, c], k) => drawCell(px, w, r, c, flowers(k)));
  ART.dry.forEach(([r, c], k) => drawCell(px, w, r, c, tuft(k + 50, true)));
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The rocks into one texture: each scaled to fit its cell, standing on the cell's bottom middle */
function rockAtlas(rocks: RockArt[], palette: Uint8Array): THREE.DataTexture {
  const w = ROCK_CELL * ROCK_COLS,
    h = ROCK_CELL * ROCK_ROWS;
  const px = new Uint8Array(w * h * 4);
  rocks.slice(0, ROCK_COLS * ROCK_ROWS).forEach((r, k) => {
    const scale = ROCK_CELL / Math.max(r.width, r.height);
    const dw = Math.round(r.width * scale),
      dh = Math.round(r.height * scale);
    const ox = (k % ROCK_COLS) * ROCK_CELL + Math.floor((ROCK_CELL - dw) / 2),
      oy = Math.floor(k / ROCK_COLS) * ROCK_CELL + (ROCK_CELL - dh);
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        const i = r.pixels[Math.min(r.height - 1, Math.floor(y / scale)) * r.width + Math.min(r.width - 1, Math.floor(x / scale))];
        if (i === 254) continue;
        const o = ((oy + y) * w + ox + x) * 4;
        px[o] = palette[i * 3];
        px[o + 1] = palette[i * 3 + 1];
        px[o + 2] = palette[i * 3 + 2];
        px[o + 3] = 255;
      }
  });
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const rockFragment = /* glsl */ `
precision highp float;
in vec2 vCell;
in vec3 vColor;
out vec4 fragColor;
uniform sampler2D uAtlas;
uniform float uGlowPass;
void main() {
  vec4 t = texture(uAtlas, vec2((vCell.y + gl_PointCoord.x) / ${ROCK_COLS}.0, (vCell.x + gl_PointCoord.y) / ${ROCK_ROWS}.0));
  if (t.a < 0.5) discard;
  // The rock's own colours, in the light where it lies
  fragColor = vec4(uGlowPass > 0.5 ? vec3(0.0) : t.rgb * vColor, 1.0);
}
`;

const vertex = /* glsl */ `
in vec2 aCell;
in float aSize;
in vec3 aColor;
out vec2 vCell;
out vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vCell = aCell;
  vColor = aColor;
}
`;

const fragment = /* glsl */ `
precision highp float;
in vec2 vCell;
in vec3 vColor;
out vec4 fragColor;
uniform sampler2D uAtlas;
uniform float uGlowPass;
void main() {
  vec4 t = texture(uAtlas, vec2((vCell.y + gl_PointCoord.x) / ${COLS}.0, (vCell.x + gl_PointCoord.y) / ${ROWS}.0));
  if (t.a < 0.5) discard;
  // Grey up to 1 is the floor's colour, shaded; past it (flower petals) toward white
  float g = t.r * (255.0 / 128.0);
  vec3 rgb = g <= 1.0 ? vColor * g : mix(vColor, vec3(1.0, 0.95, 0.85) * max(vColor.r, max(vColor.g, vColor.b)) * 1.6, g - 1.0);
  fragColor = vec4(uGlowPass > 0.5 ? vec3(0.0) : rgb, 1.0);
}
`;

/** One set of points (tufts, or rocks) and its buffers */
class Layer {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly pos = new Float32Array(MAX_POINTS * 3);
  readonly cell = new Float32Array(MAX_POINTS * 2);
  readonly size = new Float32Array(MAX_POINTS);
  readonly color = new Float32Array(MAX_POINTS * 3);
  n = 0;

  constructor(fragmentShader: string, atlasTexture: THREE.Texture | null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aCell", new THREE.BufferAttribute(this.cell, 2));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader,
      uniforms: { uAtlas: { value: atlasTexture }, uScale: { value: 1 }, uGlowPass: glowPass },
    });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {}; // never picked
  }

  put(x: number, y: number, z: number, row: number, col: number, size: number, r: number, g: number, b: number): void {
    const n = this.n;
    if (n >= MAX_POINTS) return;
    this.pos[n * 3] = x / FINENESS;
    this.pos[n * 3 + 1] = z / FINENESS;
    this.pos[n * 3 + 2] = y / FINENESS;
    this.cell[n * 2] = row;
    this.cell[n * 2 + 1] = col;
    this.size[n] = size / FINENESS;
    this.color[n * 3] = r;
    this.color[n * 3 + 1] = g;
    this.color[n * 3 + 2] = b;
    this.n++;
  }

  done(): void {
    const g = this.points.geometry;
    for (const name of ["position", "aCell", "aSize", "aColor"]) g.getAttribute(name).needsUpdate = true;
    g.setDrawRange(0, this.n);
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material.uniforms.uAtlas.value as THREE.Texture | null)?.dispose();
    this.points.material.dispose();
  }
}

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly tufts = new Layer(fragment, atlas());
  private readonly rockLayer = new Layer(rockFragment, null);
  private rocks: Rock[] = [];
  /** What each cell holds, worked out once a room (null: bare) */
  private cells = new Map<number, Piece | null>();
  private seed = 0;
  private room: GroundRoom | null = null;
  private at: { x: number; y: number } | null = null;
  private relight = 0;

  constructor() {
    this.group.name = "ground cover";
    this.group.add(this.tufts.points, this.rockLayer.points);
  }

  /** The rocks to strew (the game's rock ornaments) and the palette to colour them */
  setRockArt(rocks: RockArt[], palette: Uint8Array): void {
    const layer = this.rockLayer;
    (layer.points.material.uniforms.uAtlas.value as THREE.Texture | null)?.dispose();
    layer.points.material.uniforms.uAtlas.value = rockAtlas(rocks, palette);
    this.rocks = rocks.slice(0, ROCK_COLS * ROCK_ROWS).map((r) => {
      const m = Math.max(r.width, r.height);
      return { kinds: r.kinds, fw: r.width / m, fh: r.height / m, width: (r.width * 16) / r.shrink };
    });
    // Worked out again with the rocks in
    this.cells.clear();
    this.at = null;
  }

  setProjection(bufferHeight: number, fovYDegrees: number): void {
    const scale = bufferHeight / 2 / Math.tan((fovYDegrees * Math.PI) / 360);
    this.tufts.points.material.uniforms.uScale.value = scale;
    this.rockLayer.points.material.uniforms.uScale.value = scale;
  }

  /** A new room (its name seeds where everything grows) */
  setRoom(name: string, room: GroundRoom): void {
    let seed = 0;
    for (let i = 0; i < name.length; i++) seed = (Math.imul(seed, 31) + name.charCodeAt(i)) | 0;
    this.seed = seed;
    this.room = room;
    this.cells.clear();
    this.at = null;
    this.clear();
  }

  /** Nothing drawn (the option off) until the next update */
  clear(): void {
    this.at = null;
    this.tufts.points.geometry.setDrawRange(0, 0);
    this.rockLayer.points.geometry.setDrawRange(0, 0);
  }

  update(dt: number, viewer: { x: number; y: number }): void {
    if (!this.room) return;
    this.relight -= dt;
    const moved = !this.at || Math.hypot(viewer.x - this.at.x, viewer.y - this.at.y) >= MOVE;
    if (!moved && this.relight > 0) return;
    if (this.relight <= 0) {
      this.relight = RELIGHT_MS;
      // The hour moves the light: everything's colour again
      for (const p of this.cells.values()) if (p) this.light(p);
    }
    this.at = { x: viewer.x, y: viewer.y };
    this.write(viewer);
  }

  /** What grows in a cell: decided by its hash and the ground there */
  private piece(cx: number, cy: number): Piece | null {
    const key = cy * 65536 + cx;
    const known = this.cells.get(key);
    if (known !== undefined) return known;
    const h = (salt: number) => hash(cx, cy, salt, this.seed);
    const x = (cx + h(1)) * CELL,
      y = (cy + h(2)) * CELL;
    const spot = this.room!.spot(x, y);
    let art: Art | null = null;
    const roll = h(3);
    if (spot && !spot.bare) {
      // Grass: a third tufts, a few flowers, a rare rock; earth: dry tufts, now and then a rock;
      // rock: the odd rock (rocks are meant to be few)
      if (spot.kind === "grass") art = roll < 0.34 ? "tuft" : roll < 0.39 ? "flower" : roll < 0.395 && !spot.town ? "rock" : null;
      else if (spot.kind === "earth") art = roll < 0.05 ? "dry" : roll < 0.0775 && !spot.town ? "rock" : null;
      else art = !spot.town && roll < 0.0375 ? "rock" : null;
    }
    const rocks = art === "rock" && spot ? this.rocks.map((r, i) => [r, i] as const).filter(([r]) => r.kinds.includes(spot.kind)) : [];
    if (art === "rock" && !rocks.length) art = null;
    if (!spot || !art) {
      this.cells.set(key, null);
      return null;
    }
    let p: Piece;
    if (art === "rock") {
      const [rock, index] = rocks[Math.floor(h(4) * rocks.length) % rocks.length];
      // Mostly small (pebbles), now and then a stone half a square across; never bigger than the ornament
      const width = renderTune("rockSize") * Math.min(rock.width, 70 + 380 * h(6) ** 2.2);
      p = { x, y, floor: spot.floor, art, variant: index, size: width / rock.fw, r: 1, g: 1, b: 1, lr: 1, lg: 1, lb: 1 };
    } else {
      const sizes: Record<Exclude<Art, "rock">, [number, number]> = { tuft: [128, 225], flower: [120, 180], dry: [112, 195] };
      const [lo, hi] = sizes[art];
      // The floor's colour, a little lighter (dry tufts yellower), varied a bit each
      const vary = 0.85 + h(5) * 0.3;
      const lift = art === "dry" ? 1.25 : 1.35;
      const [r, g, b] = spot.color;
      p = {
        x, y, floor: spot.floor, art, variant: Math.floor(h(4) * ART[art].length) % ART[art].length, size: lo + h(6) * (hi - lo),
        r: Math.min(1, r * lift * vary), g: Math.min(1, g * lift * vary), b: Math.min(1, b * lift * (art === "dry" ? 0.8 : 1) * vary),
        lr: 1, lg: 1, lb: 1,
      };
    }
    this.light(p);
    this.cells.set(key, p);
    return p;
  }

  private light(p: Piece): void {
    const [lr, lg, lb] = this.room!.light(p.x, p.y, p.floor);
    p.lr = p.r * lr;
    p.lg = p.g * lg;
    p.lb = p.b * lb;
  }

  private write(v: { x: number; y: number }): void {
    const tufts = this.tufts,
      rocks = this.rockLayer;
    tufts.n = rocks.n = 0;
    const c0 = Math.floor((v.x - radius()) / CELL),
      c1 = Math.floor((v.x + radius()) / CELL);
    const r0 = Math.floor((v.y - radius()) / CELL),
      r1 = Math.floor((v.y + radius()) / CELL);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        if (cx < 0 || cy < 0) continue;
        const p = this.piece(cx, cy);
        if (!p) continue;
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d > radius()) continue;
        const shrink = d < fadeFrom() ? 1 : 1 - (d - fadeFrom()) / (radius() - fadeFrom());
        const size = p.size * shrink;
        // The point's middle half its size up: its picture stands on the floor (a hair sunk in)
        const z = p.floor + size * 0.47;
        if (p.art === "rock") {
          rocks.put(p.x, p.y, z, Math.floor(p.variant / ROCK_COLS), p.variant % ROCK_COLS, size, p.lr, p.lg, p.lb);
        } else {
          const [row, col] = ART[p.art][p.variant];
          tufts.put(p.x, p.y, z, row, col, size, p.lr, p.lg, p.lb);
        }
      }
    tufts.done();
    rocks.done();
  }

  /** How many are drawn now (dev tools, tests) */
  get count(): number {
    return this.tufts.n + this.rockLayer.n;
  }

  dispose(): void {
    this.tufts.dispose();
    this.rockLayer.dispose();
  }
}
