// The D3D client's skybox (clientd3d/d3drender.c gSkyboxXYZ / gSkyboxST /
// D3DRenderSkyboxDraw): a 150000 x 74000 fine-unit box drawn around the eye with a
// rotation-only view, no lighting and no fog, before the world.
//
// The table stores (client x, height, client y), which is exactly our scene axes
// (X = x, Y = height, Z = y), so the vertices are used as they are (scaled to squares).

import * as THREE from "three";
import { FINENESS } from "@shards/formats";

const D = 75000;
const H = 37000;
// Per face: 4 corners (x, height, y), in the client's order. Faces: back (north), bottom,
// front (south), left (west), right (east), top. The .bsf images come in this order.
const XYZ = [
  [[D, H, -D], [D, -H, -D], [-D, -H, -D], [-D, H, -D]],
  [[-D, -H, D], [-D, -H, -D], [D, -H, -D], [D, -H, D]],
  [[-D, H, D], [-D, -H, D], [D, -H, D], [D, H, D]],
  [[-D, H, -D], [-D, -H, -D], [-D, -H, D], [-D, H, D]],
  [[D, H, D], [D, -H, D], [D, -H, -D], [D, H, -D]],
  [[-D, H, -D], [-D, H, D], [D, H, D], [D, H, -D]],
];
const ST = [
  [0.001, 0.001],
  [0.001, 0.999],
  [0.999, 0.999],
  [0.999, 0.001],
];

/** Builds the skybox from six decoded face images (in .bsf order). */
export function createSkybox(faces: TexImageSource[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "skybox";
  faces.forEach((img, i) => {
    const pos = new Float32Array(18);
    const uv = new Float32Array(12);
    // two triangles of the quad: (0, 1, 2) and (0, 2, 3)
    [0, 1, 2, 0, 2, 3].forEach((c, k) => {
      const [x, h, y] = XYZ[i][c];
      pos.set([x / FINENESS, h / FINENESS, y / FINENESS], k * 3);
      uv.set([ST[c][0], 1 - ST[c][1]], k * 2); // three's v=0 is the bottom row of an image texture
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

export function disposeSkybox(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.MeshBasicMaterial).map?.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
