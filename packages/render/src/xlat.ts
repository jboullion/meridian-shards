// Palette translations ("xlats"), ported from clientd3d/xlat.c InitStandardXlats.
// An xlat maps each of the 256 palette indices to another index; the server picks
// them per object/overlay (skin, hair and clothing colours, guild shields, effects).
// The D3D client draws a texel as palette[xlat1[xlat0[index]]] (d3drender.c
// D3DRenderPaletteSetNew).

/** xlat ids (clientd3d/xlat.h). */
export const XLAT = {
  IDENTITY: 0x00,
  DBLUETOSKIN1: 0x01, DBLUETOSKIN2: 0x02, DBLUETOSKIN3: 0x03, DBLUETOSKIN4: 0x04,
  DBLUETOSICKGREEN: 0x05, DBLUETOSICKYELLOW: 0x06, DBLUETOGRAY: 0x07, DBLUETOLBLUE: 0x08, DBLUETOASHEN: 0x09,
  GRAYTOORANGE: 0x0a, GRAYTODGREEN: 0x0b, GRAYTOBGREEN: 0x0c, GRAYTOSKY: 0x0d, GRAYTODBLUE: 0x0e,
  GRAYTOPURPLE: 0x0f, GRAYTOGOLD: 0x10, GRAYTOBBLUE: 0x11, GRAYTORED: 0x12,
  GRAYTOLORANGE: 0x13, GRAYTOLGREEN: 0x14, GRAYTOLBGREEN: 0x15, GRAYTOLSKY: 0x16, GRAYTOLBLUE: 0x17,
  GRAYTOLPURPLE: 0x18, GRAYTOLGOLD: 0x19,
  GRAYTOSKIN1: 0x1a, GRAYTOSKIN2: 0x1b, GRAYTOSKIN3: 0x1c, GRAYTOSKIN4: 0x1d, GRAYTOSKIN5: 0x1e,
  GRAYTOLBBLUE: 0x20, GRAYTOLRED: 0x21, GRAYTOKORANGE: 0x22, GRAYTOKGREEN: 0x23, GRAYTOKBGREEN: 0x24,
  GRAYTOKSKY: 0x25, GRAYTOKBLUE: 0x26, GRAYTOKPURPLE: 0x27, GRAYTOKGOLD: 0x28, GRAYTOKBBLUE: 0x29,
  GRAYTOKRED: 0x2a, GRAYTOKGRAY: 0x2b,
  GRAYTOBLACK: 0x2c, GRAYTOOLDHAIR1: 0x2d, GRAYTOOLDHAIR2: 0x2e, GRAYTOOLDHAIR3: 0x2f, GRAYTOPLATBLOND: 0x30,
  FILTERWHITE90: 0x31, FILTERWHITE80: 0x32, FILTERWHITE70: 0x33,
  FILTERBRIGHT1: 0x36, FILTERBRIGHT2: 0x37, FILTERBRIGHT3: 0x38,
  BLEND25YELLOW: 0x39,
  PURPLETOLBLUE: 0x3a, PURPLETOBRED: 0x3b, PURPLETOGREEN: 0x3c, PURPLETOYELLOW: 0x3d,
  BLEND10RED: 0x41, BLEND20RED: 0x42, BLEND30RED: 0x43, BLEND40RED: 0x44, BLEND50RED: 0x45,
  BLEND60RED: 0x46, BLEND70RED: 0x47, BLEND80RED: 0x48, BLEND90RED: 0x49, BLEND100RED: 0x4a,
  FILTERRED: 0x4d, FILTERBLUE: 0x4e, FILTERGREEN: 0x4f,
  BLEND25RED: 0x51, BLEND25BLUE: 0x52, BLEND25GREEN: 0x53,
  BLEND50BLUE: 0x55, BLEND50GREEN: 0x56, BLEND75RED: 0x57, BLEND75BLUE: 0x58, BLEND75GREEN: 0x59,
  REDTOBLACK: 0x5a, BLUETOBLACK: 0x5b, PURPLETOBLACK: 0x5c,
  RAMPUP1: 0x60, RAMPUP2: 0x61, RAMPDOWN2: 0x6e, RAMPDOWN1: 0x6f,
  BLEND10WHITE: 0x70, BLEND20WHITE: 0x71, BLEND30WHITE: 0x72, BLEND40WHITE: 0x73, BLEND50WHITE: 0x74,
  BLEND60WHITE: 0x75, BLEND70WHITE: 0x76, BLEND80WHITE: 0x77, BLEND90WHITE: 0x78, BLEND100WHITE: 0x79,
  REDTODGREEN1: 0x7a, REDTODGREEN2: 0x7b, REDTODGREEN3: 0x7c,
  REDTOBLACK1: 0x7d, REDTOBLACK2: 0x7e, REDTOBLACK3: 0x7f,
  REDTODKBLACK1: 0x80, REDTODKBLACK2: 0x81, REDTODKBLACK3: 0x82,
  REDBLK_BLWHT: 0x83, BLBLK_REDWHT: 0x84,
  GUILDCOLOR_BASE: 0x87, GUILDCOLOR_END: 0xff,
} as const;

