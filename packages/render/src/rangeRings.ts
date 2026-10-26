// Ours (the spell revamp's phase 9, V5; shards-server's design page): range rings. A soft band
// of the spell's school's colour on the ground, as far from its centre as the spell reaches:
// a song's for as long as it plays (following its centre), and a spell's we point at before
// we cast it. They lie on the floor (each point at the floor's height there), break where the
// floor jumps (a ledge, a wall), and fade in and out. Only ever our own (the server sends
// them to the caster alone). Enhanced Visuals only.

import * as THREE from "three";
import { FINENESS } from "@shards/formats";
import { fxColor } from "./spellEffects.ts";

export interface RangeRing {
  /** The centre, fine units */
  x: number;
  y: number;
  /** Fine units; inner 0 for none (a fainter second ring: Earthquake's full damage) */
  radius: number;
  inner: number;
  /** 5:5:5 */
  color: number;
}

/** The floor's height at a point, fine units; null where there's no floor (outside the map) */
export type FloorAt = (x: number, y: number) => number | null;

/**
 * The band, in squares: the line (wider for a wider ring, as it's seen from farther off and
 * edge on; a buff's ring about us, seen close, stays fine), and a glow fading inward from it
 * (a share of the ring's radius, up to GLOW); and how far above the floor it lies
 */
const LINE_MIN = 0.06;
const LINE_MAX = 0.45;
const LINE_PER_SQUARE = 0.025;
const GLOW = 0.9;
const GLOW_PER_SQUARE = 0.15;
const GLOW_ALPHA = 0.35;
const LIFT = 0.06;
/** Where the floor jumps more than this between two points of a ring (squares), the ring breaks */
const BREAK = 0.6;
/** Points per square of circumference, and the fewest and most a ring has */
const PER_SQUARE = 2;
const MIN_SEGMENTS = 48;
const MAX_SEGMENTS = 360;
/** Fade in and out, ms */
const FADE_MS = 250;
/** A moving ring slides along; its points are laid on the floor again once it's moved this far (fine units) */
const REBUILD_MOVE = 512;
/** How bright, the inner ring as a share of the outer */
const ALPHA = 0.85;
const INNER_ALPHA = 0.6;

interface Shown {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: RangeRing;
  /** What it was built for */
  builtX: number;
  builtY: number;
  builtRadius: number;
  /** 0..1 */
  fade: number;
  wanted: boolean;
}

export class RangeRings {
  readonly group = new THREE.Group();
  private readonly shown = new Map<string, Shown>();
  private time = 0;

  constructor() {
    this.group.name = "rangeRings";
  }

  /** Rings on now */
  get count(): number {
    return this.shown.size;
  }

  /**
   * One frame: the rings wanted now, by key; any no longer wanted fade out. `floor` gives
   * the floor's height for their points.
   */
  update(wanted: ReadonlyMap<string, RangeRing>, dtMs: number, floor: FloorAt): void {
    this.time += dtMs;
    for (const s of this.shown.values()) s.wanted = false;
    for (const [key, ring] of wanted) {
      let s = this.shown.get(key);
      if (!s) {
        // (pulled toward the eye in the depth test: seen edge on from afar, it would sink into the floor)
        const material = new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16,
        });
        s = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), material), ring, builtX: NaN, builtY: NaN, builtRadius: -1, fade: 0, wanted: true };
        s.mesh.frustumCulled = false;
        s.mesh.renderOrder = 2;
        this.group.add(s.mesh);
        this.shown.set(key, s);
      }
      s.wanted = true;
      const moved = Math.hypot(ring.x - s.builtX, ring.y - s.builtY);
      if (!(moved < REBUILD_MOVE) || ring.radius !== s.builtRadius || ring.inner !== s.ring.inner || ring.color !== s.ring.color) {
        s.ring = ring;
        this.build(s, floor);
      }
      s.ring = ring;
      s.mesh.position.set((ring.x - s.builtX) / FINENESS, 0, (ring.y - s.builtY) / FINENESS);
    }
    for (const [key, s] of this.shown) {
      s.fade = Math.max(0, Math.min(1, s.fade + (s.wanted ? 1 : -1) * (dtMs / FADE_MS)));
      if (!s.wanted && s.fade <= 0) {
        this.group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shown.delete(key);
        continue;
      }
      // a slow breath, so it reads as something living rather than a decal
      s.mesh.material.opacity = s.fade * (0.85 + 0.15 * Math.sin(this.time / 450));
    }
  }

  /** The band's triangles: per segment, a quad each side of the line (bright on it, clear at its edges) */
  private build(s: Shown, floor: FloorAt): void {
    const { ring } = s;
    s.builtX = ring.x;
    s.builtY = ring.y;
    s.builtRadius = ring.radius;
    const c = fxColor(ring.color);
    const pos: number[] = [];
    const col: number[] = [];
    const centreZ = floor(ring.x, ring.y) ?? 0;
    const circle = (radius: number, alpha: number) => {
      if (radius <= 0) return;
      const squares = radius / FINENESS;
      const n = Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.round(2 * Math.PI * squares * PER_SQUARE)));
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * 2 * Math.PI;
        const x = ring.x + Math.cos(a) * radius,
          y = ring.y + Math.sin(a) * radius;
        pts.push({ x, y, z: floor(x, y) ?? centreZ });
      }
      const half = (Math.min(LINE_MAX, Math.max(LINE_MIN, squares * LINE_PER_SQUARE)) / 2) * FINENESS;
      const glow = Math.min(GLOW, squares * GLOW_PER_SQUARE) * FINENESS;
      for (let i = 0; i < n; i++) {
        const p = pts[i],
          q = pts[i + 1];
        if (Math.abs(p.z - q.z) > BREAK * FINENESS) continue;
        // four rows: outside the line (clear), the line (bright), its inner edge (the glow), the glow's end (clear)
        const rows = (pt: { x: number; y: number; z: number }) => {
          const dx = (pt.x - ring.x) / radius,
            dy = (pt.y - ring.y) / radius;
          const z = pt.z / FINENESS + LIFT;
          const at = (d: number, a: number) => [(pt.x + dx * d) / FINENESS, z, (pt.y + dy * d) / FINENESS, a];
          return [at(half, 0), at(0, alpha), at(-half, alpha * GLOW_ALPHA), at(-half - glow, 0)];
        };
        const a = rows(p),
          b = rows(q);
        for (const [r0, r1] of [
          [0, 1],
          [1, 2],
          [2, 3],
        ]) {
          for (const v of [a[r0], a[r1], b[r1], a[r0], b[r1], b[r0]]) {
            pos.push(v[0], v[1], v[2]);
            col.push(c.r, c.g, c.b, v[3]);
          }
        }
      }
    };
    circle(ring.radius, ALPHA);
    circle(ring.inner, ALPHA * INNER_ALPHA);
    const g = s.mesh.geometry;
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    g.computeBoundingSphere();
  }

  clear(): void {
    for (const s of this.shown.values()) {
      this.group.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this.shown.clear();
  }

  dispose(): void {
    this.clear();
  }
}
