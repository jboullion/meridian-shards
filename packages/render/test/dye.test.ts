// Ours (docs/adr/0012-cosmetics.md): dye tables built from ANIMATE_DYE codes.

import { describe, expect, test } from "vitest";
import { DYE_BASE, DYE_SHADE, XlatTable, dyeField, dyeSwatchIndex, encodeDye } from "../src/xlat.ts";

const table = () => new XlatTable(new Uint8Array(768), null);

describe("dyes", () => {
  test("the cloth (red ramp) goes onto the dye's ramp, in its shade", () => {
    const x = table();
    const full = x.dye(encodeDye(dyeField(0xa, DYE_SHADE.FULL)));
    expect(full[0x10]).toBe(0xa0);
    expect(full[0x1f]).toBe(0xaf);
    const light = x.dye(encodeDye(dyeField(0xa, DYE_SHADE.LIGHT)));
    expect(light[0x10]).toBe(0xa0);
    expect(light[0x1f]).toBe(0xa7);
    const dark = x.dye(encodeDye(dyeField(0xa, DYE_SHADE.DARK)));
    expect(dark[0x10]).toBe(0xa8);
    expect(dark[0x1f]).toBe(0xaf);
    // Everything else is left alone
    expect(full[0xd5]).toBe(0xd5);
    expect(full[0x95]).toBe(0x95);
  });

  test("the trim goes on the grey ramp, and the skin on the dark-blue one", () => {
    const x = table();
    const t = x.dye(encodeDye(0, dyeField(0x5, DYE_SHADE.FULL), 1));
    expect(t[0xd3]).toBe(0x53);
    expect(t[0x13]).toBe(0x13);
    // Skin 1 is the second clothing colour (RAMPS[1] = 0x20)
    expect(t[0x94]).toBe(0x24);
  });

  test("a translation past DYE_BASE is read as a dye, and cached", () => {
    const x = table();
    const code = encodeDye(dyeField(0xc, DYE_SHADE.FULL));
    expect(x.get(DYE_BASE + code)).toBe(x.dye(code));
    expect(x.compose(DYE_BASE + code, 0)[0x12]).toBe(0xc2);
  });

  test("swatches sit in the middle of what a shade maps onto", () => {
    expect(dyeSwatchIndex(dyeField(0xa, DYE_SHADE.FULL))).toBe(0xa7);
    expect(dyeSwatchIndex(dyeField(0xa, DYE_SHADE.LIGHT))).toBe(0xa3);
    expect(dyeSwatchIndex(dyeField(0xa, DYE_SHADE.DARK))).toBe(0xab);
  });
});
