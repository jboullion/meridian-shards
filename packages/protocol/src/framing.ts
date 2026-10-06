// Message framing: a 7-byte header, then the body.
//   u16 length | u16 crc-or-security | u16 length again | u8 epoch
// (clientd3d/com.c SendServer / ProcessMsgHeader, blakserv/session.c)

export const HEADER_SIZE = 7;
/** Client read buffer size in the original (com.h COMBUFSIZE); bigger frames are a protocol error. */
export const MAX_FRAME = 65535;

export function encodeFrame(body: Uint8Array, word: number, epoch: number): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, body.length, true);
  dv.setUint16(2, word & 0xffff, true);
  dv.setUint16(4, body.length, true);
  dv.setUint8(6, epoch & 0xff);
  out.set(body, HEADER_SIZE);
  return out;
}

export interface Frame {
  body: Uint8Array;
  crc: number;
  epoch: number;
}

/** Accumulates stream bytes and yields whole frames. */
export class FrameDecoder {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
  }

  /** Take raw bytes (used during the startup handshake, before framing starts). */
  takeRaw(): Uint8Array {
    const b = this.buf;
    this.buf = new Uint8Array(0);
    return b;
  }

  /** Next whole frame, or null if more bytes are needed. Throws on a corrupt header. */
  next(): Frame | null {
    if (this.buf.length < HEADER_SIZE) return null;
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const len = dv.getUint16(0, true);
    const crc = dv.getUint16(2, true);
    const len2 = dv.getUint16(4, true);
    const epoch = dv.getUint8(6);
    if (len !== len2) throw new Error(`frame length mismatch ${len} != ${len2}`);
    if (this.buf.length < HEADER_SIZE + len) return null;
    const body = this.buf.slice(HEADER_SIZE, HEADER_SIZE + len);
    this.buf = this.buf.slice(HEADER_SIZE + len);
    return { body, crc, epoch };
  }
}
