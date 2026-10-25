// Ours: drawing the view through a render target, for what the screen alone can't do.
//   - Glowing flames (Enhanced): the scene is drawn again, small, with only what shines
//     (glowPass: sprites of light-giving objects and projectiles, by brightness; the room
//     black), blurred (a dual-filter blur down a chain of ever smaller targets and back up)
//     and added over the view.
//   - Vignette (Enhanced): the corners a little darker.
//   - Grading (Enhanced's moods, moods.ts): exposure, saturation, contrast, and a tint for
//     the shadows and one for the highlights.
// Colours are 8-bit and untouched otherwise, so with all of them off the picture is the
// same as drawing straight to the screen (which GameScene then does instead).

import * as THREE from "three";
import { glowPass } from "./lighting.ts";

export interface PostFxOptions {
  /** How strongly the glow is added, 0 for none */
  bloom: number;
  /** How much darker the corners are, 0 for none */
  vignette: number;
  /** Colour grading (a mood's); none leaves the colours as they are */
  grade?: ColourGrade | null;
  /** Ours (the spell revamp, V4): Heat's shimmer, 0 for none, and the time it waves by (s) */
  shimmer?: number;
  timeS?: number;
}

export interface ColourGrade {
  exposure: number;
  saturation: number;
  contrast: number;
  /** Multiply the dark end and the bright end, blended by brightness */
  shadowGain: readonly [number, number, number];
  highlightGain: readonly [number, number, number];
}

/** Whether these options need the render target at all. */
export const postFxActive = (o: PostFxOptions): boolean => o.bloom > 0 || o.vignette > 0 || !!o.grade || (o.shimmer ?? 0) > 0;

/** Blur levels: each a quarter of the one before, from the glow pass's half size */
const LEVELS = 5;

const quadVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Dual-filter (Kawase) blur: down takes the centre and four diagonal neighbours, up a
// ring of eight around the larger texel, adding the level's own picture back in.
const downFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv - h).rgb + texture(uSrc, vUv + h).rgb;
  c += texture(uSrc, vUv + vec2(h.x, -h.y)).rgb + texture(uSrc, vUv - vec2(h.x, -h.y)).rgb;
  fragColor = vec4(c / 8.0, 1.0);
}
`;
const upFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uSame;
uniform vec2 uTexel;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 c = texture(uSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb + texture(uSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture(uSrc, vUv + vec2(0.0, h.y * 2.0)).rgb + texture(uSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  c += (texture(uSrc, vUv + vec2(-h.x, h.y)).rgb + texture(uSrc, vUv + vec2(h.x, h.y)).rgb) * 2.0;
  c += (texture(uSrc, vUv + vec2(h.x, -h.y)).rgb + texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb) * 2.0;
  fragColor = vec4(c / 12.0 + texture(uSame, vUv).rgb, 1.0);
}
`;
const compositeFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uAspect;
uniform float uGrade;
uniform vec3 uGrading; // exposure, saturation, contrast
uniform vec3 uShadowGain;
uniform vec3 uHighlightGain;
uniform float uShimmer;
uniform float uTime;
// Contrast turns about this grey
const float PIVOT = 0.3;
void main() {
  vec2 uv = vUv;
  // Heat's shimmer: the picture wavers a little, most near the ground
  if (uShimmer > 0.0) uv += uShimmer * 0.0022 * (1.0 - 0.7 * vUv.y) * vec2(sin(vUv.y * 90.0 + uTime * 7.0), 0.5 * sin(vUv.x * 70.0 + uTime * 5.0));
  vec3 c = texture(uScene, uv).rgb;
  if (uBloomStrength > 0.0) c += texture(uBloom, uv).rgb * uBloomStrength;
  if (uGrade > 0.5) {
    c *= uGrading.x;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uGrading.y);
    c = max(vec3(0.0), (c - PIVOT) * uGrading.z + PIVOT);
    c *= mix(uShadowGain, uHighlightGain, smoothstep(0.05, 0.85, l));
  }
  if (uVignette > 0.0) {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.45, 1.05, length(p) * 1.15);
  }
  fragColor = vec4(min(c, vec3(1.0)), 1.0);
}
`;

const target = (w: number, h: number, depth = false): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    depthBuffer: depth,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

export class PostFx {
  private scene: THREE.WebGLRenderTarget | null = null;
  private glow: THREE.WebGLRenderTarget | null = null;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private width = 0;
  private height = 0;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly downMaterial = this.material(downFragment, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private readonly upMaterial = this.material(upFragment, { uSrc: { value: null }, uSame: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private readonly compositeMaterial = this.material(compositeFragment, {
    uScene: { value: null },
    uBloom: { value: null },
    uBloomStrength: { value: 0 },
    uVignette: { value: 0 },
    uAspect: { value: 1 },
    uGrade: { value: 0 },
    uGrading: { value: new THREE.Vector3(1, 1, 1) },
    uShadowGain: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightGain: { value: new THREE.Vector3(1, 1, 1) },
    uShimmer: { value: 0 },
    uTime: { value: 0 },
  });

  constructor() {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  }

  /** The targets for this drawing-buffer size. */
  private ensure(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.scene && size.x === this.width && size.y === this.height) return;
    this.disposeTargets();
    this.width = size.x;
    this.height = size.y;
    this.scene = target(size.x, size.y, true);
    const gw = Math.ceil(size.x / 2),
      gh = Math.ceil(size.y / 2);
    this.glow = target(gw, gh, true);
    for (let i = 0; i < LEVELS; i++) {
      const d = 2 ** (i + 1);
      this.down.push(target(Math.ceil(gw / d), Math.ceil(gh / d)));
      if (i < LEVELS - 1) this.up.push(target(Math.ceil(gw / d), Math.ceil(gh / d)));
    }
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(to);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Draws `scene` to the screen through the effects. `hideForGlow`: what the glow pass
   * leaves out (the sky, weather, shadows: drawn with materials of their own). `afterScene`
   * (ours, V6): drawn into the view's picture right after it (invisible figures, which copy it).
   */
  render(
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: PostFxOptions, hideForGlow: (THREE.Object3D | null | undefined)[],
    afterScene?: () => void,
  ): void {
    this.ensure(renderer);
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);
    afterScene?.();

    const u = this.compositeMaterial.uniforms;
    u.uBloomStrength.value = 0;
    if (options.bloom > 0) {
      // The glow pass: only what shines, on black
      const hidden = hideForGlow.filter((o): o is THREE.Object3D => !!o && o.visible);
      for (const o of hidden) o.visible = false;
      glowPass.value = 1;
      renderer.setRenderTarget(this.glow);
      renderer.render(scene, camera);
      glowPass.value = 0;
      for (const o of hidden) o.visible = true;
      // Down the chain, then back up, each level adding its own picture
      let src = this.glow!;
      for (const d of this.down) {
        this.downMaterial.uniforms.uSrc.value = src.texture;
        this.downMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.downMaterial, d);
        src = d;
      }
      for (let i = LEVELS - 2; i >= 0; i--) {
        this.upMaterial.uniforms.uSrc.value = src.texture;
        this.upMaterial.uniforms.uSame.value = this.down[i].texture;
        this.upMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.upMaterial, this.up[i]);
        src = this.up[i];
      }
      u.uBloom.value = src.texture;
      u.uBloomStrength.value = options.bloom / LEVELS;
    }
    u.uScene.value = this.scene!.texture;
    u.uVignette.value = options.vignette;
    const g = options.grade;
    u.uGrade.value = g ? 1 : 0;
    if (g) {
      u.uGrading.value.set(g.exposure, g.saturation, g.contrast);
      u.uShadowGain.value.set(...g.shadowGain);
      u.uHighlightGain.value.set(...g.highlightGain);
    }
    u.uShimmer.value = options.shimmer ?? 0;
    u.uTime.value = options.timeS ?? 0;
    u.uAspect.value = this.width / Math.max(1, this.height);
    this.pass(renderer, this.compositeMaterial, null);
  }

  private disposeTargets(): void {
    this.scene?.dispose();
    this.glow?.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.scene = this.glow = null;
    this.down = [];
    this.up = [];
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.geometry.dispose();
    for (const m of [this.downMaterial, this.upMaterial, this.compositeMaterial]) m.dispose();
  }
}
