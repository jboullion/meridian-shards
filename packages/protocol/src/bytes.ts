// Little-endian byte reader/writer for the M59 wire format.
// Strings on the wire are u16 length + raw bytes (no terminator). We decode them
// as Latin-1 one byte per char (never TextDecoder("latin1"), which is
// windows-1252 in browsers) so every byte round-trips exactly.

export function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

export function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// Ours (ADR 0024): what players type goes out as UTF-8, so emoji survive. The server passes
// those bytes through untouched; everything else on the wire stays Latin-1.
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8ToBytes(s: string): Uint8Array {
  return utf8Encoder.encode(s);
}

/**
 * Player text read off the wire as Latin-1 (one char per byte), decoded as UTF-8 when the
 * bytes are valid UTF-8. Text from the original client (Windows-1252, rarely valid UTF-8) and
 * plain ASCII come back unchanged.
 */
export function decodePlayerText(latin1: string): string {
  let ascii = true;
  for (let i = 0; i < latin1.length; i++) {
    if (latin1.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) return latin1;
  try {
    return utf8Decoder.decode(latin1ToBytes(latin1));
  } catch {
    return latin1;
  }
}

export class ByteWriter {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.length, v & 0xff);
    this.length += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.length, v & 0xffff, true);
    this.length += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, true);
    this.length += 4;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  /** u16 length + bytes. `s` is a Latin-1 string or raw bytes. */
  string(s: string | Uint8Array): this {
    const b = typeof s === "string" ? latin1ToBytes(s) : s;
    this.u16(b.length);
    return this.bytes(b);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  readonly buf: Uint8Array;
  private readonly view: DataView;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(`read past end: need ${n} at ${this.pos} of ${this.buf.length}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  string(): string {
    return bytesToLatin1(this.bytes(this.u16()));
  }
}
