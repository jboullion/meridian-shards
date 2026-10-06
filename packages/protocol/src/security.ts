// The two anti-spoof mechanisms of the M59 protocol.
//
// 1. Client -> server: every game-mode message carries a "security" word in the
//    header's CRC slot, derived from 5 LCG streams seeded by AP_GETCHOICE
//    (clientd3d/com.c SendServer + RandomStreamsStep, checked in
//    blakserv/game.c GameProcessSessionBuffer). One mismatch and the server
//    hangs up.
// 2. Server -> client: the first (type) byte of every packet sent to a logged-in
//    session is XORed with a token that slides through the "redbook" string
//    (blakserv/commcli.c SecurePacketBufferList, clientd3d/server.c
//    DesecureByServerToken). BP_ECHO_PING resets the token.

import { crc16 } from "./crc.ts";

export const NUM_STREAMS = 5;

/** The 5 LCG streams. All arithmetic is unsigned 32-bit, like the C code. */
export class RandomStreams {
  private streams = new Uint32Array(NUM_STREAMS);

  init(seeds: ArrayLike<number>): void {
    for (let i = 0; i < NUM_STREAMS; i++) this.streams[i] = seeds[i] >>> 0;
  }

  step(): number {
    const s = this.streams;
    for (let i = 0; i < NUM_STREAMS; i++) {
      // (s * 9301 + 49297) % 233280 in uint32: imul wraps like C unsigned multiply.
      const t = ((Math.imul(s[i], 9301) >>> 0) + 49297) >>> 0;
      s[i] = t % 233280;
    }
    return s[s[NUM_STREAMS - 1] % (NUM_STREAMS - 1)];
  }

  /** The header word for one outgoing game message. */
  securityFor(body: Uint8Array): number {
    let v = this.step() & 0xffff;
    v ^= body.length & 0xffff;
    // The C client does (WORD)msg[0] on a signed char, so type bytes >= 0x80
    // sign-extend before the shift. The server does the same with its char data.
    const type = body[0] >= 0x80 ? body[0] | 0xff00 : body[0];
    v ^= (type << 4) & 0xffff;
    v ^= crc16(body);
    return v & 0xffff;
  }
}

/** Fallback redbook used until the server names one (both sides hard-code it). */
export const DEFAULT_REDBOOK = "BLAKSTON: Greenwich Q Zjiria";

/** Server -> client type-byte unmangling. */
export class ServerToken {
  private token = 0;
  private redbook: string | null = null;
  private pos = 0;
  /** Resolves a redbook resource id to its string (from the .rsb). */
  lookup: (rscId: number) => string | undefined = () => undefined;

  reset(): void {
    this.token = 0;
    this.redbook = null;
    this.pos = 0;
  }

  /** Unmangle a packet's type byte in place (call once per packet, in order). */
  desecure(packet: Uint8Array): void {
    if (packet.length === 0) return;
    packet[0] ^= this.token & 0xff;
    if (this.redbook !== null) {
      this.token = (this.token + (this.redbook.charCodeAt(this.pos) & 0x7f)) >>> 0;
      this.pos++;
      if (this.pos >= this.redbook.length) this.pos = 0;
    }
  }

  /** Handle the body of BP_ECHO_PING (after the type byte): u8 token^0xED, u32 redbook rsc id. */
  onEchoPing(byte: number, redbookId: number): void {
    this.token = (byte ^ 0xed) & 0xff;
    let book: string | undefined;
    if (redbookId !== 0) book = this.lookup(redbookId);
    this.redbook = book && book.length > 0 ? book : DEFAULT_REDBOOK;
    this.pos = 0;
  }
}
