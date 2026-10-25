// Ours (the spell revamp, phase 9, visuals): short-lived spell effects in the world, for Enhanced
// Visuals. Sparks (one additive point cloud), rings on the floor, and passing lights (pushed into
// the room's light list, so a hit lights the walls about it) and a room-wide flash. The scene
// drives it: UC_SPELL_FX from our server (@shards/world spellFx.ts), and projectiles' trails and
// arrivals, which the client sees for itself.
//
// Built to cost little (measured 2026-10-25: at the cap, a third to half a millisecond a frame on
// a desktop, mostly the extra lights): the sparks live in flat typed arrays, written straight into
// the GPU buffers, dead ones swapped out, nothing allocated per spark or per frame; only the live
// part of the buffers is uploaded, and nothing at all while it's idle; rings and their materials
// are pooled; points can't grow past MAX_POINT_PX on screen; `budget` thins every burst (phones
// get half), and bursts thin themselves as the cloud fills.
//
// Positions in: client fine units (x east, y south, z up). The scene is X = x, Y = z, Z = y, in
// squares (FINENESS fine units each).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import { dlightScale, lightColor, type LightSource } from "./objectLighting.ts";

/** At most this many sparks at once; past it, new ones are dropped */
const MAX_SPARKS = 1024;
/** At most this many passing lights, so the room's own keep their places (MAX_LIGHTS is 32) */
const MAX_FLASHES = 4;
/** Hits closer than this (fine units) in the same moment share one light */
const FLASH_MERGE = FINENESS;
/** No passing light farther than this from the eye (fine units): it would hardly show */
const FLASH_RANGE = 14 * FINENESS;
/** At most this many rings at once */
const MAX_RINGS = 8;
/** A spark is never drawn wider than this on screen, so one close to the eye can't fill it */
const MAX_POINT_PX = 48;

export interface FinePoint {
  x: number;
  y: number;
  z: number;
}

interface Flash {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  scale: number;
  life: number;
  span: number;
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  span: number;
  from: number;
  to: number;
}

const VERTEX = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uMaxPx;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uMaxPx, aSize * uScale / max(0.05, -mv.z));
  }
`;
const FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = 1.0 - smoothstep(0.15, 0.5, length(d));
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
  }
`;

/** A colour from the server's 5:5:5 (as lights are), 0..1, as bright as it goes */
export function fxColor(c: number): { r: number; g: number; b: number } {
  const out = new Float32Array(3);
  fxColorInto(c, out);
  return { r: out[0], g: out[1], b: out[2] };
}

/** fxColor into `out`, allocating nothing */
function fxColorInto(c: number, out: Float32Array): void {
  const r = ((c >> 10) & 31) / 31,
    g = ((c >> 5) & 31) / 31,
    b = (c & 31) / 31;
  const m = Math.max(r, g, b, 1 / 31);
  out[0] = r / m;
  out[1] = g / m;
  out[2] = b / m;
}

/** The point cloud's buffers and their widths (made once: nothing is allocated per frame) */
const ATTRIBUTES = [["position", 3], ["aColor", 4], ["aSize", 1]] as const;

// Each spark's fields, MAX_SPARKS of each
const F = { X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, LIFE: 6, SPAN: 7, GRAV: 8, SIZE: 9, HX: 10, HY: 11, HZ: 12, HOME: 13 } as const;
const FIELDS = 14;

