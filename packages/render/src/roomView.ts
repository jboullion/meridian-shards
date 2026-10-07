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
  readonly geometry: RoomGeometry;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly animated: { batch: Batch; material: THREE.ShaderMaterial; frames: THREE.DataTexture[]; bgf: Bgf }[] = [];

  constructor(room: Room, textures: Map<number, Bgf>, palette: THREE.Texture) {
    const info = (id: number): TextureInfo | null => {
      const b = textures.get(id);
      if (!b) return null;
      const bmp = b.bitmaps[0];
      return { width: bmp.width, height: bmp.height, shrink: b.shrink };
    };
    this.geometry = buildRoomGeometry(room, info);
    for (const batch of this.geometry.batches.values()) {
      const bgf = textures.get(batch.textureId)!;
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
      const uniforms = lightingUniforms();
      // Cycling textures show the first bitmap of each group in turn (roomanim.c).
      const frames =
        batch.animation?.kind === "cycle" && bgf.groups.length > 1
          ? bgf.groups.map((g) => indexTexture(bgf, g[0] ?? 0))
          : [indexTexture(bgf)];
      uniforms.uMap.value = frames[0];
      uniforms.uPalette.value = palette;
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        vertexShader: roomVertexShader,
        fragmentShader: roomFragmentShader,
        side: THREE.FrontSide,
      });
      this.materials.push(mat);
      if (batch.animation) this.animated.push({ batch, material: mat, frames, bgf });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `grd${batch.textureId}`;
      this.group.add(mesh);
    }
  }

  /** Advance texture animations to `timeMs` (any monotonic clock). */
  update(timeMs: number): void {
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
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.ShaderMaterial).uniforms.uMap.value?.dispose?.();
        (o.material as THREE.Material).dispose();
      }
    });
    for (const a of this.animated) for (const f of a.frames) f.dispose();
  }
}

/** Client fine coordinates (x east, y south, z up) to scene coordinates. */
export function clientToScene(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x / FINENESS, z / FINENESS, y / FINENESS);
}
