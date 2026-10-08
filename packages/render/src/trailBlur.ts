// Blurred and wavering vision (EFFECT_BLUR, EFFECT_WAVER) as the D3D client draws both
// (d3drender.c D3DRenderBegin, "EFFECTS: BLUR/WAVER"): each frame is copied into one of
// eight 256 x 256 textures in turn, and all eight are drawn back over the view at a
// quarter opacity, enlarged by an offset that swings between 0 and 31 pixels. The last
// eight frames smear into each other, and the view seems to breathe.

import * as THREE from "three";

const HISTORY = 8;
const HISTORY_SIZE = 256;

export class TrailBlur {
  private readonly history: THREE.WebGLRenderTarget[] = [];
  private frameTexture: THREE.FramebufferTexture | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private frame = 0;
  private offset = 0;
  private offsetDir = 1;

  constructor() {
    for (let i = 0; i < HISTORY; i++)
      this.history.push(new THREE.WebGLRenderTarget(HISTORY_SIZE, HISTORY_SIZE, { depthBuffer: false, colorSpace: THREE.NoColorSpace }));
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.scene.add(this.quad);
  }

  /** Call right after the view has been drawn to the screen. */
  apply(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.frameTexture || this.frameTexture.image.width !== size.x || this.frameTexture.image.height !== size.y) {
      this.frameTexture?.dispose();
      this.frameTexture = new THREE.FramebufferTexture(size.x, size.y);
    }
    // D3DRenderFramebufferTextureCreate(gpBackBufferTexFull, gpBackBufferTex[gFrame & 7], 256, 256)
    renderer.copyFramebufferToTexture(this.frameTexture);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const m = this.quad.material;
    m.map = this.frameTexture;
    m.transparent = false;
    m.opacity = 1;
    m.needsUpdate = true;
    this.quad.scale.set(1, 1, 1);
    renderer.setRenderTarget(this.history[this.frame & 7]);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);

    if (this.frame & 63) {
      this.offset += this.offsetDir;
      if (this.offset > 31 || this.offset < 0) {
        this.offsetDir = -this.offsetDir;
        this.offset += this.offsetDir;
      }
    }
    // Each layer covers the screen grown by `offset` pixels on every side, at a quarter opacity
    m.transparent = true;
    m.opacity = 0.25;
    this.quad.scale.set((size.x + 2 * this.offset) / size.x, (size.y + 2 * this.offset) / size.y, 1);
    for (const target of this.history) {
      m.map = target.texture;
      m.needsUpdate = true;
      renderer.render(this.scene, this.camera);
    }
    renderer.autoClear = autoClear;
    this.frame++;
  }

  dispose(): void {
    for (const t of this.history) t.dispose();
    this.frameTexture?.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
