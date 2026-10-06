// The room viewer's Three.js side: renderer, camera and the loaded room.

import * as THREE from "three";
import { gridTextureName, leafAt, kodToClient, splitBsf, FINENESS, type Bgf, type Room } from "@shards/formats";
import { RoomView, createSkybox, disposeSkybox, paletteTexture, type RoomLighting } from "@shards/render";
import type { AssetStore } from "../assets.ts";
import { FlyCamera } from "./flyCamera.ts";

/** Eye height above the floor, in squares (clientd3d/game.c: player.height = 3 * FINENESS / 4). */
const EYE_HEIGHT = 0.75;
/**
 * The original D3D view: 50 deg horizontal x 32.1 deg vertical (d3drender.c FovHorizontal
 * = PI / 3.6, FovVertical = PI / 5.6), an aspect of about 1.62. We keep the vertical angle
 * and widen for wider windows; narrower windows keep the 50 deg horizontal angle.
 */
export const ORIGINAL_FOV = { horizontal: 180 / 3.6, vertical: 180 / 5.6 };

export interface RoomStats {
  triangles: number;
  textures: number;
  missingTextures: number[];
  securityOk: boolean;
  loadMs: number;
}

export class RoomScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(ORIGINAL_FOV.vertical, 1, 0.05, 400);
  /** Vertical FOV in degrees; null = the original's 50 x 32 view (Hor+ for wide windows). */
  fov: number | null = null;
  private sky: THREE.Group | null = null;
  private skyName = "";
  readonly fly: FlyCamera;
  private view: RoomView | null = null;
  private palette: THREE.Texture | null = null;
  private lighting: RoomLighting;
  private raf = 0;
  private last = performance.now();
  private readonly assets: AssetStore;
  private readonly resizeObserver: ResizeObserver;
  fps = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, assets: AssetStore, lighting: RoomLighting) {
    this.assets = assets;
    this.lighting = lighting;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // palette colours are written as-is
    this.scene.background = new THREE.Color(0x000000);
    this.fly = new FlyCamera(this.camera, canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
      this.fly.update(dt);
      this.sky?.position.copy(this.camera.position);
      this.view?.update(t);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if (import.meta.env.DEV) (window as unknown as { shards: unknown }).shards = { roomScene: this, THREE };
  }

  /** Put the eye at a Kod square (fractions allowed), facing a compass yaw (0 = north, 90 = east). */
  lookFrom(row: number, col: number, heightSquares: number, yawDegrees: number, pitchDegrees = 0): void {
    this.camera.position.set(col - 1, heightSquares, row - 1);
    this.fly.yaw = (-yawDegrees * Math.PI) / 180;
    this.fly.pitch = (pitchDegrees * Math.PI) / 180;
  }

  private resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1,
      h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyFov();
  }

  setFov(fov: number | null): void {
    this.fov = fov;
    this.applyFov();
  }

  private applyFov(): void {
    const aspect = this.camera.aspect;
    const deg = Math.PI / 180;
    if (this.fov !== null) this.camera.fov = this.fov;
    else {
      const origAspect = Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / Math.tan((ORIGINAL_FOV.vertical / 2) * deg);
      this.camera.fov =
        aspect >= origAspect
          ? ORIGINAL_FOV.vertical
          : (2 * Math.atan(Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / aspect)) / deg;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Show the room background sky box (a .bsf name), or none. */
  private async setSky(name: string | null): Promise<void> {
    if (name === this.skyName) return;
    this.skyName = name ?? "";
    if (this.sky) {
      this.scene.remove(this.sky);
      disposeSkybox(this.sky);
      this.sky = null;
    }
    if (!name) return;
    const pngs = splitBsf(await this.assets.fetchBytes(name));
    const faces = await Promise.all(pngs.map((p) => createImageBitmap(new Blob([p as BlobPart], { type: "image/png" }))));
    if (this.skyName !== name) return; // changed while loading
    this.sky = createSkybox(faces);
    this.scene.add(this.sky);
  }

  async loadRoom(
    roo: string,
    teleport: { row: number; col: number; angle: number | null },
    skybox = "skyc.bsf",
  ): Promise<RoomStats> {
    const t0 = performance.now();
    this.palette ??= paletteTexture(await this.assets.palette());
    const room: Room = await this.assets.room(roo);
    const ids = new Set<number>();
    for (const s of room.sectors) ids.add(s.floorType).add(s.ceilingType);
    for (const s of room.sidedefs) ids.add(s.normalType).add(s.aboveType).add(s.belowType);
    ids.delete(0);
    const textures = new Map<number, Bgf>();
    const missing: number[] = [];
    await Promise.all(
      [...ids].map(async (id) => {
        const b = await this.assets.bgf(gridTextureName(id));
        if (b && b.bitmaps.length) textures.set(id, b);
        else missing.push(id);
      }),
    );

    if (this.disposed) throw new Error("scene disposed");
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.view = new RoomView(room, textures, this.palette);
    this.view.setLighting(this.lighting);
    this.scene.add(this.view.group);
    await this.setSky(this.view.geometry.skySectors.size ? skybox : null);

    // Stand at the room's arrival square, at eye height above the floor there.
    const p = kodToClient(teleport.row, teleport.col);
    const leaf = leafAt(room, p.x, p.y);
    const floor = leaf ? room.sectors[leaf.sector - 1].floorHeight : 0;
    this.camera.position.set(p.x / FINENESS, floor / FINENESS + EYE_HEIGHT, p.y / FINENESS);
    this.fly.pitch = 0;
    if (teleport.angle !== null) this.fly.setClientAngle(teleport.angle);

    let triangles = 0;
    for (const b of this.view.geometry.batches.values()) triangles += b.positions.length / 9;
    return { triangles, textures: textures.size, missingTextures: missing.sort((a, b) => a - b), securityOk: room.securityOk, loadMs: performance.now() - t0 };
  }

  setLighting(l: RoomLighting): void {
    this.lighting = l;
    this.view?.setLighting(l);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.fly.dispose();
    this.view?.dispose();
    this.renderer.dispose();
  }
}