export class SpellEffects {
  readonly group = new THREE.Group();
  /** 1 everywhere; less thins every burst (the scene sets 0.5 on phones) */
  budget = 1;
  /** Live sparks, the first `count` of each array */
  private count = 0;
  private readonly s = new Float32Array(MAX_SPARKS * FIELDS);
  private readonly rgb = new Float32Array(MAX_SPARKS * 3);
  private readonly flashes: Flash[] = [];
  private readonly rings: Ring[] = [];
  private readonly spareRings: Ring[] = [];
  private readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_SPARKS * 3);
  private readonly colors = new Float32Array(MAX_SPARKS * 4);
  private readonly sizes = new Float32Array(MAX_SPARKS);
  private readonly material: THREE.ShaderMaterial;
  private readonly ringGeometry = new THREE.RingGeometry(0.62, 1, 40);
  private readonly c = new Float32Array(3);
  /** How many sparks the GPU last saw (so going empty uploads nothing more) */
  private drawn = 0;
  /** How bright the whole room is lit by a flash now, 0..1 (the scene raises its exposure) */
  roomFlash = 0;

  constructor() {
    this.group.name = "spellEffects";
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 300 }, uMaxPx: { value: MAX_POINT_PX } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.group.add(this.points);
  }

  /** Points size by the view's height and field of view, as WeatherParticles' flakes do */
  setView(viewportHeight: number, fovDegrees: number, pixelRatio = 1): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
    this.material.uniforms.uMaxPx.value = MAX_POINT_PX * pixelRatio;
  }

  get active(): boolean {
    return this.count > 0 || this.flashes.length > 0 || this.rings.length > 0 || this.roomFlash > 0;
  }

  /** Live sparks (tests, the dev tools) */
  get sparkCount(): number {
    return this.count;
  }

  /** Passing lights now (tests, the dev tools) */
  get flashCount(): number {
    return this.flashes.length;
  }

  // ---- what spells call for ----

  /** A hit: a burst of sparks and a quick light. size 1 small, 2 normal, 3 large */
  impact(at: FinePoint, color: number, size = 2, eye?: FinePoint): void {
    fxColorInto(color, this.c);
    const n = this.thin(size === 1 ? 10 : size === 3 ? 48 : 28);
    const speed = size === 1 ? 0.7 : size === 3 ? 2 : 1.4;
    const x = at.x / FINENESS,
      y = at.z / FINENESS,
      z = at.y / FINENESS;
    // a bright core where it strikes, gone in a blink
    this.spark(x, y, z, 0, 0, 0, 0.16, 0, size === 1 ? 0.35 : size === 3 ? 0.9 : 0.6);
    for (let i = 0; i < n; i++) {
      const sp = speed * (0.4 + Math.random() * 0.6);
      const u = Math.random() * 2 - 1,
        a = Math.random() * Math.PI * 2,
        r = Math.sqrt(1 - u * u);
      this.spark(x, y, z, r * Math.cos(a) * sp, u * sp + 0.4 * speed, r * Math.sin(a) * sp, 0.35 + Math.random() * 0.4, 2.5, 0.1 + Math.random() * 0.05);
    }
    this.flash(at, color, size === 1 ? 60 : size === 3 ? 200 : 120, size === 1 ? 0.18 : 0.3, eye);
  }

  /** A projectile landing (it has no message of its own: the scene sees it go) */
  arrival(at: FinePoint, color: number, eye?: FinePoint): void {
    this.impact(at, color, 2, eye);
  }

  /** Life drawn from `from` (the victim) to `to` (the caster): a stream of motes flowing back */
  drain(from: FinePoint, to: FinePoint, color: number, eye?: FinePoint): void {
    fxColorInto(color, this.c);
    const x = from.x / FINENESS,
      y = from.z / FINENESS,
      z = from.y / FINENESS;
    const n = this.thin(18);
    for (let i = 0; i < n; i++) {
      const k = this.spark(x, y, z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.3, 0, 0.06);
      if (k >= 0) {
        const o = k * FIELDS;
        this.s[o + F.HX] = to.x / FINENESS;
        this.s[o + F.HY] = to.z / FINENESS;
        this.s[o + F.HZ] = to.y / FINENESS;
        this.s[o + F.HOME] = 1;
      }
    }
    this.flash(from, color, 90, 0.3, eye);
  }

  /** A glow about a caster: a light and a few rising motes */
  cast(at: FinePoint, color: number, eye?: FinePoint): void {
    fxColorInto(color, this.c);
    const x = at.x / FINENESS,
      y = at.z / FINENESS,
      z = at.y / FINENESS;
    const n = this.thin(10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spark(x + Math.cos(a) * 0.25, y, z + Math.sin(a) * 0.25, 0, 0.5 + Math.random() * 0.4, 0, 0.5, -0.2, 0.05);
    }
    this.flash(at, color, 90, 0.4, eye);
  }

  /** A pulse on the floor about a target: a blessing, a curse or a heal */
  pulse(feet: FinePoint, color: number, kind: "buff" | "curse" | "heal"): void {
    fxColorInto(color, this.c);
    const dim = kind === "curse" ? 0.6 : 1;
    this.ring(feet, this.c[0] * dim, this.c[1] * dim, this.c[2] * dim, 0.2, kind === "curse" ? 0.8 : 1.1, 0.7);
    const x = feet.x / FINENESS,
      y = feet.z / FINENESS,
      z = feet.y / FINENESS;
    const n = this.thin(kind === "heal" ? 16 : 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.35;
      // a blessing and a heal rise; a curse sinks
      const up = kind === "curse" ? -0.25 : 0.6 + Math.random() * 0.5;
      this.spark(x + Math.cos(a) * r, y + (kind === "curse" ? 1.2 : 0.1), z + Math.sin(a) * r, 0, up, 0, 0.8, 0, 0.05);
    }
  }

  /** Dust about a point (Earthquake): slow, dim puffs and a ring along the floor */
  quake(feet: FinePoint, color: number): void {
    fxColorInto(color, this.c);
    const r0 = this.c[0],
      g0 = this.c[1],
      b0 = this.c[2];
    // dust mustn't glow: additive blending makes anything bright look like fire
    this.c[0] = r0 * 0.22;
    this.c[1] = g0 * 0.18;
    this.c[2] = b0 * 0.14;
    const x = feet.x / FINENESS,
      y = feet.z / FINENESS,
      z = feet.y / FINENESS;
    const n = this.thin(60);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 3;
      this.spark(x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r, Math.cos(a) * 0.3, 0.3 + Math.random() * 0.5, Math.sin(a) * 0.3, 1.2 + Math.random() * 0.6, 0.1, 0.3);
    }
    this.ring(feet, r0 * 0.5, g0 * 0.4, b0 * 0.3, 0.3, 4, 0.9);
  }

  /** The room lights up at once (Lightning Bolt) */
  flashRoom(): void {
    this.roomFlash = 1;
  }

  /** A projectile in flight leaves a short trail of its light's colour */
  trail(at: FinePoint, color: number, dt: number): void {
    fxColorInto(color, this.c);
    const x = at.x / FINENESS,
      y = at.z / FINENESS,
      z = at.y / FINENESS;
    // about 60 motes a second, whatever the frame rate (fewer as the cloud fills)
    let n = Math.max(1, Math.round((dt / 1000) * 60 * this.budget * this.headroom()));
    while (n-- > 0) this.spark(x, y, z, (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.16, 0.25 + Math.random() * 0.15, 0, 0.05);
  }

  // ---- each frame ----

  /** Moves everything on by dt milliseconds */
  update(dt: number): void {
    const t = dt / 1000;
    const s = this.s;
    let i = 0;
    while (i < this.count) {
      const o = i * FIELDS;
      const life = s[o + F.LIFE] - t;
      if (life <= 0) {
        // swap the last one in, and look at it next
        this.removeSpark(i);
        continue;
      }
      s[o + F.LIFE] = life;
      if (s[o + F.HOME]) {
        // drawn home: steer toward it, faster as it goes
        const k = Math.min(1, t * 6);
        s[o + F.VX] += ((s[o + F.HX] - s[o + F.X]) * 4 - s[o + F.VX]) * k;
        s[o + F.VY] += ((s[o + F.HY] - s[o + F.Y]) * 4 - s[o + F.VY]) * k;
        s[o + F.VZ] += ((s[o + F.HZ] - s[o + F.Z]) * 4 - s[o + F.VZ]) * k;
      }
      s[o + F.VY] -= s[o + F.GRAV] * t;
      s[o + F.X] += s[o + F.VX] * t;
      s[o + F.Y] += s[o + F.VY] * t;
      s[o + F.Z] += s[o + F.VZ] * t;
      i++;
    }
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k];
      f.life -= t;
      if (f.life <= 0) this.flashes.splice(k, 1);
    }
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.life -= t;
      if (r.life <= 0) {
        r.mesh.visible = false;
        this.spareRings.push(r);
        this.rings.splice(k, 1);
        continue;
      }
      const p = 1 - r.life / r.span;
      const scale = r.from + (r.to - r.from) * p;
      r.mesh.scale.set(scale, scale, scale);
      r.material.opacity = 1 - p;
    }
    this.roomFlash = Math.max(0, this.roomFlash - t / 0.35);
    this.writeBuffers();
  }

  /** Puts the passing lights at the front of `lights` (the room's list; client fine units) */
  addLights(lights: LightSource[]): void {
    for (const f of this.flashes) {
      const k = f.life / f.span;
      lights.unshift({ x: f.x, y: f.y, z: f.z, scale: dlightScale(f.scale) * (0.5 + 0.5 * k), r: f.r * k, g: f.g * k, b: f.b * k, moving: true });
    }
  }

  clear(): void {
    this.count = 0;
    this.flashes.length = 0;
    for (const r of this.rings) {
      r.mesh.visible = false;
      this.spareRings.push(r);
    }
    this.rings.length = 0;
    this.roomFlash = 0;
    this.writeBuffers();
  }

  dispose(): void {
    this.clear();
    for (const r of this.spareRings) r.material.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
    this.ringGeometry.dispose();
  }

  // ---- inside ----

  /** How many of n to make: the budget, and fewer as the cloud fills (none at the cap) */
  private thin(n: number): number {
    return Math.round(n * this.budget * this.headroom());
  }

  /** 1 while the cloud is under half full, falling to 0 at the cap */
  private headroom(): number {
    const fill = this.count / MAX_SPARKS;
    return fill < 0.5 ? 1 : Math.max(0, (1 - fill) * 2);
  }

  /** A new spark in this.c's colour; its index, or -1 when the cloud is full */
  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, gravity: number, size: number): number {
    if (this.count >= MAX_SPARKS) return -1;
    const k = this.count++;
    const o = k * FIELDS;
    const s = this.s;
    s[o + F.X] = x;
    s[o + F.Y] = y;
    s[o + F.Z] = z;
    s[o + F.VX] = vx;
    s[o + F.VY] = vy;
    s[o + F.VZ] = vz;
    s[o + F.LIFE] = life;
    s[o + F.SPAN] = life;
    s[o + F.GRAV] = gravity;
    s[o + F.SIZE] = size;
    s[o + F.HOME] = 0;
    this.rgb[k * 3] = this.c[0];
    this.rgb[k * 3 + 1] = this.c[1];
    this.rgb[k * 3 + 2] = this.c[2];
    return k;
  }

  private removeSpark(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.s.copyWithin(i * FIELDS, last * FIELDS, last * FIELDS + FIELDS);
    this.rgb.copyWithin(i * 3, last * 3, last * 3 + 3);
  }

  /**
   * A passing light, unless it's too far from the eye to matter; hits close together share one
   * (the brighter, the longer)
   */
  private flash(at: FinePoint, color: number, intensity: number, life: number, eye?: FinePoint): void {
    if (eye && Math.hypot(at.x - eye.x, at.y - eye.y) > FLASH_RANGE) return;
    for (const f of this.flashes)
      if (Math.abs(f.x - at.x) < FLASH_MERGE && Math.abs(f.y - at.y) < FLASH_MERGE && f.life > f.span * 0.5) {
        f.scale = Math.max(f.scale, intensity);
        f.life = f.span = Math.max(f.life, life);
        return;
      }
    if (this.flashes.length >= MAX_FLASHES) this.flashes.shift();
    const l = lightColor(color);
    this.flashes.push({ x: at.x, y: at.y, z: at.z, r: l.r, g: l.g, b: l.b, scale: intensity, life, span: life });
  }

  private ring(feet: FinePoint, r: number, g: number, b: number, from: number, to: number, life: number): void {
    let ring = this.spareRings.pop();
    if (!ring) {
      if (this.rings.length >= MAX_RINGS) return;
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      // flat on the floor
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      ring = { mesh, material, life, span: life, from, to };
    }
    ring.material.color.setRGB(r, g, b);
    ring.material.opacity = 1;
    ring.mesh.position.set(feet.x / FINENESS, feet.z / FINENESS + 0.02, feet.y / FINENESS);
    ring.mesh.scale.set(from, from, from);
    ring.mesh.visible = true;
    ring.life = ring.span = life;
    ring.from = from;
    ring.to = to;
    this.rings.push(ring);
  }

  /** Writes the live sparks into the GPU buffers, uploading only that much (nothing when idle) */
  private writeBuffers(): void {
    const n = this.count;
    if (n === 0 && this.drawn === 0) return;
    const s = this.s;
    for (let i = 0; i < n; i++) {
      const o = i * FIELDS;
      this.positions[i * 3] = s[o + F.X];
      this.positions[i * 3 + 1] = s[o + F.Y];
      this.positions[i * 3 + 2] = s[o + F.Z];
      this.colors[i * 4] = this.rgb[i * 3];
      this.colors[i * 4 + 1] = this.rgb[i * 3 + 1];
      this.colors[i * 4 + 2] = this.rgb[i * 3 + 2];
      // fade out over the last half of its life
      this.colors[i * 4 + 3] = Math.min(1, (s[o + F.LIFE] / s[o + F.SPAN]) * 2);
      this.sizes[i] = s[o + F.SIZE];
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0)
      for (const [name, size] of ATTRIBUTES) {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * size);
        a.needsUpdate = true;
      }
    this.drawn = n;
  }
}
