// Ours: puddles on the ground in the rain. Outdoors (under open sky), on paving, earth and now and
// then grass, pools of water spread as the rain goes on, rings spread across them where the drops
// fall, and they shrink away after it stops. Where each one lies is a hash of the room and the
// square, so everyone sees the same puddles. Flat shapes on the floor, drawn after the room,
// with a wobbly edge, a darker wet rim and a sheen that brightens at a glancing angle (no real
// reflection). Never picked, and left out of the glow pass. The same rings fall on open water
// (lakes, rivers, the sea, painted pools) while it rains: a ring layer a square at a time.
//
// Positions are client fine units (x east, y south, z up).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import { renderTune } from "./tuning.ts";

/** Puddles are looked for on a grid of squares this far about the player, fading from fadeFrom (tuning.ts) */
const radius = () => renderTune("puddleRadius") * FINENESS;
const fadeFrom = () => Math.min(renderTune("puddleFadeFrom"), renderTune("puddleRadius") - 1) * FINENESS;
const MAX_PUDDLES = 400;
/** Rebuilt when the player has moved this far, and relit this often */
const MOVE = FINENESS;
const RELIGHT_MS = 2000;
export type PuddleGround = "paved" | "earth" | "grass";

/** How likely a square is to hold a puddle, by the ground (tuning.ts; 30% fewer since 2026-10-12) */
const chance = (g: PuddleGround) => renderTune(g === "paved" ? "puddlePaved" : g === "earth" ? "puddleEarth" : "puddleGrass");

/** The ground at a point, as Puddles asks the room */
export interface PuddleSpot {
  floor: number;
  ground: PuddleGround;
}

export interface PuddleRoom {
  /** Open ground under the sky at a point (not water, not a cave), or null */
  spot(x: number, y: number): PuddleSpot | null;
  /** Water under the sky at a point: its surface's height, or null */
  water(x: number, y: number): number | null;
  /** How lit a point is, 0..1 each */
  light(x: number, y: number, z: number): [number, number, number];
}

const vertex = /* glsl */ `
in vec2 aUv;
in float aSeed;
in vec3 aLight;
in float aFade;
out vec2 vUv;
out float vSeed;
out vec3 vLight;
out float vFade;
out float vGrazing;
void main() {
  vUv = aUv;
  vSeed = aSeed;
  vLight = aLight;
  vFade = aFade;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vGrazing = 1.0 - abs(normalize(cameraPosition - world.xyz).y);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragment = /* glsl */ `