const LIGHT_LEVELS = 64;

const OLDHAIR1 = [0x23, 0x32, 0x34, 0x36, 0x59, 0x39, 0x3a, 0x3b, 0x36, 0x38, 0x5b, 0x47, 0x3c, 0x5c, 0x5e, 0x5e];
const OLDHAIR2 = [0x50, 0x23, 0x24, 0x33, 0x25, 0x34, 0x26, 0x35, 0x27, 0x36, 0x28, 0x37, 0x29, 0x38, 0x2a, 0x39];
const OLDHAIR3 = [0xc4, 0x52, 0xc6, 0x53, 0xc8, 0x54, 0xca, 0x55, 0x56, 0x57, 0x58, 0x58, 0x59, 0x59, 0x5a, 0x5b];
const PLATBLOND = [0xb0, 0xb0, 0xb1, 0xb1, 0xb2, 0xb2, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd9, 0xda];
const SKIN1 = [0x20, 0xf0, 0xf0, 0x21, 0x21, 0x22, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b];
const SKIN2 = [0x20, 0x20, 0xf0, 0x21, 0x22, 0x23, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c];
const GREEN_SKIN = [0xd0, 0xd0, 0xb0, 0xb8, 0x60, 0x60, 0x61, 0x61, 0x62, 0x63, 0x64, 0x66, 0x67, 0x68, 0x6a, 0x6c];
const YELLOW_SKIN = [0xd0, 0xd0, 0xb0, 0xb0, 0xb1, 0xb2, 0xb3, 0xc0, 0xc6, 0xc9, 0xca, 0xcc, 0xcd, 0xce, 0xcf, 0xcf];
// Guild colours and fabric/skin ramps; must be eleven ramps.
const RAMPS = [0x10, 0x20, 0x30, 0x40, 0x50, 0x70, 0x90, 0xa0, 0xc0, 0xd0, 0xe0];

export class XlatTable {
  private readonly tables = new Map<number, Uint8Array>();
  private readonly rgb: Uint8Array;
  private readonly lightPalettes: Uint8Array | null;

  /**
   * @param rgb the 256-entry palette (768 bytes)
   * @param lightPalettes clientd3d light_palettes (65 x 256) from the asset build's
   *   lightpal.bin; without it the light-based xlats fall back to identity.
   */
  constructor(rgb: Uint8Array, lightPalettes: Uint8Array | null) {
    this.rgb = rgb;
    this.lightPalettes = lightPalettes;
    this.init();
  }

  /** The 256-entry table for an xlat id (identity for unknown ids, like a NULL xlat). */
  get(id: number): Uint8Array {
    return this.tables.get(id) ?? this.tables.get(XLAT.IDENTITY)!;
  }

