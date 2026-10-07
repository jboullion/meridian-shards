// Room objects as camera-facing sprites (clientd3d/d3drender.c D3DRenderObjectsDraw).
// Billboards turn with the view heading (cylindrical, like mPlayerHeadingTrans),
// stand on the floor (minus water depth), and are lit like the D3D client.

import * as THREE from "three";
import { FINENESS, SF, ceilingHeightAt, floorHeightAt, leafAt, type Bgf, type Room } from "@shards/formats";
import { compositeSprite, frameFor, type Composite, type SpritePart } from "./sprites.ts";
import type { XlatTable } from "./xlat.ts";
import { dlightScale, fogEnd, lightColor, objectBrightness, type LightSource } from "./objectLighting.ts";

/** Object flags (include/proto.h OF_*) and draw effects (DRAWFX_*). */
export const OF = { DISPLAY_NAME: 0x1, SIGN: 0x2, PLAYER: 0x4, HANGING: 0x100, NPC: 0x2000 } as const;
export const DRAWFX = {
  PLAIN: 0, TRANSLUCENT25: 1, TRANSLUCENT50: 2, TRANSLUCENT75: 3, BLACK: 4, INVISIBLE: 5,
  DITHERINVIS: 7, DITHERTRANS: 8, DOUBLETRANS: 9, SECONDTRANS: 10, DITHERGREY: 11,
} as const;
const SECOND_TRANSLATION = 0x31; // XLAT_FILTERWHITE90 (server.c ExtractObject default)
/** draw3d.c sector_depths: water depth by the sector's SF_DEPTH bits */
const SECTOR_DEPTHS = [0, FINENESS / 5, (2 * FINENESS) / 5, (3 * FINENESS) / 5];
const ROOM_OVERRIDE = [0, 0x1, 0x2, 0x4];
const MAX_NAME_DISTANCE = 15 * FINENESS;

/** What the view needs from a world object (see @shards/world WorldObject). */
export interface ViewObject {
  id: number;
  /** client fine coordinates */
  x: number;
  y: number;
  angle: number;
  version: number;
  info: {
    iconRes: number;
    nameRes: number;
    flags: number;
    drawingType: number;
    nameColor: number;
    light: { flags: number; intensity: number; color: number };
  };
  /** Drawn at full brightness, unaffected by light or fog (projectiles: d3drender.c COLOR_MAX) */
  fullBright?: boolean;
  /** The look to draw now (normal, or the motion look while moving). */
  look: {
    anim: { group: number };
    overlays: { iconRes: number; hotspot: number; translation: number; anim: { group: number } }[];
    translation: number;
  };
}

export interface ObjectViewContext {
  room: Room;
  /** BP_PLAYER room flags and override depths (fine units, already << 4) */
  roomFlags: number;
  overrideDepths: [number, number, number];
  ambient: number;
  viewerLight: number;
  /** viewer position in client fine units */
  viewer: { x: number; y: number };
  /** camera yaw (scene) for billboard facing */
  yaw: number;
  fog: boolean;
}

export interface NameLabel {
  id: number;
  name: string;
  /** CSS colour */
  color: string;
  /** scene position of the label's anchor (top of the sprite) */
  position: THREE.Vector3;
}

const spriteVertex = /* glsl */ `
out vec2 vUv;
out float vDepth;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z * 1024.0;
  gl_Position = projectionMatrix * mv;
}
`;

const spriteFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
in float vDepth;
out vec4 fragColor;
uniform sampler2D uMap;
uniform sampler2D uPalette;
uniform vec3 uBrightness;
uniform float uAlpha;
uniform float uFogEnd;
uniform float uFog;
uniform float uHighlight;
void main() {
  float index = floor(texture(uMap, vUv).r * 255.0 + 0.5);
  if (index == 254.0) discard;
  vec3 rgb = texelFetch(uPalette, ivec2(int(index), 0), 0).rgb;
  float fog = uFog > 0.5 ? clamp((uFogEnd - vDepth) / uFogEnd, 0.0, 1.0) : 1.0;
  fragColor = vec4(rgb * uBrightness * fog * (1.0 + 0.35 * uHighlight), uAlpha);
}
`;

/**
 * The target halo (d3drender.c, isTargeted chunks): the sprite's shape, stretched 96 /
 * shrink fine units further on each side, drawn behind it in one colour (green by
 * default, config.halocolor) at twice the object's light.
 */
const haloFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMap;
uniform vec3 uColor;
void main() {
  float index = floor(texture(uMap, vUv).r * 255.0 + 0.5);
  if (index == 254.0) discard;
  fragColor = vec4(uColor, 1.0);
}
`;
/** config.halocolor: 0 green (default), 1 red, 2 blue */
export const HALO_COLORS = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];

