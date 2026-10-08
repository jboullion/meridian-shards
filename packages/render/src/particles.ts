// Weather and fireworks (clientd3d/d3dparticle.c, drawn by d3drender.c "PARTICLES"):
// rain, sand and fireworks as short lines that fade along their velocity, snow as small
// textured squares. Each kind is a set of emitters around the player, which follow the
// player as they move (D3DParticleSystemSetPlayerPos). Particles under a ceiling or below
// the floor die (PS_WEATHER_EFFECT, PS_GROUND_DESTROY), so it only rains outdoors.
//
// The original steps every particle once per frame it draws, and caps its frame rate at
// 70 (config.ini MaxFPS); we step at a steady 70 per second.
//
// Positions are client fine units (x east, y south, z up).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";

export const PARTICLE_STEPS_PER_SECOND = 70;

/** d3dparticle.c MAX_PARTICLES, SNOW_SIZE_HALF */
const MAX_PARTICLES = 256;
const MAX_FIREWORK_PARTICLES = 512;
const SNOW_SIZE = 48;

/** d3dparticle.h PS_* */
const PS = {
  RANDOM_XY: 0x1,
  RANDOM_Z: 0x2,
  GROUND_DESTROY: 0x80,
  WEATHER_EFFECT: 0x100,
  GRAVITY: 0x200,
} as const;

/** The room under the particles (client3d.c GetPointFloor and friends); null outside the map. */
export interface ParticleRoom {
  /** Floor height, or -1 outside every sector */
  floor(x: number, y: number): number;
  /** Ceiling height, or -1 outside every sector */
  ceiling(x: number, y: number): number;
  /** Whether a ceiling texture is overhead (indoors) */
  roofed(x: number, y: number): boolean;
}

/** MSVC rand(): 0..32767 */
const rand = (): number => (Math.random() * 32768) | 0;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Particle {
  energy: number;
  /** Passed D3DParticleIsAlive in the last step, so the renderer got it (a respawned one waits a step) */
  shown: boolean;
  pos: Vec3;
  velocity: Vec3;
  rotation: Vec3;
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Emitter {
  numParticles: number;
  numAlive: number;
  maxParticles: number;
  energy: number;
  timer: number;
  timerBase: number;
  randomPos: number;
  randomRot: number;
  flags: number;
  pos: Vec3;
  velocity: Vec3;
  rotation: Vec3;
  r: number;
  g: number;
  b: number;
  a: number;
  particles: Particle[];
}

const newParticle = (): Particle => ({ energy: 0, shown: false, pos: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, r: 0, g: 0, b: 0, a: 0 });

type Kind = "sand" | "rain" | "snow" | "fireworks";

/** d3dparticle.c D3DParticleEmitterInit */
function emitter(
  pos: [number, number, number], vel: [number, number, number], rgba: [number, number, number, number], energy: number, timerBase: number,
  rot: [number, number, number], randomPos: number, randomRot: number, maxParticles: number, flags: number, density: number,
): Emitter | null {
  // User can choose how many particles to display.
  const max = Math.trunc((maxParticles * density) / 100);
  if (max <= 0) return null;
  return {
    numParticles: 0, numAlive: 0, maxParticles: max, energy, timer: timerBase, timerBase, randomPos, randomRot, flags,
    pos: { x: pos[0], y: pos[1], z: pos[2] }, velocity: { x: vel[0], y: vel[1], z: vel[2] }, rotation: { x: rot[0], y: rot[1], z: rot[2] },
    r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3],
    particles: Array.from({ length: max }, newParticle),
  };
}

const SAND: [number, number, number, number] = [226, 153, 6, 255];
const RAIN: [number, number, number, number] = [175, 228, 249, 100];
const SNOW: [number, number, number, number] = [255, 255, 255, 220];

