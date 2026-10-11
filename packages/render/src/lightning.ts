// Ours: lightning far off in a storm. While it rains under open sky, now and then a bolt forks
// down out of the clouds in the distance, flickers a few times, and the sky and the view light up
// with it. The bolt is a jagged line made up for each strike, set well away from the eye in some
// direction (so buildings and the room's walls in front hide its lower part), drawn after the
// sky and without fog. `flash` says how bright the sky is lit now (0..1), for the scene to use.
//
// Positions are scene units (squares: X east, Y up, Z south), about the camera.

import * as THREE from "three";

/** How far off and how high strikes come down, in squares */
const DISTANCE_MIN = 45,
  DISTANCE_MAX = 70;
const TOP = 45;
/** Half the bolt's width, squares */
const BOLT_WIDTH = 0.18;
/** Seconds between strikes */
const GAP_MIN = 5,
  GAP_MAX = 18;
/** A strike's flickers: [on ms, off ms] */
const FLICKERS: [number, number][][] = [
  [[70, 60], [110, 0]],
  [[60, 50], [50, 80], [140, 0]],
  [[120, 0]],
];

interface Strike {
  /** ms into the strike */
  t: number;
  /** When each flicker turns on and off */
  steps: { on: number; off: number }[];
  end: number;
}

export class Lightning {
  readonly group = new THREE.Group();
  private readonly bolt: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private nextMs = 3000;
  private strike: Strike | null = null;
  /** How bright the sky is lit now, 0..1 */
  flash = 0;
  /** The last strike not yet heard: which way from the eye (radians, scene X toward Z) and how far (squares) */
  private struck: { yaw: number; distance: number } | null = null;

  /** A strike since the last call, for its thunder, or null */
  takeStrike(): { yaw: number; distance: number } | null {
    const s = this.struck;
    this.struck = null;
    return s;
  }

  constructor() {
    this.group.name = "lightning";
    this.bolt = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.93, 1), depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
    // A soft glow about the bolt, in the clouds
    const N = 64;
    const px = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2));
        const a = Math.pow(1 - r, 2.2);
        px.set([170 + 50 * (1 - r), 185 + 45 * (1 - r), 255, Math.round(230 * a)], (y * N + x) * 4);
      }
    const tex = new THREE.DataTexture(px, N, N);
    tex.needsUpdate = true;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.group.add(this.glow);
    this.group.visible = false;
  }

  /**
   * @param storm whether lightning can strike (raining under open sky)
   * @param eye the camera's position, which the strikes are placed about
   */
  update(dt: number, storm: boolean, eye: THREE.Vector3): void {
    this.group.position.copy(eye);
    if (!this.strike) {
      this.flash = Math.max(0, this.flash - dt / 200);
      this.group.visible = false;
      if (!storm) return;
      if ((this.nextMs -= dt) > 0) return;
      this.nextMs = (GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)) * 1000;
      this.begin();
    }
    const s = this.strike!;
    s.t += dt;
    const lit = s.steps.some((f) => s.t >= f.on && s.t < f.off);
    this.group.visible = lit;
    // The sky stays a little lit between flickers, then fades
    this.flash = lit ? 1 : Math.max(0, this.flash - dt / 120);
    if (s.t >= s.end) this.strike = null;
  }

  /** A new bolt somewhere off in the distance */
  private begin(): void {
    const yaw = Math.random() * 2 * Math.PI;
    const d = DISTANCE_MIN + Math.random() * (DISTANCE_MAX - DISTANCE_MIN);
    this.struck = { yaw, distance: d };
    const bx = Math.cos(yaw) * d,
      bz = Math.sin(yaw) * d;
    // Down from the clouds in jagged steps, with a fork or two, as a ribbon facing the eye
    // (thinner for the forks)
    const px = -Math.sin(yaw),
      pz = Math.cos(yaw);
    const pts: number[] = [];
    const branch = (x: number, y: number, z: number, bottom: number, spread: number, depth: number) => {
      const w = BOLT_WIDTH / (depth + 1);
      while (y > bottom) {
        const step = 1.5 + Math.random() * 3;
        const nx = x + (Math.random() - 0.5) * spread,
          nz = z + (Math.random() - 0.5) * spread,
          ny = y - step;
        const a = [x - px * w, y, z - pz * w],
          b = [x + px * w, y, z + pz * w],
          c = [nx + px * w, ny, nz + pz * w],
          d = [nx - px * w, ny, nz - pz * w];
        pts.push(...a, ...b, ...c, ...a, ...c, ...d);
        if (depth < 2 && Math.random() < 0.12) branch(nx, ny, nz, ny - 6 - Math.random() * 10, spread * 0.8, depth + 1);
        x = nx;
        y = ny;
        z = nz;
      }
    };
    branch(bx, TOP, bz, -4, 3.2, 0);
    const g = this.bolt.geometry;
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.computeBoundingSphere();
    this.glow.position.set(bx, TOP - 4, bz);
    this.glow.scale.setScalar(30);
    const pattern = FLICKERS[Math.floor(Math.random() * FLICKERS.length)];
    const steps: Strike["steps"] = [];
    let t = 0;
    for (const [on, off] of pattern) {
      steps.push({ on: t, off: t + on });
      t += on + off;
    }
    this.strike = { t: 0, steps, end: t + 150 };
  }

  /** Stop at once (left the room, or the rain stopped) */
  clear(): void {
    this.strike = null;
    this.flash = 0;
    this.group.visible = false;
  }

  dispose(): void {
    this.bolt.geometry.dispose();
    (this.bolt.material as THREE.Material).dispose();
    this.glow.material.map?.dispose();
    this.glow.material.dispose();
  }
}