interface Entry {
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  key: string;
  composite: Composite | null;
  texture: THREE.DataTexture | null;
  /** client position and ground height */
  x: number;
  y: number;
  z: number;
}

export class ObjectsView {
  readonly group = new THREE.Group();
  private readonly entries = new Map<number, Entry>();
  private readonly palette: THREE.Texture;
  private readonly xlats: XlatTable;
  private readonly getBgf: (resource: number) => Bgf | null | undefined;
  private readonly resourceName: (resource: number) => string | undefined;
  private target: number | null = null;
  haloColor = 0;

  /**
   * @param getBgf the loaded .bgf for an icon resource; undefined while loading (the
   *   view retries every frame), null if missing.
   */
  constructor(
    palette: THREE.Texture,
    xlats: XlatTable,
    getBgf: (resource: number) => Bgf | null | undefined,
    resourceName: (resource: number) => string | undefined,
  ) {
    this.palette = palette;
    this.xlats = xlats;
    this.getBgf = getBgf;
    this.resourceName = resourceName;
    this.group.name = "objects";
  }


  /** Light sources from objects with a light (D3DLMapsStaticGet). */
  lights(objects: Iterable<ViewObject>, ctx: ObjectViewContext): LightSource[] {
    const out: LightSource[] = [];
    for (const o of objects) {
      const l = o.info.light;
      if (!l.color || !l.intensity || out.length >= 32) continue;
      const { x, y } = o;
      const ground = this.ground(o, x, y, ctx);
      const bgf = this.getBgf(o.info.iconRes);
      const b = bgf ? frameFor(bgf, 0, 0) : null;
      const top = b && bgf ? (16 * b.height) / bgf.shrink - b.yOffset * 4 : 0;
      out.push({ x, y, z: ground + top, scale: dlightScale(l.intensity), ...lightColor(l.color) });
    }
    return out;
  }

  /** Floor height under the object minus water depth (or hanging from the ceiling). */
  private ground(o: ViewObject, x: number, y: number, ctx: ObjectViewContext, heightFine = 0): number {
    const leaf = leafAt(ctx.room, x, y);
    if (!leaf || !leaf.sector) return 0;
    const s = ctx.room.sectors[leaf.sector - 1];
    if (o.info.flags & OF.HANGING) return ceilingHeightAt(s, x, y) - heightFine;
    const level = s.flags & SF.DEPTH_MASK;
    let depth = SECTOR_DEPTHS[level];
    if (level && ctx.roomFlags & ROOM_OVERRIDE[level]) depth = ctx.overrideDepths[level - 1];
    return floorHeightAt(s, x, y) - depth;
  }