/** d3dparticle.c SandstormInit: 12 emitters around the player blowing inwards, twice */
function sandEmitters(density: number): Emitter[] {
  const R = 12;
  const rot: [number, number, number] = [0, -Math.PI / 500, -Math.PI / 500];
  const flags = PS.RANDOM_XY | PS.RANDOM_Z;
  const set: [number, number, number, number][] = [
    [R * -724, R * -724, 0, 500], [R * -724, R * 724, 500, 0], [R * 724, R * 724, 0, -500], [R * 724, R * -724, -500, 0],
    [R * -724, R * -724, 353.55, 353.55], [R * -724, R * 724, 353.55, -353.55], [R * 724, R * 724, -353.55, -353.55], [R * 724, R * -724, -353.55, 353.55],
    [R * -1024, 0, 500, 0], [R * 1024, 0, -500, 0], [0, R * 1024, 0, -500], [0, R * -1024, 0, 500],
  ];
  const out: Emitter[] = [];
  for (let twice = 0; twice < 2; twice++)
    for (const [x, y, vx, vy] of set) {
      const e = emitter([x, y, 0], [vx, vy, 0], SAND, 40, rand() % 240, rot, 1024, 2, MAX_PARTICLES, flags, density);
      if (e) out.push(e);
    }
  return out;
}

/** d3dparticle.c RainInit */
function rainEmitters(density: number): Emitter[] {
  const flags = PS.RANDOM_XY | PS.GROUND_DESTROY | PS.WEATHER_EFFECT;
  const out: Emitter[] = [];
  for (let i = 0; i < 8; i++)
    for (const [z, radius] of [[2500, 16384], [5000, 16384], [2500, 4096]]) {
      const e = emitter([0, 0, z], [0, 0, -300], RAIN, 400, rand() % 240, [0, 0, 0], radius, 0, MAX_PARTICLES, flags, density);
      if (e) out.push(e);
    }
  return out;
}

/** d3dparticle.c SnowInit */
function snowEmitters(density: number): Emitter[] {
  const flags = PS.RANDOM_XY | PS.GROUND_DESTROY | PS.WEATHER_EFFECT;
  const out: Emitter[] = [];
  for (let i = 0; i < 3; i++)
    for (const [vx, z, energy] of [[5, 2500, 4000], [-5, 2500, 4000], [0, 2500, 4000], [0, 2500, 4000], [0, 2500, 4000], [0, 5000, 1333]]) {
      const e = emitter([0, 0, z], [vx, 0, -30], SNOW, energy, rand() % 240, [0, 0, 0], 16384, 0, MAX_PARTICLES, flags, density);
      if (e) out.push(e);
    }
  return out;
}

const fireworksColor = (): [number, number, number, number] => [rand() % 256, rand() % 256, rand() % 256, 220];

/** d3dparticle.c FireworksInit: a row of 12 launch points, east of the room's origin */
function fireworksEmitters(density: number): Emitter[] {
  const out: Emitter[] = [];
  for (let y = -3000; y <= 2500; y += 500) {
    const e = emitter([12000, y, 3600], [5, 5, 0], fireworksColor(), 120, rand() % 120, [0, 0, 0], 512, 0, MAX_FIREWORK_PARTICLES, 0, density);
    if (e) out.push(e);
  }
  return out;
}

/** D3DParticleInitPosSpeed */
function initPosSpeed(e: Emitter, p: Particle, room: ParticleRoom): void {
  let sign = 1;
  p.pos.x = e.pos.x;
  p.pos.y = e.pos.y;
  p.pos.z = e.pos.z;
  if (e.flags & PS.RANDOM_XY) {
    if (rand() & 1) sign = -sign;
    p.pos.x += sign * (rand() % e.randomPos);
    if (rand() & 1) sign = -sign;
    p.pos.y += sign * (rand() % e.randomPos);
  }
  if (e.flags & PS.RANDOM_Z) {
    if (rand() & 1) sign = -sign;
    p.pos.z += sign * (rand() % e.randomPos);
  }
  p.velocity.x = e.velocity.x;
  p.velocity.y = e.velocity.y;
  p.velocity.z = e.velocity.z;
  if (e.flags & PS.WEATHER_EFFECT) {
    p.velocity.z *= (rand() % 11 + 5) / 10;
    if (rand() & 1) p.pos.z = room.ceiling(p.pos.x, p.pos.y);
  }
}

