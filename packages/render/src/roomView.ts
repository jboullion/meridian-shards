// Three.js scene objects for a room: one mesh per grid texture, drawn with the
// palette + original lighting material (lighting.ts).
//
// Scene units: 1 unit = 1 grid square. Axes: client (x east, y south, z up) maps to
// three (X = x, Y = z, Z = y) / 1024. That mapping mirrors handedness, so triangle
// winding is reversed when copying (roomGeometry winds CCW in client space).

import * as THREE from "three";
import { FINENESS, paletteRgba, type Bgf, type Palette, type Room } from "@shards/formats";
import { buildRoomGeometry, type Batch, type RoomGeometry, type TextureInfo } from "./roomGeometry.ts";
import { lightingUniforms, roomFragmentShader, roomVertexShader } from "./lighting.ts";
import type { LightSource } from "./objectLighting.ts";

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

export class RoomView {
  readonly group = new THREE.Group();
  geometry!: RoomGeometry;
  private readonly textures: Map<number, Bgf>;
  private readonly palette: THREE.Texture;
  /** Index textures by grid texture and bitmap ("id:bitmap"), kept across rebuilds */
  private readonly indexTextures = new Map<string, THREE.DataTexture>();
  private meshes: THREE.Mesh[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private animated: { batch: Batch; material: THREE.ShaderMaterial; frames: THREE.DataTexture[]; bgf: Bgf }[] = [];
  private lighting: RoomLighting | null = null;
  private lights: LightSource[] = [];
  private time = 0;

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
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    // Keep each batch's material (its texture and shader program) for the same batch
    const old = new Map(this.meshes.map((m) => [m.name, m.material as THREE.ShaderMaterial]));
    this.meshes = [];
    this.materials = [];
    this.animated = [];
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

  private build(room: Room, reuse?: Map<string, THREE.ShaderMaterial>): void {
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
      g.computeBoundingSphere();
      // Cycling textures show the first bitmap of each group in turn (roomanim.c); a group
      // the server picked shows that group's first bitmap (group % number of groups).
      const groupBitmap = (gi: number) => (bgf.groups.length ? (bgf.groups[gi % bgf.groups.length][0] ?? 0) : 0);
      const frames =
        batch.group !== null
          ? [this.indexTexture(batch.textureId, bgf, groupBitmap(batch.group))]
          : batch.animation?.kind === "cycle" && bgf.groups.length > 1
            ? bgf.groups.map((_, gi) => this.indexTexture(batch.textureId, bgf, groupBitmap(gi)))
            : [this.indexTexture(batch.textureId, bgf, 0)];
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
      if (batch.animation) this.animated.push({ batch, material: mat, frames, bgf });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = batch.key;
      this.group.add(mesh);
      this.meshes.push(mesh);
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
    for (const { batch, material, frames, bgf } of this.animated) {
      const a = batch.animation!;
      const steps = Math.floor(timeMs / a.periodMs);
      if (a.kind === "cycle") {
        material.uniforms.uMap.value = frames[steps % frames.length];
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
    const n = Math.min(32, lights.length);
    for (const m of this.materials) {
      const pos = m.uniforms.uLightPos.value as Float32Array;
      const col = m.uniforms.uLightColor.value as Float32Array;
      for (let i = 0; i < n; i++) {
        const l = lights[i];
        pos.set([l.x, l.y, l.z, l.scale / 2], i * 4);
        col.set([l.r / 255, l.g / 255, l.b / 255], i * 3);
      }
      m.uniforms.uLightCount.value = n;
    }
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
  }
}

/** Client fine coordinates (x east, y south, z up) to scene coordinates. */
export function clientToScene(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x / FINENESS, z / FINENESS, y / FINENESS);
}