  /** Sync meshes with the objects and update their frame, placement and light. */
  update(objects: Iterable<ViewObject>, ctx: ObjectViewContext, lights: LightSource[], selfId: number): NameLabel[] {
    const seen = new Set<number>();
    const labels: NameLabel[] = [];
    for (const o of objects) {
      if (o.id === selfId || o.info.drawingType === DRAWFX.INVISIBLE) continue;
      const base = this.getBgf(o.info.iconRes);
      if (!base) continue;
      seen.add(o.id);
      const { x, y } = o;
      const dx = x - ctx.viewer.x,
        dy = y - ctx.viewer.y;
      const toViewer = Math.round((Math.atan2(-dy, -dx) * 4096) / (2 * Math.PI));
      const viewAngle = (o.angle - toViewer) & 4095;

      // Parts; skip the whole object until every overlay bitmap is loaded.
      const overlays: SpritePart[] = [];
      let ready = true;
      const look = o.look;
      for (const ov of look.overlays) {
        const b = this.getBgf(ov.iconRes);
        if (b === undefined) ready = false;
        else if (b) overlays.push({ bgf: b, group: ov.anim.group, translation: ov.translation, hotspot: ov.hotspot });
      }
      if (!ready) continue;
      const frameNum = (bgf: Bgf, group: number) => {
        const g = bgf.groups[group];
        if (!g?.length) return -1;
        const interval = Math.floor(4096 / g.length) + 1;
        return Math.floor(((viewAngle + Math.floor(interval / 2)) % 4096) / interval);
      };
      const key = [
        o.version, o.info.iconRes, look.anim.group, frameNum(base, look.anim.group), look.translation, o.info.drawingType,
        ...overlays.map((p) => `${p.bgf.name}:${p.group}:${p.translation}:${frameNum(p.bgf, p.group)}`),
      ].join("|");

      let e = this.entries.get(o.id);
      if (!e) {
        const mat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: spriteVertex,
          fragmentShader: spriteFragment,
          uniforms: {
            uMap: { value: null },
            uPalette: { value: this.palette },
            uBrightness: { value: new THREE.Vector3(1, 1, 1) },
            uAlpha: { value: 1 },
            uFogEnd: { value: 100000 },
            uFog: { value: 1 },
            uHighlight: { value: 0 },
          },
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.name = `object ${o.id}`;
        this.group.add(mesh);
        e = { mesh, halo: null, key: "", composite: null, texture: null, x, y, z: 0 };
        this.entries.set(o.id, e);
      }
      if (e.key !== key) {
        e.key = key;
        const dt = o.info.drawingType;
        e.composite = compositeSprite(
          {
            base: { bgf: base, group: look.anim.group, translation: look.translation, hotspot: 0 },
            overlays,
            viewAngle,
            secondTranslation: dt === DRAWFX.DOUBLETRANS || dt === DRAWFX.SECONDTRANS ? SECOND_TRANSLATION : 0,
            secondOnly: dt === DRAWFX.SECONDTRANS,
          },
          this.xlats,
        );
        this.setComposite(e);
      }
      if (!e.composite) {
        e.mesh.visible = false;
        continue;
      }
      e.mesh.visible = true;
      e.x = x;
      e.y = y;
      e.z = this.ground(o, x, y, ctx, e.composite.heightFine);
      e.mesh.position.set(x / FINENESS, e.z / FINENESS, y / FINENESS);
      e.mesh.rotation.set(0, ctx.yaw, 0);

      // Lighting (D3DObjectLightingCalc) and draw effects
      const leaf = leafAt(ctx.room, x, y);
      const sectorLight = leaf?.sector ? ctx.room.sectors[leaf.sector - 1].light : 0;
      const u = e.mesh.material.uniforms;
      const dt = o.info.drawingType;
      const [r, g, b] = o.fullBright
        ? [1, 1, 1]
        : dt === DRAWFX.BLACK
          ? [0, 0, 0]
          : objectBrightness({ x, y, z: e.z }, sectorLight, ctx.viewerLight, ctx.ambient, lights);
      (u.uBrightness.value as THREE.Vector3).set(r, g, b);
      u.uFogEnd.value = fogEnd(sectorLight, ctx.viewerLight, ctx.ambient);
      u.uFog.value = ctx.fog && !o.fullBright ? 1 : 0;
      const alpha =
        dt === DRAWFX.TRANSLUCENT25 ? 0.25 : dt === DRAWFX.TRANSLUCENT75 ? 0.75
        : dt === DRAWFX.TRANSLUCENT50 || dt === DRAWFX.DITHERTRANS || dt === DRAWFX.DITHERINVIS || dt === DRAWFX.DITHERGREY ? 0.5 : 1;
      u.uAlpha.value = alpha;
      e.mesh.material.transparent = alpha < 1;
      e.mesh.material.depthWrite = alpha >= 1;
      this.updateHalo(e, o.id === this.target, r);

      // Name labels (d3drender.c D3DRenderNamesDraw3D)
      if (o.info.flags & OF.DISPLAY_NAME) {
        const dist = Math.hypot(dx, dy);
        if (o.info.flags & OF.SIGN || dist < MAX_NAME_DISTANCE) {
          const c = o.info.nameColor;
          const k = Math.max(r, g, b);
          const col = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => Math.round(v * Math.min(1, k * (255 / 239))));
          labels.push({
            id: o.id,
            name: this.resourceName(o.info.nameRes) ?? "",
            color: `rgb(${col.join(",")})`,
            position: new THREE.Vector3(x / FINENESS, (e.z + Math.max(e.composite.baseTop, e.composite.top)) / FINENESS, y / FINENESS),
          });
        }
      }
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        this.disposeEntry(e);
        this.entries.delete(id);
      }
    }
    return labels;
  }

  /**
   * The object under a ray (mouse or crosshair), ignoring transparent pixels, nearest
   * first. Returns its id or null.
   */
  pick(raycaster: THREE.Raycaster): number | null {
    const meshes = [...this.entries.values()].filter((e) => e.mesh.visible && e.composite).map((e) => e.mesh);
    for (const hit of raycaster.intersectObjects(meshes, false)) {
      const id = Number(hit.object.name.split(" ")[1]);
      if (id < 0) continue; // projectiles can't be clicked
      const e = this.entries.get(id);
      const c = e?.composite;
      if (!c || !hit.uv) continue;
      const px = Math.min(c.width - 1, Math.max(0, Math.floor(hit.uv.x * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.floor(hit.uv.y * c.height)));
      if (c.pixels[py * c.width + px] !== 254) return id;
    }
    return null;
  }

  /** The user's selected target (gameuser.c SetUserTargetID); null clears. */
  setTarget(id: number | null): void {
    this.target = id;
  }

  private updateHalo(e: Entry, on: boolean, light: number): void {
    if (!on || !e.composite) {
      if (e.halo) e.halo.visible = false;
      return;
    }
    if (!e.halo) {
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: spriteVertex,
        fragmentShader: haloFragment,
        uniforms: { uMap: { value: e.texture }, uColor: { value: new THREE.Vector3() } },
        side: THREE.DoubleSide,
      });
      e.halo = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      e.halo.name = e.mesh.name; // picking the halo picks the object
      e.halo.position.z = -0.01; // just behind the sprite (ZBIAS_TARGETED)
      e.mesh.add(e.halo);
      this.setHaloGeometry(e);
    }
    e.halo.visible = true;
    const k = Math.min(1, light * 2);
    (e.halo.material.uniforms.uColor.value as THREE.Vector3).copy(HALO_COLORS[this.haloColor] ?? HALO_COLORS[0]).multiplyScalar(k);
  }

  private setHaloGeometry(e: Entry): void {
    const c = e.composite;
    if (!e.halo || !c) return;
    e.halo.material.uniforms.uMap.value = e.texture;
    const shrink = (16 * c.width) / c.widthFine;
    const grow = 96 / shrink;
    const l = (c.left - grow) / FINENESS,
      r = (c.left + c.widthFine + grow) / FINENESS;
    const t = (c.top + grow) / FINENESS,
      b = (c.top - c.heightFine - grow) / FINENESS;
    const g = e.halo.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([l, t, 0, l, b, 0, r, b, 0, l, t, 0, r, b, 0, r, t, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]), 2));
    g.computeBoundingSphere();
  }

  /** Highlight the object under the mouse with a brighter tint; null clears. */
  setHighlight(id: number | null): void {
    for (const [eid, e] of this.entries) e.mesh.material.uniforms.uHighlight.value = eid === id ? 1 : 0;
  }

  private setComposite(e: Entry): void {
    e.texture?.dispose();
    e.texture = null;
    const c = e.composite;
    if (!c) return;
    const tex = new THREE.DataTexture(c.pixels, c.width, c.height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    e.texture = tex;
    e.mesh.material.uniforms.uMap.value = tex;
    // Quad in the billboard's local frame (scene units): +X = screen right, +Y = up.
    const l = c.left / FINENESS,
      r = (c.left + c.widthFine) / FINENESS;
    const t = c.top / FINENESS,
      b = (c.top - c.heightFine) / FINENESS;
    const g = e.mesh.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([l, t, 0, l, b, 0, r, b, 0, l, t, 0, r, b, 0, r, t, 0]), 3));
    // texture row 0 is the image's top row (v = 0)
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]), 2));
    g.computeBoundingSphere();
    this.setHaloGeometry(e);
  }

  private disposeEntry(e: Entry): void {
    if (e.halo) {
      e.halo.geometry.dispose();
      e.halo.material.dispose();
    }
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh.material.dispose();
    e.texture?.dispose();
  }

  dispose(): void {
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
  }
}
