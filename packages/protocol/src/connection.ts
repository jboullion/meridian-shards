// Transport-agnostic client session: the startup handshake, framing, epoch
// echo, the LCG security word and the redbook type-byte unmangling. It knows
// nothing about sockets; feed it bytes with receive() and give it a send().
//
// Flow (blakserv/async_windows.c + synched.c, clientd3d/statconn.c):
//   login:   a new TCP connection starts in the server's STATE_SYNCHED, which sends
//            AP_GETLOGIN at once. Framed AP_* messages, epoch byte 0, CRC slot unchecked.
//   startup: only used to recover from a framing error (clientd3d/statstrt.c,
//            blakserv/resync.c + trysync.c): the client sends BEACON every 2 s until
//            the server answers SERVER_HELLO, then sends CLIENT_ACK and is back in login.
//   game:    after AP_GAME. Outgoing frames carry the LCG security word and echo
//            the latest epoch seen; incoming type bytes are XORed by the redbook token.

import { ByteReader } from "./bytes.ts";
import { AP, BP } from "./constants.ts";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import { RandomStreams, ServerToken } from "./security.ts";

export const BEACON = Uint8Array.of(1, 255, 66, 76, 65, 75, 10, 13, 2);
export const SERVER_HELLO = Uint8Array.of(3, 251, 98, 108, 97, 107, 10, 13, 1);
export const CLIENT_ACK = Uint8Array.of(7, 230, 98, 108, 97, 107, 10, 13, 8);

const BEACON_INTERVAL_MS = 2000;
const PING_INTERVAL_MS = 5000;

export type ConnState = "startup" | "login" | "game" | "closed";

export interface ConnectionEvents {
  /** A whole, unmangled message. `r` is positioned after the type byte. */
  message?: (type: number, r: ByteReader, state: ConnState) => void;
  state?: (state: ConnState) => void;
  error?: (err: Error) => void;
  /** The round trip of a BP_PING to its BP_ECHO_PING, in milliseconds (lagbox.c's latency) */
  latency?: (ms: number) => void;
}

export class Connection {
  state: ConnState = "login";
  epoch = 0;
  readonly streams = new RandomStreams();
  readonly token = new ServerToken();
  /** Messages received/sent since connect, for diagnostics. */
  stats = { received: 0, sent: 0, pings: 0, echoes: 0 };
  /** The last ping's round trip in ms, null before the first echo */
  latencyMs: number | null = null;
  /** When the unanswered ping went out (performance.now()), 0 when none is out */
  private pingSentAt = 0;

  private readonly decoder = new FrameDecoder();
  private helloPos = 0;
  private beaconTimer: ReturnType<typeof setInterval> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private readonly sendRaw: (bytes: Uint8Array) => void;
  private readonly events: ConnectionEvents;

  /**
   * Built-in ping timer interval in game mode (the original client pings every 5 s,
   * clientd3d/ping.c). Set 0 to drive ping() yourself, e.g. from a Web Worker so a
   * background tab's throttled timers don't let the server's 30 s timeout hit.
   */
  readonly pingIntervalMs: number;

  constructor(
    sendRaw: (bytes: Uint8Array) => void,
    events: ConnectionEvents = {},
    options: { pingIntervalMs?: number } = {},
  ) {
    this.sendRaw = sendRaw;
    this.events = events;
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
  }

  /** Call once the transport is open. The server speaks first (AP_GETLOGIN). */
  start(): void {
    this.events.state?.(this.state);
  }

  /** Recover from a login-mode framing error with the beacon handshake. */
  resyncLogin(): void {
    this.setState("startup");
    this.helloPos = 0;
    this.sendRaw(BEACON);
    clearInterval(this.beaconTimer);
    this.beaconTimer = setInterval(() => this.sendRaw(BEACON), BEACON_INTERVAL_MS);
  }

  close(): void {
    clearInterval(this.beaconTimer);
    clearInterval(this.pingTimer);
    this.setState("closed");
  }

  receive(chunk: Uint8Array): void {
    if (this.state === "closed") return;
    this.decoder.push(chunk);
    if (this.state === "startup") {
      const raw = this.decoder.takeRaw();
      let i = 0;
      for (; i < raw.length && this.state === "startup"; i++) {
        if (raw[i] === SERVER_HELLO[this.helloPos]) {
          if (++this.helloPos === SERVER_HELLO.length) {
            clearInterval(this.beaconTimer);
            this.sendRaw(CLIENT_ACK);
            this.setState("login");
          }
        } else {
          this.helloPos = raw[i] === SERVER_HELLO[0] ? 1 : 0;
        }
      }
      if (this.state === "startup") return;
      this.decoder.push(raw.subarray(i));
    }
    try {
      for (let f = this.decoder.next(); f; f = this.decoder.next()) {
        this.epoch = f.epoch;
        this.token.desecure(f.body);
        this.stats.received++;
        this.dispatch(f.body);
        if ((this.state as ConnState) === "closed") return;
      }
    } catch (err) {
      this.events.error?.(err as Error);
    }
  }

  /** Send a login-mode (AP_*) message. */
  sendLogin(body: Uint8Array): void {
    this.sendRaw(encodeFrame(body, 0, 0));
    this.stats.sent++;
  }

  /** Send a game-mode (BP_*) message with the security word and current epoch. */
  sendGame(body: Uint8Array): void {
    if (this.state !== "game") throw new Error(`sendGame in state ${this.state}`);
    this.sendRaw(encodeFrame(body, this.streams.securityFor(body), this.epoch));
    this.stats.sent++;
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    if (s === "game") {
      if (this.pingIntervalMs > 0) this.pingTimer = setInterval(() => this.ping(), this.pingIntervalMs);
    }
    this.events.state?.(s);
  }

  /** BP_PING; the server answers with BP_ECHO_PING (and resets the redbook token). */
  ping(): void {
    if (this.state !== "game") return;
    this.sendGame(Uint8Array.of(BP.PING));
    this.stats.pings++;
    // Time the first unanswered ping only, so a slow echo isn't timed from a later ping
    if (!this.pingSentAt) this.pingSentAt = performance.now();
  }

  private dispatch(body: Uint8Array): void {
    if (body.length === 0) return;
    const type = body[0];
    const r = new ByteReader(body);
    r.pos = 1;
    const stateAtReceive = this.state;

    if (this.state === "login") {
      if (type === AP.GETCHOICE) {
        const seeds = [r.u32(), r.u32(), r.u32(), r.u32(), r.u32()];
        this.streams.init(seeds);
        r.pos = 1;
      } else if (type === AP.GAME) {
        this.setState("game");
      }
    } else if (this.state === "game") {
      if (type === BP.ECHO_PING && body.length >= 6) {
        this.token.onEchoPing(r.u8(), r.u32());
        this.stats.echoes++;
        if (this.pingSentAt) {
          this.latencyMs = Math.round(performance.now() - this.pingSentAt);
          this.pingSentAt = 0;
          this.events.latency?.(this.latencyMs);
        }
        r.pos = 1;
      } else if (type === BP.QUIT) {
        // Back to the menu (clientd3d GameQuit); the server is in STATE_SYNCHED again.
        clearInterval(this.pingTimer);
        this.setState("login");
      }
    }
    this.events.message?.(type, r, stateAtReceive);
  }
}
