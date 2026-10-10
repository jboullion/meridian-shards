// Room objects as camera-facing sprites (clientd3d/d3drender.c D3DRenderObjectsDraw).
// Billboards turn with the view heading (cylindrical, like mPlayerHeadingTrans),
// stand on the floor (minus water depth), and are lit like the D3D client.

import * as THREE from "three";
import { FINENESS, SF, ceilingHeightAt, floorHeightAt, leafAt, type Bgf, type Room } from "@shards/formats";
import { compositeSprite, frameFor, type Composite, type SpritePart } from "./sprites.ts";
import type { XlatTable } from "./xlat.ts";
import { colorTexture, paletteToRgba } from "./colorTexture.ts";
import { glowPass } from "./lighting.ts";
import { MAX_LIGHTS, dlightScale, fixedSin, flashStep, flicker, fogEnd, highlightScale, isFireColor, isHighlightLight, lightColor, objectBrightness, type LightSource } from "./objectLighting.ts";

/** Object flags (include/proto.h OF_*) and draw effects (DRAWFX_*). */
export const OF = {
  DISPLAY_NAME: 0x1, SIGN: 0x2, PLAYER: 0x4, ATTACKABLE: 0x8, GETTABLE: 0x10, HANGING: 0x100, NPC: 0x2000, BOUNCING: 0x10000, FLASHING: 0x40000,
} as const;
/** Ours (shadows under figures): who stands on the floor and casts one */
const CASTS_SHADOW = OF.PLAYER | OF.ATTACKABLE | OF.NPC | OF.GETTABLE;
/** moveobj.c OBJECT_BOUNCE_HEIGHT, TIME_FULL_OBJECT_BOUNCE */
const OBJECT_BOUNCE_HEIGHT = FINENESS >> 4;
const TIME_FULL_OBJECT_BOUNCE = 2000;
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
  /** A height of its own instead of the floor's (projectiles fly from source to target: project.c) */
  z?: number;
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
  /** ms since the last update (flashing and bouncing objects) */
  dt?: number;
  /** Ours (Enhanced lighting): flames flicker, by this clock (ms) */
  flicker?: boolean;
  timeMs?: number;
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
uniform sampler2D uColorMap;
uniform float uColorMode;
uniform sampler2D uPalette;
uniform vec3 uBrightness;
uniform float uAlpha;
uniform float uFogEnd;
uniform float uFog;
// Ours: the glow pass (postFx.ts) draws only what shines, flames and spells, by brightness
uniform float uGlowPass;
uniform float uEmissive;
void main() {
  vec3 rgb;
  if (uColorMode > 0.5) {
    // Smooth textures (colorTexture.ts)
    vec4 c = texture(uColorMap, vUv);
    if (c.a < 0.5) discard;
    rgb = c.rgb;
  } else {
    float index = floor(texture(uMap, vUv).r * 255.0 + 0.5);
    if (index == 254.0) discard;
    rgb = texelFetch(uPalette, ivec2(int(index), 0), 0).rgb;
  }
  float fog = uFog > 0.5 ? clamp((uFogEnd - vDepth) / uFogEnd, 0.0, 1.0) : 1.0;
  if (uGlowPass > 0.5) {
    float glow = uEmissive * smoothstep(0.55, 0.95, max(rgb.r, max(rgb.g, rgb.b)));
    fragColor = vec4(rgb * glow * fog, 1.0);
    return;
  }
  fragColor = vec4(rgb * uBrightness * fog, uAlpha);
}
`;

/**
 * The target halo (d3drender.c, isTargeted chunks): the sprite's shape, stretched 96 /
 * shrink fine units further on each side, drawn behind it in one colour (red by
 * default, config.halocolor) at twice the object's light.
 */
const haloFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uGlowPass;
void main() {
  float index = floor(texture(uMap, vUv).r * 255.0 + 0.5);
  if (index == 254.0) discard;
  fragColor = vec4(uGlowPass > 0.5 ? vec3(0.0) : uColor, 1.0);
}
`;
/**
 * Ours (shadows under figures): a soft dark disc on the floor, darkest in the middle. It
 * darkens whatever light the floor has, so it shows less in the dark.
 */
const shadowVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const shadowFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uStrength;
void main() {
  float a = uStrength * (1.0 - smoothstep(0.2, 1.0, length(vUv * 2.0 - 1.0)));
  if (a < 0.004) discard;
  fragColor = vec4(0.0, 0.0, 0.0, a);
}
`;
/** How dark a shadow's middle is, and its radius for a sprite's width (fine units) */
const SHADOW_STRENGTH = 0.65;
const shadowRadius = (widthFine: number): number => Math.max(128, Math.min(640, widthFine * 0.65));

/** config.h TARGET_COLOR_*: 0 red (the default), 1 blue, 2 green */
export const HALO_COLORS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)];
/** proto.h LIGHT_BRED, LIGHT_BBLUE, LIGHT_BGREEN: the targeting light's colour, by halo colour */
const TARGET_LIGHT_COLORS = [0x7c00, 0x001f, 0x03e0];

interface Entry {
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  key: string;
  composite: Composite | null;
  texture: THREE.DataTexture | null;
  /** The RGBA copy of `texture` while the filter uses one (colorTexture.ts) */
  colorTexture: THREE.DataTexture | null;
  /** Ours: its shadow on the floor (shadows under figures), made when first needed */
  shadow: THREE.Mesh | null;
  /** client position and ground height */
  x: number;
  y: number;
  z: number;
  /** OF_FLASHING clock and light adjustment (animate.c obj.bounceTime, obj.lightAdjust) */
  flashTime: number;
  lightAdjust: number;
  /** OF_BOUNCING clock (moveobj.c obj.bounceTime) */
  bounceTime: number;
}

export class ObjectsView {
  readonly group = new THREE.Group();
  /** Ours: the shadows under figures (hidden for the glow pass, postFx.ts) */
  readonly shadows = new THREE.Group();
  /** Ours: shadows under figures */
  shadowsOn = false;
  private readonly shadowGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly shadowMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: shadowVertex,
    fragmentShader: shadowFragment,
    uniforms: { uStrength: { value: SHADOW_STRENGTH } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  private readonly entries = new Map<number, Entry>();
  private readonly palette: THREE.Texture;
  private readonly xlats: XlatTable;
  private readonly getBgf: (resource: number) => Bgf | null | undefined;
  private readonly resourceName: (resource: number) => string | undefined;
  private target: number | null = null;
  /** config.halocolor (HALO_COLORS) */
  haloColor = 0;
  /** Smooth textures: sprites drawn from filtered RGBA copies; off, crisp */
  private smooth = false;
  /** config.draw_player_names, draw_npc_names, draw_sign_names (d3drender.c D3DRenderNamesDraw3D) */
  names = { players: true, npcs: true, signs: true };

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
    this.shadows.name = "shadows";
    this.group.add(this.shadows);
  }


  /** Where each light-giving object was last frame, to tell moving lights (ours: lightOcclusion.ts) */
  private lightPlaces = new Map<number, string>();

  /**
   * Light sources from objects with a light (D3DLMapsStaticGet). The shader takes 32 (the
   * original 150), so with more we keep the 32 nearest the viewer.
   */
  lights(objects: Iterable<ViewObject>, ctx: ObjectViewContext): LightSource[] {
    let out: LightSource[] = [];
    const places = new Map<number, string>();
    for (const o of objects) {
      const l = o.info.light;
      if (!l.color || !l.intensity) continue;
      const { x, y } = o;
      const ground = this.ground(o, x, y, ctx);
      const bgf = this.getBgf(o.info.iconRes);
      const b = bgf ? frameFor(bgf, 0, 0) : null;
      const top = b && bgf ? (16 * b.height) / bgf.shrink - b.yOffset * 4 : 0;
      const z = ground + top;
      const place = `${x},${y},${z}`;
      places.set(o.id, place);
      const moving = o.id < 0 || this.lightPlaces.get(o.id) !== place;
      // Signs glow with a highlight light: a small circle at their foot
      const highlight = isHighlightLight(l.flags);
      let scale = highlight ? highlightScale(l.intensity) : dlightScale(l.intensity);
      let c = lightColor(l.color);
      if (ctx.flicker && isFireColor(c.r, c.g, c.b)) {
        const f = flicker(o.id, ctx.timeMs ?? 0);
        c = { r: c.r * f, g: c.g * f, b: c.b * f };
        scale *= 0.97 + 0.03 * f;
      }
      out.push({ x, y, z, scale, ...c, id: o.id, moving, highlight });
    }
    this.lightPlaces = places;
    if (out.length > MAX_LIGHTS) {
      const d = (l: LightSource) => Math.hypot(l.x - ctx.viewer.x, l.y - ctx.viewer.y);
      out = out.sort((a, b) => d(a) - d(b)).slice(0, MAX_LIGHTS);
    }
    return out;
  }

  /**
   * The targeting light (d3dlighting.c, config.target_highlight): a full-strength dynamic
   * light in the halo's colour on the floor under the target, LIGHT_FLAG_HIGHLIGHT: a tenth
   * of a full light's size, with no falloff on the floor.
   */
  targetLight(o: ViewObject, ctx: ObjectViewContext): LightSource {
    const c = lightColor(TARGET_LIGHT_COLORS[this.haloColor] ?? TARGET_LIGHT_COLORS[0]);
    return { x: o.x, y: o.y, z: this.ground(o, o.x, o.y, ctx), scale: highlightScale(255), ...c, id: o.id, highlight: true, moving: true };
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
            uColorMap: { value: null },
            uColorMode: { value: 0 },
            uPalette: { value: this.palette },
            uBrightness: { value: new THREE.Vector3(1, 1, 1) },
            uAlpha: { value: 1 },
            uFogEnd: { value: 100000 },
            uFog: { value: 1 },
            uGlowPass: glowPass,
            uEmissive: { value: 0 },
          },
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.name = `object ${o.id}`;
        this.group.add(mesh);
        e = { mesh, halo: null, key: "", composite: null, texture: null, colorTexture: null, shadow: null, x, y, z: 0, flashTime: 0, lightAdjust: 0, bounceTime: 0 };
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
        if (e.shadow) e.shadow.visible = false;
        continue;
      }
      e.mesh.visible = true;
      e.x = x;
      e.y = y;
      e.z = o.z ?? this.ground(o, x, y, ctx, e.composite.heightFine);
      const dtMs = ctx.dt ?? 0;
      if (o.info.flags & OF.BOUNCING && !(o.info.flags & OF.PLAYER)) {
        // moveobj.c AnimateObjects: bob up and down above the floor (fairies, wasps, seekers)
        e.bounceTime += Math.min(dtMs, 40);
        if (e.bounceTime > TIME_FULL_OBJECT_BOUNCE) e.bounceTime -= TIME_FULL_OBJECT_BOUNCE;
        const angle = Math.trunc((4096 * e.bounceTime) / TIME_FULL_OBJECT_BOUNCE);
        const leaf = leafAt(ctx.room, x, y);
        if (leaf?.sector) e.z = floorHeightAt(ctx.room.sectors[leaf.sector - 1], x, y) + OBJECT_BOUNCE_HEIGHT + fixedSin(OBJECT_BOUNCE_HEIGHT, angle);
      }
      if (o.info.flags & OF.FLASHING) [e.flashTime, e.lightAdjust] = flashStep(e.flashTime, dtMs);
      else e.lightAdjust = 0;
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
          : objectBrightness({ x, y, z: e.z }, sectorLight, ctx.viewerLight, ctx.ambient, lights, e.lightAdjust);
      (u.uBrightness.value as THREE.Vector3).set(r, g, b);
      u.uFogEnd.value = fogEnd(sectorLight, ctx.viewerLight, ctx.ambient);
      u.uFog.value = ctx.fog && !o.fullBright ? 1 : 0;
      const alpha =
        dt === DRAWFX.TRANSLUCENT25 ? 0.25 : dt === DRAWFX.TRANSLUCENT75 ? 0.75
        : dt === DRAWFX.TRANSLUCENT50 || dt === DRAWFX.DITHERTRANS || dt === DRAWFX.DITHERINVIS || dt === DRAWFX.DITHERGREY ? 0.5 : 1;
      u.uAlpha.value = alpha;
      e.mesh.material.transparent = alpha < 1;
      e.mesh.material.depthWrite = alpha >= 1;
      // Ours, the glow pass: flames and spells shine (not signs' highlight lights, nor players carrying a light)
      const l = o.info.light;
      u.uEmissive.value = o.fullBright || (l.color && l.intensity && !isHighlightLight(l.flags) && !(o.info.flags & OF.PLAYER)) ? 1 : 0;
      this.updateHalo(e, o.id === this.target, r);
      this.updateShadow(e, o, ctx, alpha);

      // Name labels (d3drender.c D3DRenderNamesDraw3D)
      const f = o.info.flags;
      const hidden = (!this.names.players && f & OF.PLAYER) || (!this.names.npcs && f & OF.NPC) || (!this.names.signs && f & OF.SIGN);
      if (f & OF.DISPLAY_NAME && !hidden) {
        const dist = Math.hypot(dx, dy);
        if (o.info.flags & OF.SIGN || dist < MAX_NAME_DISTANCE) {
          const c = o.info.nameColor;
          const k = Math.max(r, g, b);
          const col = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => Math.round(v * Math.min(1, k * (255 / 239))));
          labels.push({
            id: o.id,
            name: this.resourceName(o.info.nameRes) ?? "",
            color: `rgb(${col.join(",")})`,
            position: this.topOf(o.id)!,
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

  /** Where an object's name label would go (the top of its sprite), or null when it isn't drawn. */
  topOf(id: number): THREE.Vector3 | null {
    const e = this.entries.get(id);
    if (!e?.composite || !e.mesh.visible) return null;
    return new THREE.Vector3(e.x / FINENESS, (e.z + Math.max(e.composite.baseTop, e.composite.top)) / FINENESS, e.y / FINENESS);
  }

  /** An object's ground height and sprite height in fine units (game.c SetPlayerRemoteView), or null. */
  extentOf(id: number): { z: number; height: number } | null {
    const e = this.entries.get(id);
    if (!e?.composite) return null;
    return { z: e.z, height: Math.max(e.composite.baseTop, e.composite.top) };
  }

  /**
   * The object under a ray (mouse or crosshair), ignoring transparent pixels, nearest
   * first. Returns its id or null.
   */
  pick(raycaster: THREE.Raycaster, ignore?: number): number | null {
    return this.pickAll(raycaster, ignore)[0]?.id ?? null;
  }

  /**
   * Every object drawn under the ray (an opaque pixel of its sprite), nearest first, with the
   * distance along the ray: client3d.c GetObjects3D at a screen point, for choosing among them.
   */
  pickAll(raycaster: THREE.Raycaster, ignore?: number): { id: number; distance: number }[] {
    // `ignore`: our own sprite, drawn in the third-person views but never picked
    const meshes = [...this.entries.entries()].filter(([id, e]) => id !== ignore && e.mesh.visible && e.composite).map(([, e]) => e.mesh);
    const out: { id: number; distance: number }[] = [];
    for (const hit of raycaster.intersectObjects(meshes, false)) {
      const id = Number(hit.object.name.split(" ")[1]);
      if (id < 0 || out.some((o) => o.id === id)) continue; // projectiles can't be clicked
      const e = this.entries.get(id);
      const c = e?.composite;
      if (!c || !hit.uv) continue;
      const px = Math.min(c.width - 1, Math.max(0, Math.floor(hit.uv.x * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.floor(hit.uv.y * c.height)));
      if (c.pixels[py * c.width + px] !== 254) out.push({ id, distance: hit.distance });
    }
    return out;
  }

  /** The user's selected target (gameuser.c SetUserTargetID); null clears. */
  setTarget(id: number | null): void {
    this.target = id;
  }

  /** Ours (shadows under figures): the disc under someone standing on the floor. */
  private updateShadow(e: Entry, o: ViewObject, ctx: ObjectViewContext, alpha: number): void {
    const c = e.composite;
    const on = this.shadowsOn && c && o.z === undefined && !o.fullBright && o.info.flags & CASTS_SHADOW && !(o.info.flags & OF.HANGING) && o.info.drawingType !== DRAWFX.BLACK;
    if (!on) {
      if (e.shadow) e.shadow.visible = false;
      return;
    }
    if (!e.shadow) {
      e.shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
      e.shadow.name = `shadow ${o.id}`;
      e.shadow.raycast = () => {}; // never picked
      this.shadows.add(e.shadow);
    }
    // The faintest translucent figures (25%) cast none
    e.shadow.visible = alpha > 0.3;
    const floor = this.ground(o, e.x, e.y, ctx);
    const r = shadowRadius(c.widthFine) / FINENESS;
    e.shadow.position.set(e.x / FINENESS, (floor + 2) / FINENESS, e.y / FINENESS);
    e.shadow.scale.set(r, 1, r);
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
        uniforms: { uMap: { value: e.texture }, uColor: { value: new THREE.Vector3() }, uGlowPass: glowPass },
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

  /** Smooth textures (Graphics Options): sprites filtered, as the original; off, crisp pixels. */
  setSmoothTextures(smooth: boolean): void {
    if (smooth === this.smooth) return;
    this.smooth = smooth;
    for (const e of this.entries.values()) this.setColorTexture(e);
  }

  /** The sprite's RGBA copy, made or dropped as Smooth textures needs. */
  private setColorTexture(e: Entry): void {
    e.colorTexture?.dispose();
    e.colorTexture = null;
    const c = e.composite;
    const u = e.mesh.material.uniforms;
    if (c && this.smooth) {
      const palette = (this.palette.image as { data: Uint8Array }).data;
      e.colorTexture = colorTexture(paletteToRgba(c.pixels, c.width, c.height, palette), c.width, c.height, false);
    }
    u.uColorMap.value = e.colorTexture;
    u.uColorMode.value = e.colorTexture ? 1 : 0;
  }

  private setComposite(e: Entry): void {
    e.texture?.dispose();
    e.texture = null;
    const c = e.composite;
    this.setColorTexture(e);
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
    e.colorTexture?.dispose();
    if (e.shadow) this.shadows.remove(e.shadow);
  }

  dispose(): void {
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
  }
}
