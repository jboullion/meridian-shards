// .bsf skybox files: six PNG images back to back (clientd3d/d3drender.c
// D3DRenderBackgroundsLoad). Face order matches the client's gSkyboxXYZ table:
// 0 north (y = -D), 1 bottom, 2 south (y = +D), 3 west (x = -D), 4 east (x = +D), 5 top.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Split a .bsf into its six PNG files (by walking each PNG's chunks to IEND). */
export function splitBsf(data: Uint8Array): Uint8Array[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Uint8Array[] = [];
  let p = 0;
  while (p + 8 <= data.length && out.length < 6) {
    for (let i = 0; i < 8; i++) if (data[p + i] !== PNG_SIG[i]) throw new Error(`bad PNG signature at ${p}`);
    let q = p + 8;
    for (;;) {
      const len = dv.getUint32(q);
      const type = String.fromCharCode(data[q + 4], data[q + 5], data[q + 6], data[q + 7]);
      q += 12 + len;
      if (type === "IEND") break;
      if (q > data.length) throw new Error("truncated PNG in .bsf");
    }
    out.push(data.subarray(p, q));
    p = q;
  }
  if (out.length !== 6) throw new Error(`.bsf has ${out.length} images, expected 6`);
  return out;
}

/** The skybox file for a room background resource name (D3DRenderBackgroundSet2). */
export function skyboxForBackground(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("skya.bgf")) return "skya.bsf";
  if (n.includes("skyb.bgf")) return "skyb.bsf";
  if (n.includes("skyc.bgf")) return "skyc.bsf";
  if (n.includes("skyd.bgf")) return "skyd.bsf";
  if (n.includes("redsky")) return "redsky.bsf";
  return null;
}