uniform float uWet;
uniform float uRain;
uniform float uTime;
in vec2 vUv;
in float vSeed;
in vec3 vLight;
in float vFade;
in float vGrazing;
out vec4 outColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float a = atan(vUv.y, vUv.x);
  float r = length(vUv);
  // A wobbly edge, filling out as the rain goes on
  float edge = 0.74 + 0.12 * sin(a * 3.0 + vSeed * 6.0) + 0.07 * sin(a * 5.0 + vSeed * 13.0) + 0.04 * sin(a * 9.0 + vSeed * 3.0);
  edge *= mix(0.35, 1.0, uWet);
  float water = 1.0 - smoothstep(edge - 0.14, edge, r);
  // The ground about it is wet too: a darker rim
  float rim = (1.0 - smoothstep(edge, edge + 0.22, r)) * (1.0 - water);
  if (water + rim <= 0.001) discard;
  // Rings where the drops fall, about the puddle's mean size: not the wobbly edge, which changes
  // with the angle about the middle, so each pixel had its own centre for a ring (bent rings,
  // pinched to a point in every puddle's middle)
  float size = 0.74 * mix(0.35, 1.0, uWet);
  float ripple = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float t = uTime * (0.0011 + 0.0005 * hash(vSeed + fi)) + hash(vSeed * 7.0 + fi);
    float cycle = floor(t);
    float phase = fract(t);
    vec2 c = (vec2(hash(vSeed + fi * 3.1 + cycle), hash(vSeed + fi * 5.7 + cycle * 1.3)) - 0.5) * size * 1.1;
    float ring = 1.0 - smoothstep(0.0, 0.035, abs(length(vUv - c) - phase * 0.32));
    ripple += ring * (1.0 - phase);
  }
  ripple *= uRain * water;
  vec3 deep = vec3(0.07, 0.085, 0.11);
  // A sheen of the sky, stronger at a glancing look
  vec3 sheen = vec3(0.55, 0.62, 0.74) * mix(0.2, 1.05, pow(vGrazing, 2.0));
  vec3 color = (deep + sheen + ripple * 0.5) * vLight;
  float alpha = (water * 0.78 + rim * 0.35) * uWet * vFade;
  // The rim only darkens
  color = mix(vec3(0.0), color, water / max(water + rim, 0.001));
  outColor = vec4(color, alpha);
}`;

/** Rain rings on open water: squares this far about the player, fading from the first */
const WATER_RADIUS = 12 * FINENESS;
const WATER_FADE_FROM = 8 * FINENESS;
const MAX_WATER = 700;

/**
 * The puddles' rings alone, over a square of water (vUv -1..1 across it), more of them and
 * brighter, since open water is darker than a puddle's sheen: centres kept far enough in that a
 * ring never reaches the square's edge, where it would be cut off
 */
const rippleFragment = /* glsl */ `
uniform float uRain;
uniform float uTime;
in vec2 vUv;
in float vSeed;
in vec3 vLight;
in float vFade;
in float vGrazing;
out vec4 outColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float ripple = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float t = uTime * (0.0011 + 0.0005 * hash(vSeed + fi)) + hash(vSeed * 7.0 + fi);
    float cycle = floor(t);
    float phase = fract(t);
    vec2 c = (vec2(hash(vSeed + fi * 3.1 + cycle), hash(vSeed + fi * 5.7 + cycle * 1.3)) - 0.5) * 1.2;
    float ring = 1.0 - smoothstep(0.0, 0.035, abs(length(vUv - c) - phase * 0.32));
    ripple += ring * (1.0 - phase);
  }
  float a = ripple * uRain * vFade;
  if (a <= 0.004) discard;
  // The sky's sheen in the rings, as on the puddles
  vec3 color = vec3(0.7, 0.78, 0.9) * mix(0.6, 1.1, pow(vGrazing, 2.0)) * (0.35 + 0.65 * vLight);
  outColor = vec4(color, min(1.0, a * 0.7));
}`;

/** A square of open water under the sky */
interface WaterSquare {
  x: number;
  y: number;
  z: number;
  seed: number;
}

interface Puddle {
  x: number;
  y: number;
  z: number;
  /** Half its length and width, fine units, and which way it lies */
  rx: number;
  ry: number;
  turn: number;
  seed: number;
}

/** A hash of the room's name and a square: the same for everyone */
function hash(room: number, col: number, row: number, k: number): number {
  let h = (room ^ Math.imul(col, 0x27d4eb2d) ^ Math.imul(row, 0x165667b1) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Puddles {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  private room: PuddleRoom | null = null;
  private roomHash = 0;
  private puddles: Puddle[] = [];
  private readonly waterMesh: THREE.Mesh;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly waterGeometry = new THREE.BufferGeometry();
  private water: WaterSquare[] = [];
  private at: { x: number; y: number } | null = null;
  private relightMs = 0;
  private time = 0;

  constructor() {
    this.group.name = "puddles";
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uWet: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      // The scene mirrors the client's handedness (X = x, Z = y), so the quads face down
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    // The rings on open water share the puddles' time and rain
    this.waterMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: rippleFragment,
      uniforms: { uRain: this.material.uniforms.uRain, uTime: this.material.uniforms.uTime },
      transparent: true,
      // Added to the water (often brighter than a puddle): the rings only ever lighten it
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.waterMesh = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
    this.waterMesh.frustumCulled = false;
    this.group.add(this.waterMesh);
    this.group.visible = false;
  }

  /** How many are drawn */
  get count(): number {
    return this.group.visible && this.mesh.visible ? this.puddles.length : 0;
  }

  /** How many squares of open water have the rain's rings on them now */
  get ringSquares(): number {
    return this.group.visible && this.waterMesh.visible ? this.water.length : 0;
  }

  /** Whether a point is in a puddle (as far as they've spread) */
  wetAt(x: number, y: number): boolean {
    if (!this.group.visible) return false;
    const spread = 0.35 + 0.65 * this.material.uniforms.uWet.value;
    for (const p of this.puddles) {
      const dx = x - p.x,
        dy = y - p.y;
      if (Math.abs(dx) > p.rx || Math.abs(dy) > p.rx) continue;
      const c = Math.cos(p.turn),
        s = Math.sin(p.turn);
      const u = (dx * c + dy * s) / (p.rx * spread),
        w = (-dx * s + dy * c) / (p.ry * spread);
      if (u * u + w * w < 0.55) return true;
    }
    return false;
  }

  setRoom(name: string, room: PuddleRoom): void {
    this.room = room;
    this.roomHash = nameHash(name.toLowerCase());
    this.at = null;
    this.puddles = [];
    this.water = [];
  }

  /** Nothing to draw (no rain for a while, or another room) */
  clear(): void {
    this.group.visible = false;
    this.at = null;
  }

  /**
   * @param wet 0..1: how far the puddles have spread (rising while it rains, falling after)
   * @param raining whether drops are falling on them now
   */
  update(dt: number, viewer: { x: number; y: number }, wet: number, raining: boolean): void {
    this.time += dt;
    const u = this.material.uniforms;
    u.uWet.value = wet;
    u.uTime.value = this.time;
    u.uRain.value += ((raining ? 1 : 0) - u.uRain.value) * Math.min(1, dt / 1500);
    // Puddles while the ground is wet; rings on open water while drops fall
    const puddles = wet > 0.01;
    const rings = u.uRain.value > 0.01;
    if (!this.room || (!puddles && !rings)) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.mesh.visible = puddles;
    this.waterMesh.visible = rings;
    const moved = !this.at || Math.hypot(viewer.x - this.at.x, viewer.y - this.at.y) > MOVE;
    if (moved) {
      this.at = { ...viewer };
      this.place(viewer);
    }
    if (moved || (this.relightMs -= dt) <= 0) {
      this.relightMs = RELIGHT_MS;
      this.build(viewer);
    }
  }

  /** The puddles in the squares about the player */
  private place(v: { x: number; y: number }): void {
    const room = this.room!;
    const out: Puddle[] = [];
    const n = Math.ceil(radius() / FINENESS);
    const c0 = Math.floor(v.x / FINENESS),
      r0 = Math.floor(v.y / FINENESS);
    for (let r = r0 - n; r <= r0 + n && out.length < MAX_PUDDLES; r++)
      for (let c = c0 - n; c <= c0 + n && out.length < MAX_PUDDLES; c++) {
        const roll = hash(this.roomHash, c, r, 0);
        // Cheap first: no ground has a chance above the largest
        if (roll >= chance("earth")) continue;
        const x = (c + 0.2 + 0.6 * hash(this.roomHash, c, r, 1)) * FINENESS,
          y = (r + 0.2 + 0.6 * hash(this.roomHash, c, r, 2)) * FINENESS;
        if (Math.hypot(x - v.x, y - v.y) > radius()) continue;
        const spot = room.spot(x, y);
        if (!spot || roll >= chance(spot.ground)) continue;
        const rx = (0.25 + 0.45 * hash(this.roomHash, c, r, 3)) * FINENESS;
        const ry = rx * (0.55 + 0.4 * hash(this.roomHash, c, r, 4));
        const turn = hash(this.roomHash, c, r, 5) * Math.PI;
        // Only on level ground that's all the same floor
        let flat = true;
        for (let k = 0; k < 4 && flat; k++) {
          const a = turn + (k * Math.PI) / 2;
          const d = k % 2 ? ry : rx;
          const s = room.spot(x + Math.cos(a) * d * 1.1, y + Math.sin(a) * d * 1.1);
          flat = !!s && Math.abs(s.floor - spot.floor) < 4;
        }
        if (flat) out.push({ x, y, z: spot.floor, rx, ry, turn, seed: hash(this.roomHash, c, r, 6) * 100 });
      }
    this.puddles = out;
    // Squares of open water, whole: every corner on water at the same height (no rings on the shore)
    const water: WaterSquare[] = [];
    const m = Math.ceil(WATER_RADIUS / FINENESS);
    for (let r = r0 - m; r <= r0 + m && water.length < MAX_WATER; r++)
      for (let c = c0 - m; c <= c0 + m && water.length < MAX_WATER; c++) {
        const x = (c + 0.5) * FINENESS,
          y = (r + 0.5) * FINENESS;
        if (Math.hypot(x - v.x, y - v.y) > WATER_RADIUS) continue;
        const z = room.water(x, y);
        if (z === null) continue;
        let whole = true;
        for (let k = 0; k < 4 && whole; k++) {
          const w = room.water(x + (k & 1 ? 0.45 : -0.45) * FINENESS, y + (k & 2 ? 0.45 : -0.45) * FINENESS);
          whole = w !== null && Math.abs(w - z) < 4;
        }
        if (whole) water.push({ x, y, z, seed: hash(this.roomHash, c, r, 7) * 100 });
      }
    this.water = water;
  }

  /** One quad a puddle, lit where it lies and fading toward the edge of the area */
  private build(v: { x: number; y: number }): void {
    const room = this.room!;
    const n = this.puddles.length;
    const pos = new Float32Array(n * 18),
      uv = new Float32Array(n * 12),
      seed = new Float32Array(n * 6),
      light = new Float32Array(n * 18),
      fade = new Float32Array(n * 6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    this.puddles.forEach((p, i) => {
      const [lr, lg, lb] = room.light(p.x, p.y, p.z);
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      const f = d < fadeFrom() ? 1 : Math.max(0, 1 - (d - fadeFrom()) / (radius() - fadeFrom()));
      const cos = Math.cos(p.turn),
        sin = Math.sin(p.turn);
      corners.forEach(([u, w], k) => {
        const lx = u * p.rx,
          ly = w * p.ry;
        const x = p.x + lx * cos - ly * sin,
          y = p.y + lx * sin + ly * cos;
        const j = i * 6 + k;
        pos.set([x / FINENESS, p.z / FINENESS, y / FINENESS], j * 3);
        uv.set([u, w], j * 2);
        seed[j] = p.seed;
        light.set([lr, lg, lb], j * 3);
        fade[j] = f;
      });
    });
    const g = this.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aLight", new THREE.BufferAttribute(light, 3));
    g.setAttribute("aFade", new THREE.BufferAttribute(fade, 1));
    g.setDrawRange(0, n * 6);
    this.buildWater(v);
  }

  /** One quad a square of water, lit where it lies and fading toward the edge of the area */
  private buildWater(v: { x: number; y: number }): void {
    const room = this.room!;
    const n = this.water.length;
    const pos = new Float32Array(n * 18),
      uv = new Float32Array(n * 12),
      seed = new Float32Array(n * 6),
      light = new Float32Array(n * 18),
      fade = new Float32Array(n * 6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    const half = FINENESS / 2;
    this.water.forEach((q, i) => {
      const [lr, lg, lb] = room.light(q.x, q.y, q.z);
      const d = Math.hypot(q.x - v.x, q.y - v.y);
      const f = d < WATER_FADE_FROM ? 1 : Math.max(0, 1 - (d - WATER_FADE_FROM) / (WATER_RADIUS - WATER_FADE_FROM));
      corners.forEach(([u, w], k) => {
        const j = i * 6 + k;
        pos.set([(q.x + u * half) / FINENESS, q.z / FINENESS, (q.y + w * half) / FINENESS], j * 3);
        uv.set([u, w], j * 2);
        seed[j] = q.seed;
        light.set([lr, lg, lb], j * 3);
        fade[j] = f;
      });
    });
    const g = this.waterGeometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aLight", new THREE.BufferAttribute(light, 3));
    g.setAttribute("aFade", new THREE.BufferAttribute(fade, 1));
    g.setDrawRange(0, n * 6);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.waterGeometry.dispose();
    this.waterMaterial.dispose();
  }
}
