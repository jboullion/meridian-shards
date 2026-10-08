// The sun and the moon: background overlays (clientd3d/boverlay.c), bitmaps on the sky.
//
// The software renderer draws each one on the background (drawbsp.c doDrawBackground): its
// bitmap at its own size, centred `angle` around from due east (the background scrolls
// 3328 pixels per full turn, world_width) and `height` pixels above the horizon, with no
// lighting and only where the sky shows. The D3D client has a function for them
// (d3drender.c D3DRenderBackgroundObjectsDraw) that it never calls, so the sky there has
// none. We draw them the software renderer's way, as billboards far off in their direction:
// a bitmap pixel spans 1/512 of a radian, the viewer distance (drawdefs.h VIEWER_DISTANCE),
// and the height becomes an elevation of atan(height / 512). They're drawn after the skybox
// and before everything else, so walls, ceilings and objects cover them.

import * as THREE from "three";
import { TRANSPARENT_INDEX, type Bgf } from "@shards/formats";
import { frameFor } from "./sprites.ts";

/** drawdefs.h VIEWER_DISTANCE: pixels from the eye to the screen */
const VIEWER_DISTANCE = 512;
/** How far off we put them, in squares: past any room's walls, inside the camera's far plane */
const SKY_DISTANCE = 300;

export interface SkyOverlay {
  id: number;
  bgf: Bgf | null | undefined;
  /** 0-based bitmap group (the overlay's animation) */
  group: number;
  /** Client angle units, east = 0 */
  angle: number;
  /** Pixels above the horizon, as the client reads it (a WORD) */
  height: number;
}

interface Entry {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  key: string;
  /** The bitmap, for picking: palette indices and size */
  pixels: Uint8Array;
  width: number;
  height: number;
}

export class SkyOverlaysView {
  readonly group = new THREE.Group();
  private readonly entries = new Map<number, Entry>();
  private readonly rgb: Uint8Array;

  /** `rgb`: the palette, 256 x 3 bytes */
  constructor(rgb: Uint8Array) {
    this.rgb = rgb;
    this.group.name = "sky overlays";
  }

  /** Place them for this frame, around the camera; `visible` false (blind) hides them all. */
  update(overlays: SkyOverlay[], camera: THREE.Camera, visible: boolean): void {
    const seen = new Set<number>();
    const pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    const quat = new THREE.Quaternion();
    camera.getWorldQuaternion(quat);
    for (const o of overlays) {
      const bmp = o.bgf ? frameFor(o.bgf, 0, o.group) : null;
      if (!bmp) continue;
      seen.add(o.id);
      const key = `${o.bgf!.name}:${o.group}`;
      let e = this.entries.get(o.id);
      if (!e || e.key !== key) {
        if (e) this.remove(o.id);
        e = this.create(bmp.width, bmp.height, bmp.pixels, key);
        this.entries.set(o.id, e);
      }
      // A height past 32767 is a negative one from Kod: below the horizon, never drawn
      e.mesh.visible = visible && o.height < 0x8000;
      if (!e.mesh.visible) continue;
      const az = (o.angle * 2 * Math.PI) / 4096;
      const el = Math.atan(o.height / VIEWER_DISTANCE);
      // client (cos a, sin a) is scene (X, Z), as for the camera
      const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      e.mesh.position.copy(pos).addScaledVector(dir, SKY_DISTANCE);
      e.mesh.quaternion.copy(quat);
      const perPixel = SKY_DISTANCE / VIEWER_DISTANCE;
      e.mesh.scale.set(e.width * perPixel, e.height * perPixel, 1);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** The overlay drawn under the ray (an opaque pixel), for looking at it (client3d.c GetObjects3D). */
  pick(raycaster: THREE.Raycaster): number | null {
    const far = raycaster.far;
    raycaster.far = SKY_DISTANCE * 2;
    const meshes = [...this.entries.values()].filter((e) => e.mesh.visible).map((e) => e.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    raycaster.far = far;
    for (const hit of hits) {
      const [id, e] = [...this.entries].find(([, v]) => v.mesh === hit.object) ?? [];
      if (id === undefined || !e || !hit.uv) continue;
      const x = Math.min(e.width - 1, Math.floor(hit.uv.x * e.width));
      const y = Math.min(e.height - 1, Math.floor((1 - hit.uv.y) * e.height));
      if (e.pixels[y * e.width + x] !== TRANSPARENT_INDEX) return id;
    }
    return null;
  }

  private create(width: number, height: number, pixels: Uint8Array, key: string): Entry {
    // RGBA, bottom row first (a DataTexture's first row is v = 0)
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = pixels[y * width + x];
        const i = ((height - 1 - y) * width + x) * 4;
        if (v === TRANSPARENT_INDEX) continue;
        data[i] = this.rgb[v * 3];
        data[i + 1] = this.rgb[v * 3 + 1];
        data[i + 2] = this.rgb[v * 3 + 2];
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    // Opaque with an alpha test, so it's drawn in the opaque pass right after the skybox and
    // everything nearer is drawn over it; no depth, no fog, no lighting (full bright)
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = -999;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, key, pixels, width, height };
  }

  private remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh.material.map?.dispose();
    e.mesh.material.dispose();
    this.entries.delete(id);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}
