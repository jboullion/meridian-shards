// Three.js scene objects for a room: one mesh per grid texture, drawn with the
// palette + original lighting material (lighting.ts).
//
// Scene units: 1 unit = 1 grid square. Axes: client (x east, y south, z up) maps to
// three (X = x, Y = z, Z = y) / 1024. That mapping mirrors handedness, so triangle
// winding is reversed when copying (roomGeometry winds CCW in client space).

import * as THREE from "three";
import { FINENESS, ceilingHeightAt, floorHeightAt, leafAt, paletteRgba, type Bgf, type Palette, type Room } from "@shards/formats";
import { buildRoomGeometry, type Batch, type RoomGeometry, type TextureInfo } from "./roomGeometry.ts";
import { lightingUniforms, roomFragmentShader, roomVertexShader } from "./lighting.ts";
import { MAX_LIGHTS, type LightSource } from "./objectLighting.ts";
import { colorTexture, paletteToRgba } from "./colorTexture.ts";
import { triangleVisibility, wallsNear } from "./lightOcclusion.ts";
import { bakeAoSteps, surfaceInfo, type AoMap } from "./roomAo.ts";

export function paletteTexture(p: Palette): THREE.DataTexture {
  const tex = new THREE.DataTexture(paletteRgba(p), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** An 8-bit palette-index texture for one bitmap of a .bgf, as stored. */
export function indexTexture(bgf: Bgf, frame = 0): THREE.DataTexture {
  const b = bgf.bitmaps[frame];
  const tex = new THREE.DataTexture(b.pixels, b.width, b.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface RoomLighting {
  viewerLight: number;
  ambient: number;
  sunAngle: number; // client angle units (4096 per circle)
  shade: number; // BP_LIGHT_SHADING intensity 0..63 -> shade_amount = intensity * 1024 / 64
  fog: boolean;
}

/** Ours: Enhanced lighting's parts (lighting.ts); all off is the original's lighting. */
export interface EnhancedLighting {
  softLights: boolean;
  lightsStopAtWalls: boolean;
  /** Shaded corners (roomAo.ts) */
  shadedCorners: boolean;
}

const NO_ENHANCEMENTS: EnhancedLighting = { softLights: false, lightsStopAtWalls: false, shadedCorners: false };

/** Every light bit set: no light is kept from any surface */
const ALL_LIGHTS = 0xffff;

export class RoomView {
  readonly group = new THREE.Group();
  geometry!: RoomGeometry;
  private readonly textures: Map<number, Bgf>;
  private readonly palette: THREE.Texture;
  /** Index textures by grid texture and bitmap ("id:bitmap"), kept across rebuilds */
  private readonly indexTextures = new Map<string, THREE.DataTexture>();
  private meshes: THREE.Mesh[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private animated: { batch: Batch; material: THREE.ShaderMaterial; frames: THREE.DataTexture[]; frameKeys: string[]; bgf: Bgf }[] = [];
  /** Each mesh's batch and first index texture key ("id:bitmap") */
  private meshBatches: { mesh: THREE.Mesh; batch: Batch; frameKey: string }[] = [];
  private lighting: RoomLighting | null = null;
  private lights: LightSource[] = [];
  private time = 0;
  private room!: Room;
  /** RGBA copies of the index textures, by the same key, while the filter needs them (colorTexture.ts) */
  private readonly colorTextures = new Map<string, THREE.DataTexture>();
  /** Smooth textures: the RGBA copies, filtered; off, the index textures (crisp) */
  private smooth = false;
  private enhanced: EnhancedLighting = { ...NO_ENHANCEMENTS };
  /** Shaded corners: the corner map, kept while the room's heights stay the same */
  private ao: { key: string; texture: THREE.DataTexture; rect: [number, number, number, number] } | null = null;
  /** The corner map being baked, a few milliseconds each update */
  private aoJob: { key: string; steps: Generator<void, AoMap> } | null = null;
  /** lightOcclusion.ts: for each still light's place, each batch's triangle visibility */
  private readonly visibility = new Map<string, Map<Batch, Uint8Array>>();
  /** The light list the mask attributes were last made for */
  private maskKey = "";

  constructor(room: Room, textures: Map<number, Bgf>, palette: THREE.Texture) {
    this.textures = textures;
    this.palette = palette;
    this.build(room);
  }

  /** Grid textures this view can draw; add new ones before a rebuild uses them. */
  addTexture(id: number, bgf: Bgf): void {
    this.textures.set(id, bgf);
  }

  hasTexture(id: number): boolean {
    return this.textures.has(id);
  }

  /**
   * Builds the room again after it changed (roomanim.c: lifts, wall bitmaps, textures,
   * scrolling). Textures and the lighting carry over.
   */
  rebuild(room: Room): void {
    this.visibility.clear();
    this.maskKey = "";
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    // Keep each batch's material (its texture and shader program) for the same batch
    const old = new Map(this.meshes.map((m) => [m.name, m.material as THREE.ShaderMaterial]));
    this.meshes = [];
    this.materials = [];
    this.animated = [];
    this.meshBatches = [];
    this.build(room, old);
    for (const m of old.values()) m.dispose();
    if (this.lighting) this.setLighting(this.lighting);
    this.setLights(this.lights);
    this.update(this.time);
  }

  private indexTexture(id: number, bgf: Bgf, bitmap: number): THREE.DataTexture {
    const key = `${id}:${bitmap}`;
    let t = this.indexTextures.get(key);
    if (!t) this.indexTextures.set(key, (t = indexTexture(bgf, bitmap)));
    return t;
  }

  /** The RGBA copy of an index texture (colorTexture.ts), made on first use. */
  private colorTexture(key: string): THREE.DataTexture {
    let t = this.colorTextures.get(key);
    if (!t) {
      const { data, width, height } = this.indexTextures.get(key)!.image as { data: Uint8Array; width: number; height: number };
      const palette = (this.palette.image as { data: Uint8Array }).data;
      t = colorTexture(paletteToRgba(data, width, height, palette), width, height, true);
      this.colorTextures.set(key, t);
    }
    return t;
  }

  /** A material's textures: the index texture, and its RGBA copy when the filter uses it. */
  private applyTextures(material: THREE.ShaderMaterial, frameKey: string): void {
    material.uniforms.uMap.value = this.indexTextures.get(frameKey);
    const color = this.smooth;
    material.uniforms.uColorMode.value = color ? 1 : 0;
    material.uniforms.uColorMap.value = color ? this.colorTexture(frameKey) : null;
  }

  /** Enhanced lighting's uniforms on a material: soft highlights and shaded corners. */
  private applyEnhanced(material: THREE.ShaderMaterial): void {
    const u = material.uniforms;
    u.uSoftLight.value = this.enhanced.softLights ? 1 : 0;
    const ao = this.enhanced.shadedCorners ? this.cornerMap() : null;
    u.uAo.value = ao ? 1 : 0;
    u.uAoMap.value = ao?.texture ?? null;
    if (ao) u.uAoRect.value = ao.rect;
  }

  /**
   * Shaded corners' map (roomAo.ts), baked again only when the room's heights changed; null
   * while it's being baked (update() bakes it, then turns the corners on).
   */
  private cornerMap(): { texture: THREE.DataTexture; rect: [number, number, number, number] } | null {
    const key = this.room.sectors.map((s) => [s.floorHeight, s.ceilingHeight, s.slopedFloor?.d ?? "", s.slopedCeiling?.d ?? ""].join(",")).join("|");
    if (this.ao?.key === key) return this.ao;
    if (this.aoJob?.key !== key) this.aoJob = { key, steps: bakeAoSteps(this.room) };
    return null;
  }

  /** Bakes the corner map for up to `budgetMs`; when it's done, the corners are shaded. */
  private bakeCorners(budgetMs: number): void {
    const job = this.aoJob;
    if (!job) return;
    const until = performance.now() + budgetMs;
    let r = job.steps.next();
    while (!r.done && performance.now() < until) r = job.steps.next();
    if (!r.done) return;
    this.aoJob = null;
    const m = r.value;
    this.ao?.texture.dispose();
    const texture = new THREE.DataTexture(m.data, m.width, m.height, THREE.RGFormat, THREE.UnsignedByteType);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.ao = { key: job.key, texture, rect: [m.x0, m.y0, 1 / (m.width * m.texel), 1 / (m.height * m.texel)] };
    for (const m of this.materials) this.applyEnhanced(m);
  }


  /** Smooth textures (Graphics Options): filtered, as the original; off, crisp pixels. */
  setSmoothTextures(smooth: boolean): void {
    if (smooth === this.smooth) return;
    this.smooth = smooth;
    for (const { mesh, frameKey } of this.meshBatches) this.applyTextures(mesh.material as THREE.ShaderMaterial, frameKey);
    this.update(this.time);
  }

  /** Ours: Enhanced lighting's parts; all off is the original's lighting. */
  setEnhanced(e: EnhancedLighting): void {
    const was = this.enhanced;
    if ((Object.keys(NO_ENHANCEMENTS) as (keyof EnhancedLighting)[]).every((k) => e[k] === was[k])) return;
    this.enhanced = { ...e };
    for (const m of this.materials) this.applyEnhanced(m);
    this.maskKey = "";
    this.setLights(this.lights);
    this.update(this.time);
  }

  private build(room: Room, reuse?: Map<string, THREE.ShaderMaterial>): void {
    this.room = room;
    const info = (id: number): TextureInfo | null => {
      const b = this.textures.get(id);
      if (!b) return null;
      const bmp = b.bitmaps[0];
      return { width: bmp.width, height: bmp.height, shrink: b.shrink };
    };
    this.geometry = buildRoomGeometry(room, info);
    for (const batch of this.geometry.batches.values()) {
      const bgf = this.textures.get(batch.textureId)!;
      const n = batch.positions.length / 3;
      const pos = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      const light = new Float32Array(n);
      const shade = new Float32Array(n * 3);
      // Ours, for shaded corners: what each surface is, and the floor and ceiling in front of it
      const surface = surfaceKinds(room, batch);
      for (let i = 0; i < n; i++) {
        // reverse each triangle (mirror) and swap axes
        const src = i - (i % 3) + [0, 2, 1][i % 3];
        pos[i * 3] = batch.positions[src * 3] / FINENESS;
        pos[i * 3 + 1] = batch.positions[src * 3 + 2] / FINENESS;
        pos[i * 3 + 2] = batch.positions[src * 3 + 1] / FINENESS;
        uv[i * 2] = batch.uvs[src * 2];
        uv[i * 2 + 1] = batch.uvs[src * 2 + 1];
        light[i] = batch.lights[src];
        shade[i * 3] = batch.shade[src * 3];
        shade[i * 3 + 1] = batch.shade[src * 3 + 1];
        shade[i * 3 + 2] = batch.shade[src * 3 + 2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("aLight", new THREE.BufferAttribute(light, 1));
      g.setAttribute("aShade", new THREE.BufferAttribute(shade, 3));
      g.setAttribute("aSurface", new THREE.BufferAttribute(surface, 3));
      // Which lights see each triangle (lightOcclusion.ts): bits 0-15 and 16-31, all set until worked out
      g.setAttribute("aMask0", new THREE.BufferAttribute(new Float32Array(n).fill(ALL_LIGHTS), 1));
      g.setAttribute("aMask1", new THREE.BufferAttribute(new Float32Array(n).fill(ALL_LIGHTS), 1));
      g.computeBoundingSphere();
      // Cycling textures show the first bitmap of each group in turn (roomanim.c); a group
      // the server picked shows that group's first bitmap (group % number of groups).
      const groupBitmap = (gi: number) => (bgf.groups.length ? (bgf.groups[gi % bgf.groups.length][0] ?? 0) : 0);
      const bitmaps =
        batch.group !== null
          ? [groupBitmap(batch.group)]
          : batch.animation?.kind === "cycle" && bgf.groups.length > 1
            ? bgf.groups.map((_, gi) => groupBitmap(gi))
            : [0];
      const frames = bitmaps.map((b) => this.indexTexture(batch.textureId, bgf, b));
      const frameKeys = bitmaps.map((b) => `${batch.textureId}:${b}`);
      let mat = reuse?.get(batch.key);
      if (mat) reuse!.delete(batch.key);
      else {
        const uniforms = lightingUniforms();
        uniforms.uMap.value = frames[0];
        uniforms.uPalette.value = this.palette;
        mat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          uniforms,
          vertexShader: roomVertexShader,
          fragmentShader: roomFragmentShader,
          side: THREE.FrontSide,
        });
      }
      this.materials.push(mat);
      this.applyTextures(mat, frameKeys[0]);
      this.applyEnhanced(mat);
      if (batch.animation) this.animated.push({ batch, material: mat, frames, frameKeys, bgf });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = batch.key;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.meshBatches.push({ mesh, batch, frameKey: frameKeys[0] });
    }
  }

  /**
   * Whether the room hides what's along `raycaster` (up to its far): the first hit on a pixel
   * the shader draws (roomFragmentShader discards index 254), as the depth test would see it.
   * The D3D client depth-tests the name labels against the room (D3DRenderNamesDraw3D).
   */
  occludes(raycaster: THREE.Raycaster): boolean {
    return this.firstHit(raycaster) !== null;
  }

  /** How far along `raycaster` (up to its far) the room's first drawn pixel is, or null for none. */
  firstHit(raycaster: THREE.Raycaster): number | null {
    const fract = (v: number) => v - Math.floor(v);
    for (const hit of raycaster.intersectObjects(this.meshes, false)) {
      if (!hit.uv) return hit.distance;
      const map = ((hit.object as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uMap.value as THREE.DataTexture;
      const { data, width, height } = map.image as { data: Uint8Array; width: number; height: number };
      const x = Math.min(width - 1, Math.floor(fract(hit.uv.x) * width));
      const y = Math.min(height - 1, Math.floor(fract(hit.uv.y) * height));
      if (data[y * width + x] !== 254) return hit.distance;
    }
    return null;
  }

  /** Advance texture animations to `timeMs` (any monotonic clock). */
  update(timeMs: number): void {
    this.time = timeMs;
    if (this.enhanced.shadedCorners) this.bakeCorners(4);
    for (const { batch, material, frames, frameKeys, bgf } of this.animated) {
      const a = batch.animation!;
      const steps = Math.floor(timeMs / a.periodMs);
      if (a.kind === "cycle") {
        const i = steps % frames.length;
        material.uniforms.uMap.value = frames[i];
        if (material.uniforms.uColorMode.value) material.uniforms.uColorMap.value = this.colorTexture(frameKeys[i]);
        continue;
      }
      const bmp = bgf.bitmaps[0];
      let s: number, t: number;
      if (a.surface === "wall") {
        // d3drender.c D3DRenderWallExtract, ANIMATE_SCROLL branch
        const sign = a.backwards ? -1 : 1;
        t = (sign * steps * a.dx * bgf.shrink) / bmp.height;
        s = (-sign * steps * a.dy * bgf.shrink) / bmp.width;
      } else {
        // D3DRenderFloorExtract / CeilingExtract: s += xoffset, t -= yoffset (fine units)
        s = (steps * a.dx) / FINENESS;
        t = (-steps * a.dy) / FINENESS;
      }
      material.uniforms.uScroll.value = [s - Math.floor(s), t - Math.floor(t)];
    }
  }

  /** Light sources for the light maps (see objectLighting.ts). At most 32 are used. */
  setLights(lights: LightSource[]): void {
    this.lights = lights;
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (const m of this.materials) {
      const pos = m.uniforms.uLightPos.value as Float32Array;
      const col = m.uniforms.uLightColor.value as Float32Array;
      for (let i = 0; i < n; i++) {
        const l = lights[i];
        // A highlight light's reach is negative: no falloff on floors (lighting.ts)
        pos.set([l.x, l.y, l.z, (l.highlight ? -l.scale : l.scale) / 2], i * 4);
        col.set([l.r / 255, l.g / 255, l.b / 255], i * 3);
      }
      m.uniforms.uLightCount.value = n;
    }
    this.updateMasks(lights.slice(0, n));
  }

  /**
   * Lights stop at walls (lightOcclusion.ts): sets the triangles' light bits from each still
   * light's visibility, worked out once for each place (flicker changes only reach and colour).
   * Moving lights, and every light with the option off, light everything in reach as the
   * original's do.
   */
  private updateMasks(lights: LightSource[]): void {
    const occlude = this.enhanced.lightsStopAtWalls;
    const keys = lights.map((l) => (occlude && !l.moving ? `${l.x},${l.y},${l.z}` : "*"));
    const key = keys.join("|");
    if (key === this.maskKey) return;
    this.maskKey = key;
    const vis = keys.map((k, i) => (k === "*" ? null : this.lightVisibility(k, lights[i])));
    // Forget places no light is at now
    for (const k of [...this.visibility.keys()]) if (!keys.includes(k)) this.visibility.delete(k);
    for (const { mesh, batch } of this.meshBatches) {
      const g = mesh.geometry;
      const m0 = g.getAttribute("aMask0") as THREE.BufferAttribute;
      const m1 = g.getAttribute("aMask1") as THREE.BufferAttribute;
      const a0 = m0.array as Float32Array,
        a1 = m1.array as Float32Array;
      const tris = a0.length / 3;
      for (let t = 0; t < tris; t++) {
        let lo = ALL_LIGHTS,
          hi = ALL_LIGHTS;
        for (let i = 0; i < vis.length; i++) {
          const v = vis[i];
          if (!v || v.get(batch)![t]) continue;
          if (i < 16) lo &= ~(1 << i);
          else hi &= ~(1 << (i - 16));
        }
        a0[t * 3] = a0[t * 3 + 1] = a0[t * 3 + 2] = lo;
        a1[t * 3] = a1[t * 3 + 1] = a1[t * 3 + 2] = hi;
      }
      m0.needsUpdate = true;
      m1.needsUpdate = true;
    }
  }

  /** Which triangles a still light sees, kept by its place. */
  private lightVisibility(key: string, l: LightSource): Map<Batch, Uint8Array> {
    let v = this.visibility.get(key);
    if (v) return v;
    // Kept inside its sector: a tall sprite's light can be above a low ceiling
    let z = l.z;
    const leaf = leafAt(this.room, l.x, l.y);
    if (leaf?.sector) {
      const s = this.room.sectors[leaf.sector - 1];
      z = Math.max(floorHeightAt(s, l.x, l.y) + 1, Math.min(ceilingHeightAt(s, l.x, l.y) - 1, z));
    }
    const light = { x: l.x, y: l.y, z, reach: l.scale / 2 };
    const walls = wallsNear(this.room, light.x, light.y, light.reach);
    v = new Map();
    for (const batch of this.geometry.batches.values()) v.set(batch, triangleVisibility(this.room, batch, light, walls));
    this.visibility.set(key, v);
    return v;
  }

  setLighting(l: RoomLighting): void {
    this.lighting = l;
    const a = (l.sunAngle * 2 * Math.PI) / 4096;
    for (const m of this.materials) {
      m.uniforms.uViewerLight.value = l.viewerLight;
      m.uniforms.uAmbient.value = l.ambient;
      m.uniforms.uSun.value = [Math.cos(a), Math.sin(a)];
      m.uniforms.uShade.value = Math.floor((l.shade * FINENESS) / 64);
      m.uniforms.uFog.value = l.fog ? 1 : 0;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.indexTextures.values()) t.dispose();
    this.indexTextures.clear();
    for (const t of this.colorTextures.values()) t.dispose();
    this.colorTextures.clear();
    this.ao?.texture.dispose();
    this.ao = null;
    this.aoJob = null;
  }
}

/** Client fine coordinates (x east, y south, z up) to scene coordinates. */
export function clientToScene(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x / FINENESS, z / FINENESS, y / FINENESS);
}

/**
 * Per vertex, in the mesh's order (each triangle reversed, as RoomView.build copies them):
 * the surface kind and the floor and ceiling in front (roomAo.ts surfaceInfo), from each
 * triangle's normal (roomGeometry winds it counter-clockwise around the side it's seen from).
 */
function surfaceKinds(room: Room, batch: Batch): Float32Array {
  const p = batch.positions;
  const tris = Math.floor(p.length / 9);
  const out = new Float32Array(tris * 9);
  for (let tri = 0; tri < tris; tri++) {
    const a = tri * 3;
    const e1 = [p[(a + 1) * 3] - p[a * 3], p[(a + 1) * 3 + 1] - p[a * 3 + 1], p[(a + 1) * 3 + 2] - p[a * 3 + 2]];
    const e2 = [p[(a + 2) * 3] - p[a * 3], p[(a + 2) * 3 + 1] - p[a * 3 + 1], p[(a + 2) * 3 + 2] - p[a * 3 + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1],
      ny = e1[2] * e2[0] - e1[0] * e2[2],
      nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    const n: [number, number, number] = [nx / l, ny / l, nz / l];
    for (let k = 0; k < 3; k++) {
      const src = a + [0, 2, 1][k]; // the mesh's vertex a + k comes from this one
      out.set(surfaceInfo(room, p[src * 3], p[src * 3 + 1], n), (a + k) * 3);
    }
  }
  return out;
}