/** D3DParticleInitPosSpeedSphere (with its quadrant quirks; the angle is in degrees but used as radians) */
function initPosSpeedSphere(e: Emitter, p: Particle): void {
  const angle = rand() % 360;
  const speed = rand() % 9;
  p.pos.x = e.pos.x;
  p.pos.y = e.pos.y;
  p.pos.z = e.pos.z;
  p.velocity.z = (rand() % 11) - 5;
  const c = Math.cos(angle) * speed,
    s = Math.sin(angle) * speed;
  if (angle < 90) [p.velocity.x, p.velocity.y] = [c, s];
  else if (angle < 180) [p.velocity.x, p.velocity.y] = [-c, s];
  else if (angle < 270) [p.velocity.x, p.velocity.y] = [c, -s];
  else [p.velocity.x, p.velocity.y] = [-c, s];
}

/** D3DParticleInitRotation */
function initRotation(e: Emitter, p: Particle): void {
  p.rotation.x = e.rotation.x;
  p.rotation.y = e.rotation.y;
  p.rotation.z = e.rotation.z;
  if (!e.randomRot) return;
  let sign = 1;
  for (const axis of ["x", "y", "z"] as const) {
    let random = rand() % e.randomRot;
    if (random <= 1) random = 2;
    if (rand() & 1) sign = -sign;
    p.rotation[axis] += e.rotation[axis] * random * sign;
    p.pos[axis] += rand() % FINENESS;
  }
}

/** D3DParticleInitColorEnergy */
function initColorEnergy(e: Emitter, p: Particle): void {
  p.r = e.r;
  p.g = e.g;
  p.b = e.b;
  p.a = e.a;
  p.energy = e.energy;
  e.numParticles++;
  e.numAlive++;
}

/** D3DParticleIsAlive: spends a unit of energy; weather dies indoors, some die in the ground */
function isAlive(e: Emitter, p: Particle, room: ParticleRoom): boolean {
  if (p.energy === 0) return false;
  if (--p.energy <= 0) {
    p.energy = 0;
    e.numAlive--;
    return false;
  }
  if (e.flags & PS.WEATHER_EFFECT && room.roofed(p.pos.x, p.pos.y)) {
    p.energy = 0;
    e.numAlive--;
    return false;
  }
  if (e.flags & PS.GROUND_DESTROY && p.pos.z < room.floor(p.pos.x, p.pos.y)) {
    p.energy = 0;
    e.numAlive--;
    return false;
  }
  return true;
}

