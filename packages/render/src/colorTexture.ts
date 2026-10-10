// Smooth textures, as the D3D client draws them: it turns each bitmap into an RGBA texture
// and samples it filtered (d3ddriver.c gD3DDriverProfile.minFilter/magFilter). The original
// adds mipmaps (config.mipMaps); we leave them out, as they soften distant walls. Ours keeps
// the 8-bit index textures for picking and for crisp pixels, and makes these copies beside them.

import * as THREE from "three";
import { TRANSPARENT_INDEX } from "@shards/formats";

/** How many times transparent texels take their neighbours' colour (enough for the filter's reach) */
const BLEED_PASSES = 4;

/**
 * An RGBA copy of palette-index pixels: index 254 is transparent (alpha 0). Transparent
 * texels next to opaque ones take the average of those colours, a few texels deep, so
 * filtering blends into the picture's own colours rather than the palette's
 * cyan or black.
 */
export function paletteToRgba(pixels: Uint8Array, width: number, height: number, palette: Uint8Array): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n * 4);
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = pixels[i];
    if (p === TRANSPARENT_INDEX) continue;
    out[i * 4] = palette[p * 4];
    out[i * 4 + 1] = palette[p * 4 + 1];
    out[i * 4 + 2] = palette[p * 4 + 2];
    out[i * 4 + 3] = 255;
    filled[i] = 1;
  }
  for (let pass = 0; pass < BLEED_PASSES; pass++) {
    const next: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
            const j = yy * width + xx;
            if (!filled[j]) continue;
            r += out[j * 4];
            g += out[j * 4 + 1];
            b += out[j * 4 + 2];
            count++;
          }
        }
        if (!count) continue;
        out[i * 4] = Math.round(r / count);
        out[i * 4 + 1] = Math.round(g / count);
        out[i * 4 + 2] = Math.round(b / count);
        next.push(i);
      }
    }
    if (!next.length) break;
    for (const i of next) filled[i] = 1;
  }
  return out;
}

/**
 * The filtered RGBA texture for `rgba` (paletteToRgba). `repeat` for the room's tiled
 * textures; sprites clamp to their edges.
 */
export function colorTexture(rgba: Uint8Array, width: number, height: number, repeat: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