  /** Composite map: index -> xlat1[xlat0[index]]. */
  compose(xlat0: number, xlat1: number): Uint8Array {
    const a = this.get(xlat0),
      b = this.get(xlat1);
    const out = new Uint8Array(256);
    for (let i = 0; i < 256; i++) out[i] = b[a[i]];
    return out;
  }

  private identity(): Uint8Array {
    return Uint8Array.from({ length: 256 }, (_, i) => i);
  }

  private set(id: number, t: Uint8Array): Uint8Array {
    this.tables.set(id, t);
    return t;
  }

  /** GDI GetNearestPaletteIndex: closest palette colour (squared RGB distance). */
  private nearest(r: number, g: number, b: number): number {
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < 256; i++) {
      const dr = this.rgb[i * 3] - r,
        dg = this.rgb[i * 3 + 1] - g,
        db = this.rgb[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
        if (d === 0) break;
      }
    }
    return best;
  }

  private blend(id: number, mix: [number, number, number], first: number, second: number): void {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const c = [0, 1, 2].map((k) => Math.trunc((this.rgb[i * 3 + k] * first + mix[k] * second) / (first + second)) & 0xff);
      t[i] = this.nearest(c[0], c[1], c[2]);
    }
    this.set(id, t);
  }

  private filter(id: number, mix: [number, number, number]): void {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const l = Math.max(this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]);
      const c = mix.map((m) => Math.trunc((m * l) / 256) & 0xff);
      t[i] = this.nearest(c[0], c[1], c[2]);
    }
    this.set(id, t);
  }

  private ramp(t: Uint8Array, mask: number, from: number, to: number): void {
    if (from === to) return;
    for (let i = 0; i < 256; i++) if ((i & mask) === from) t[i] = (i & ~mask & 0xff) | to;
  }

  private halfRamp(t: Uint8Array, mask: number, from: number, to: number, offset: number): void {
    for (let i = 0; i < 256; i++) if ((i & mask) === from) t[i] = ((Math.trunc((i & ~mask & 0xff) / 2) | to) + offset) & 0xff;
  }

  private light(t: Uint8Array, mask: number, from: number, level: number): void {
    if (!this.lightPalettes) return;
    const row = this.lightPalettes.subarray(level * 256, level * 256 + 256);
    for (let i = 0; i < 256; i++) if ((i & mask) === from) t[i] = row[t[i]];
  }

  private rampMove(t: Uint8Array, mask: number, from: number, indexes: number[]): void {
    let n = 0;
    for (let i = 0; i < 256; i++) if ((i & mask) === from) t[i] = indexes[n++];
  }

  private rampOffset(offset: number): Uint8Array {
    const t = this.identity();
    const j = RAMPS.length;
    if (offset < 0) offset += (1 - Math.trunc(offset / j)) * j;
    for (let r = 0; r < j; r++)
      for (let i = RAMPS[r]; i < RAMPS[r] + 0x10; i++) t[i] = (i & 0x0f) | RAMPS[(r + offset + j) % j];
    return t;
  }

  private init(): void {
    const X = XLAT;
    this.set(X.IDENTITY, this.identity());
    const red: [number, number, number] = [255, 0, 0];
    const white: [number, number, number] = [255, 255, 255];
    [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach((p, k) => this.blend(X.BLEND10RED + k, red, 100 - p, p));
    this.set(X.BLEND100RED, new Uint8Array(256).fill(0x10));
    [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach((p, k) => this.blend(X.BLEND10WHITE + k, white, 100 - p, p));
    this.set(X.BLEND100WHITE, new Uint8Array(256).fill(255));
    this.blend(X.BLEND25YELLOW, [255, 255, 0], 75, 25);
    this.blend(X.BLEND25RED, red, 75, 25);
    this.blend(X.BLEND25GREEN, [0, 255, 0], 75, 25);
    this.blend(X.BLEND25BLUE, [0, 0, 255], 75, 25);
    this.blend(X.BLEND50RED, red, 50, 50);
    this.blend(X.BLEND50GREEN, [0, 255, 0], 50, 50);
    this.blend(X.BLEND50BLUE, [0, 0, 255], 50, 50);
    this.blend(X.BLEND75RED, red, 25, 75);
    this.blend(X.BLEND75GREEN, [0, 255, 0], 25, 75);
    this.blend(X.BLEND75BLUE, [0, 0, 255], 25, 75);
    this.filter(X.FILTERRED, red);
    this.filter(X.FILTERGREEN, [0, 255, 0]);
    this.filter(X.FILTERBLUE, [0, 0, 255]);
    this.filter(X.FILTERWHITE90, [240, 240, 240]);
    this.filter(X.FILTERWHITE80, [220, 220, 220]);
    this.filter(X.FILTERWHITE70, [200, 200, 200]);
    this.filter(X.FILTERBRIGHT1, [253, 253, 253]);
    this.filter(X.FILTERBRIGHT2, [250, 250, 250]);
    this.filter(X.FILTERBRIGHT3, [245, 245, 245]);

    const ramp = (id: number, from: number, to: number, mask = 0xf0) => {
      const t = this.set(id, this.identity());
      this.ramp(t, mask, from, to);
      return t;
    };
    const half = (id: number, from: number, to: number, offset: number) => {
      const t = this.set(id, this.identity());
      this.halfRamp(t, 0xf0, from, to, offset);
      return t;
    };
    ramp(X.GRAYTORED, 0xd0, 0x10);
    ramp(X.GRAYTOORANGE, 0xd0, 0x50);
    ramp(X.GRAYTODGREEN, 0xd0, 0x60);
    ramp(X.GRAYTOBGREEN, 0xd0, 0x70);
    ramp(X.GRAYTOSKY, 0xd0, 0x80);
    ramp(X.GRAYTODBLUE, 0xd0, 0x90);
    ramp(X.GRAYTOPURPLE, 0xd0, 0xa0);
    ramp(X.GRAYTOGOLD, 0xd0, 0xc0);
    ramp(X.GRAYTOBBLUE, 0xd0, 0xe0);
    half(X.GRAYTOLRED, 0xd0, 0x10, 0);
    half(X.GRAYTOLORANGE, 0xd0, 0x50, 0);
    half(X.GRAYTOLGREEN, 0xd0, 0x60, 0);
    half(X.GRAYTOLBGREEN, 0xd0, 0x70, 0);
    half(X.GRAYTOLSKY, 0xd0, 0x80, 0);
    half(X.GRAYTOLBBLUE, 0xd0, 0x90, 0);
    half(X.GRAYTOLPURPLE, 0xd0, 0xa0, 0);
    half(X.GRAYTOLGOLD, 0xd0, 0xc0, 0);
    half(X.GRAYTOLBLUE, 0xd0, 0xe0, 0);
    half(X.GRAYTOKRED, 0xd0, 0x10, 8);
    half(X.GRAYTOKORANGE, 0xd0, 0x50, 8);
    half(X.GRAYTOKGREEN, 0xd0, 0x60, 8);
    half(X.GRAYTOKBGREEN, 0xd0, 0x70, 8);
    half(X.GRAYTOKSKY, 0xd0, 0x80, 8);
    half(X.GRAYTOKBBLUE, 0xd0, 0x90, 8);
    half(X.GRAYTOKPURPLE, 0xd0, 0xa0, 8);
    half(X.GRAYTOKGOLD, 0xd0, 0xc0, 8);
    half(X.GRAYTOKBLUE, 0xd0, 0xe0, 8);
    half(X.GRAYTOKGRAY, 0xd0, 0xd0, 8);

    const lightOnly = (id: number, from: number, level: number) => {
      const t = this.set(id, this.identity());
      this.light(t, 0xf0, from, level);
      return t;
    };
    lightOnly(X.REDTOBLACK, 0x10, 0);
    lightOnly(X.BLUETOBLACK, 0x90, 0);
    lightOnly(X.PURPLETOBLACK, 0xa0, 0);
    lightOnly(X.GRAYTOBLACK, 0xd0, Math.trunc(LIGHT_LEVELS / 6));

    const move = (id: number, from: number, idx: number[]) => {
      const t = this.set(id, this.identity());
      this.rampMove(t, 0xf0, from, idx);
    };
    move(X.GRAYTOOLDHAIR1, 0xd0, OLDHAIR1);
    move(X.GRAYTOOLDHAIR2, 0xd0, OLDHAIR2);
    move(X.GRAYTOOLDHAIR3, 0xd0, OLDHAIR3);
    move(X.GRAYTOPLATBLOND, 0xd0, PLATBLOND);
    ramp(X.GRAYTOSKIN1, 0xd0, 0x20);
    ramp(X.GRAYTOSKIN2, 0xd0, 0x30);
    half(X.GRAYTOSKIN3, 0xd0, 0x30, 5);
    ramp(X.GRAYTOSKIN4, 0xd0, 0x40);
    half(X.GRAYTOSKIN5, 0xd0, 0x40, 8);
    move(X.DBLUETOSKIN1, 0x90, SKIN1);
    move(X.DBLUETOSKIN2, 0x90, SKIN2);
    ramp(X.DBLUETOSKIN3, 0x90, 0x30);
    ramp(X.DBLUETOSKIN4, 0x90, 0x40);
    ramp(X.DBLUETOGRAY, 0x90, 0xd0);
    ramp(X.DBLUETOLBLUE, 0x90, 0x80);
    move(X.DBLUETOSICKGREEN, 0x90, GREEN_SKIN);
    move(X.DBLUETOSICKYELLOW, 0x90, YELLOW_SKIN);
    // Forked colours: two ramps changed at once.
    this.ramp(ramp(X.DBLUETOASHEN, 0x90, 0xd0), 0xf0, 0xd0, 0x10);
    for (const [id, to] of [[X.REDTODGREEN1, 0x20], [X.REDTODGREEN2, 0x30], [X.REDTODGREEN3, 0x40]] as const)
      this.ramp(half(id, 0x10, 0x70, 8), 0xf0, 0x90, to);
    for (const [id, to] of [[X.REDTOBLACK1, 0x20], [X.REDTOBLACK2, 0x30], [X.REDTOBLACK3, 0x40]] as const)
      this.ramp(half(id, 0x10, 0xd0, 8), 0xf0, 0x90, to);
    for (const [id, to] of [[X.REDTODKBLACK1, 0x20], [X.REDTODKBLACK2, 0x30], [X.REDTODKBLACK3, 0x40]] as const)
      this.ramp(lightOnly(id, 0x10, 0), 0xf0, 0x90, to);
    this.ramp(lightOnly(X.REDBLK_BLWHT, 0x10, 0), 0xf0, 0x90, 0xd0);
    this.ramp(lightOnly(X.BLBLK_REDWHT, 0x90, 0), 0xf0, 0x10, 0xd0);
    ramp(X.PURPLETOLBLUE, 0xa0, 0x80);
    ramp(X.PURPLETOBRED, 0xa0, 0x10);
    ramp(X.PURPLETOGREEN, 0xa0, 0x70);
    ramp(X.PURPLETOYELLOW, 0xa0, 0x50);
    this.set(X.RAMPUP1, this.rampOffset(1));
    this.set(X.RAMPUP2, this.rampOffset(2));
    this.set(X.RAMPDOWN2, this.rampOffset(-2));
    this.set(X.RAMPDOWN1, this.rampOffset(-1));
    // Guild shield colours: red -> ramp i, blue -> ramp j.
    const n = RAMPS.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const id = X.GUILDCOLOR_BASE + i * n + j;
        if (id > X.GUILDCOLOR_END) continue;
        const t = this.set(id, this.identity());
        this.ramp(t, 0xf0, 0x10, RAMPS[i]);
        this.ramp(t, 0xf0, 0x90, RAMPS[j]);
      }
  }
}