/** D3DParticleVelocityUpdate: gravity, then the velocity turned by the rotation (row vectors: v Rx Ry Rz) */
function velocityUpdate(e: Emitter, p: Particle): void {
  if (e.flags & PS.GRAVITY) p.velocity.z -= 0.5;
  let { x, y, z } = p.velocity;
  if (p.rotation.x) {
    const c = Math.cos(p.rotation.x), s = Math.sin(p.rotation.x);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (p.rotation.y) {
    const c = Math.cos(p.rotation.y), s = Math.sin(p.rotation.y);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (p.rotation.z) {
    const c = Math.cos(p.rotation.z), s = Math.sin(p.rotation.z);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  p.velocity.x = x;
  p.velocity.y = y;
  p.velocity.z = z;
  p.pos.x += x;
  p.pos.y += y;
  p.pos.z += z;
}

/** D3DParticleRandomizeEmitterPosition */
function randomizeEmitterPosition(e: Emitter): void {
  if (e.pos.x > 0) e.pos.x += rand() & 1 ? rand() % 48 : -(rand() % 48);
  if (e.pos.y > 0) e.pos.y += rand() & 1 ? rand() % 48 : -(rand() % 48);
}

export interface WeatherFlags {
  sand: boolean;
  rain: boolean;
  snow: boolean;
  fireworks: boolean;
}

export class WeatherParticles {
  readonly group = new THREE.Group();
  /** Called when a firework bursts near the start of its flight (firework.ogg at x, y) */
  onFireworkSound?: (x: number, y: number) => void;
  private readonly emitters: Record<Kind, Emitter[]> = { sand: [], rain: [], snow: [], fireworks: [] };
  private readonly lines: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private density = 100;
  /** Without the snow texture, snow is drawn as lines too (pTexture NULL) */
  private readonly snowAsLines: boolean;
  private old = { x: 0, y: 0, z: 0 };

  constructor(snowTexture: THREE.Texture | null) {
    this.snowAsLines = !snowTexture;
    const lineGeo = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.lines.frustumCulled = false;
    const snowGeo = new THREE.BufferGeometry();
    this.snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        map: snowTexture, size: SNOW_SIZE / FINENESS, sizeAttenuation: true, color: 0xffffff, opacity: SNOW[3] / 255,
        transparent: true, alphaTest: 1 / 255, depthWrite: false, toneMapped: false,
      }),
    );
    this.snow.frustumCulled = false;
    this.group.add(this.lines, this.snow);
    this.reset();
  }

  /**
   * The camera's vertical field of view: three.js sizes points by half the screen height
   * (not the focal length), so the snow squares need 1 / tan(fov / 2) to be 48 units wide.
   */
  setFov(fovYDegrees: number): void {
    (this.snow.material as THREE.PointsMaterial).size = SNOW_SIZE / FINENESS / Math.tan((fovYDegrees * Math.PI) / 360);
  }

  /** Particle density % (config.particles); the emitters start over (maindlg.c) */
  setDensity(percent: number): void {
    if (percent === this.density) return;
    this.density = percent;
    this.reset();
  }

  /**
   * D3DParticlesInit(false) on loading a room (bspload.c): new emitters around the room's
   * origin, which the next frame's player movement moves to the player.
   */
  reset(): void {
    this.emitters.sand = sandEmitters(this.density);
    this.emitters.rain = rainEmitters(this.density);
    this.emitters.snow = snowEmitters(this.density);
    this.emitters.fireworks = fireworksEmitters(this.density);
    this.old = { x: 0, y: 0, z: 0 };
  }

  /**
   * One drawn frame: the emitters follow the viewer (D3DParticleSystemSetPlayerPos with
   * the movement since the last frame), then `steps` simulation steps of what's active.
   */
  update(viewer: Vec3, flags: WeatherFlags, steps: number, room: ParticleRoom): void {
    const dx = viewer.x - this.old.x, dy = viewer.y - this.old.y, dz = viewer.z - this.old.z;
    this.old = { ...viewer };
    for (const list of Object.values(this.emitters))
      for (const e of list) {
        e.pos.x += dx;
        e.pos.y += dy;
        e.pos.z += dz;
      }
    for (let i = 0; i < steps; i++) {
      if (flags.sand) this.stepFluid(this.emitters.sand, room);
      if (flags.rain) this.stepFluid(this.emitters.rain, room);
      if (flags.snow) this.stepFluid(this.emitters.snow, room);
      if (flags.fireworks) this.stepBurst(this.emitters.fireworks, room);
    }
    this.draw(flags);
  }

  /** D3DParticleSystemUpdateFluid: dead particles come back as the emitter's timer allows */
  private stepFluid(list: Emitter[], room: ParticleRoom): void {
    for (const e of list)
      for (const p of e.particles) {
        p.shown = false;
        if (!isAlive(e, p, room)) {
          if (--e.timer <= 0) {
            initPosSpeed(e, p, room);
            initRotation(e, p);
            initColorEnergy(e, p);
            e.timer = e.timerBase;
          }
          continue;
        }
        velocityUpdate(e, p);
        p.shown = true;
      }
  }

  /** D3DParticleSystemUpdateBurst: a burst flies until all its particles are spent, then the next */
  private stepBurst(list: Emitter[], room: ParticleRoom): void {
    let playedSound = false;
    for (const e of list) {
      if (e.numParticles >= e.maxParticles && e.numAlive > 0) {
        for (let i = 0; i < e.numParticles; i++) {
          const p = e.particles[i];
          p.shown = false;
          if (!isAlive(e, p, room)) continue;
          p.shown = true;
          if (!playedSound && i === 0 && p.energy === e.energy - 1 && rand() % 2) {
            this.onFireworkSound?.(p.pos.x, p.pos.y);
            playedSound = true;
          }
          velocityUpdate(e, p);
          // 10% chance to dim (unsigned bytes: 0 wraps to 255)
          if (rand() % 10 === 1) {
            p.r = (p.r + 255) & 255;
            p.g = (p.g + 255) & 255;
            p.b = (p.b + 255) & 255;
          }
        }
        randomizeEmitterPosition(e);
      }
      if (--e.timer <= 0) {
        if (e.numAlive <= 0) {
          e.numAlive = 0;
          e.numParticles = 0;
          [e.r, e.g, e.b] = fireworksColor();
          for (const p of e.particles)
            if (p.energy === 0) {
              initPosSpeedSphere(e, p);
              initRotation(e, p);
              initColorEnergy(e, p);
            }
        }
        e.timer = e.timerBase;
      }
    }
  }

  /** D3DParticleAddToRenderer: lines from each particle back along its velocity, fading; snow as squares */
  private draw(flags: WeatherFlags): void {
    const lineKinds = (["sand", "rain", "snow", "fireworks"] as const).filter((k) => flags[k] && (k !== "snow" || this.snowAsLines));
    let n = 0;
    for (const k of lineKinds) for (const e of this.emitters[k]) for (const p of e.particles) if (p.shown && p.energy > 0) n++;
    const pos = this.attribute(this.lines.geometry, "position", n * 2, 3);
    const col = this.attribute(this.lines.geometry, "color", n * 2, 4);
    let i = 0;
    for (const k of lineKinds)
      for (const e of this.emitters[k])
        for (const p of e.particles) {
          if (!p.shown || p.energy <= 0) continue;
          // X = x, Y = z, Z = y, in squares
          pos.array.set([p.pos.x / FINENESS, p.pos.z / FINENESS, p.pos.y / FINENESS], i * 6);
          pos.array.set([(p.pos.x - p.velocity.x) / FINENESS, (p.pos.z - p.velocity.z) / FINENESS, (p.pos.y - p.velocity.y) / FINENESS], i * 6 + 3);
          col.array.set([p.r / 255, p.g / 255, p.b / 255, p.a / 255, p.r / 255, p.g / 255, p.b / 255, 0], i * 8);
          i++;
        }
    pos.needsUpdate = col.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, n * 2);

    let s = 0;
    const squares = flags.snow && !this.snowAsLines;
    if (squares) for (const e of this.emitters.snow) for (const p of e.particles) if (p.shown && p.energy > 0) s++;
    const spos = this.attribute(this.snow.geometry, "position", s, 3);
    let j = 0;
    if (squares)
      for (const e of this.emitters.snow)
        for (const p of e.particles) if (p.shown && p.energy > 0) spos.array.set([p.pos.x / FINENESS, p.pos.z / FINENESS, p.pos.y / FINENESS], j++ * 3);
    spos.needsUpdate = true;
    this.snow.geometry.setDrawRange(0, s);
  }

  /** A buffer attribute with room for `count` items, grown when needed */
  private attribute(g: THREE.BufferGeometry, name: string, count: number, size: number): THREE.BufferAttribute {
    let a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a || a.count < count) {
      a = new THREE.BufferAttribute(new Float32Array(Math.max(count, 64) * 2 * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    return a;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.Material).dispose();
  }
}
