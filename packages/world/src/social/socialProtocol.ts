// Ours (docs/adr/0005-friends.md): what players of this client say to each other through the
// friends relay (tools/gateway/relay.ts), and the keys they're known by. JSON text frames, a few
// hundred bytes each. WebCrypto only, so it runs in Node and the browser alike.

import type { ArenaMessage } from "../arena/arenaWire.ts";

/** What the challenge signature covers, before the nonce, server and name (relay.ts HELLO_PREFIX) */
const HELLO_PREFIX = "meridian-shards-social";

/** A friend request's tell must arrive within this long of its relay message, either way round (ms) */
export const FRIEND_REQUEST_MS = 30_000;

/** The relay says these (relay.ts) */
export type RelayMessage =
  | { t: "challenge"; nonce: string; time: number }
  | { t: "welcome"; time: number; key: string }
  | { t: "msg"; from: string; name: string; body: FriendBody }
  | { t: "undeliverable"; to: string; ref?: unknown }
  | { t: "presence"; key: string; online: boolean; name: string | null }
  | { t: "results"; id: number; players: RelayPlayer[] }
  | { t: "lookup"; id: number; found: RelayPlayer[] }
  | { t: "time"; id: number; time: number }
  /** docs/adr/0006-pets.md 3: pets of names we asked about (a null pet: none, or gone) */
  | { t: "pets"; pets: { name: string; key: string | null; pet: unknown }[] }
  /** docs/adr/0007-arena.md: the arena we watch (everything, then what changed), or that the relay has none */
  | ArenaMessage
  | { t: "arenaOff" };

/** Someone on the relay: a character name (only a claim) and the key that's proven */
export interface RelayPlayer {
  name: string;
  key: string;
}

/** Kod squares (1-based row and column) */
export type KodSquare = [row: number, col: number];

/** What friends (and would-be friends) send each other, inside the relay's `send` */
export type FriendBody =
  /** 2.4: please be my friend (the code comes by tell, never through the relay) */
  | { type: "request" }
  /** 2.4.3: yes, and here's the code from the tell, which proves we saw it */
  | { type: "accept"; code: string }
  | { type: "decline" }
  /** We take our request back */
  | { type: "cancel" }
  /** We're not friends any more */
  | { type: "remove" }
  /** 3: where we are (a room's file and number, our square), or that we've stopped saying */
  | { type: "loc"; room: string; rid: number; at: KodSquare }
  | { type: "loc"; hidden: true }
  /** 5: our health, a whole percentage */
  | { type: "hp"; pct: number }
  /** 4.1: we're following you, or not any more */
  | { type: "follow"; on: boolean }
  /** 4.1: the leader turned the follower away */
  | { type: "follow-refused"; why: "refused" | "stopped" | "chain" }
  /**
   * 4.3: the leader left a room, from where (its last square), and how: a door's square or an edge's
   * side; neither when it wasn't a known exit (a teleport, a portal, death)
   */
  | { type: "exit"; from: string; to: string; at: KodSquare; door?: KodSquare; edge?: "N" | "S" | "E" | "W" }
  /** 6: which crowd are you seeing in this room? */
  | { type: "ambient-ask"; room: string }
  /** 6: this one: its seed, and the relay time its ticks count from */
  | { type: "ambient"; room: string; seed: number; since: number; hour?: number | null };

const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 2.1: a new key pair for a character; the private key can't be read out, only used */
export function generateIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
}

/** A public key as the relay knows it: the raw point, base64url */
export async function publicKeyString(key: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export function helloText(nonce: string, server: string, name: string): string {
  return `${HELLO_PREFIX}\n${nonce}\n${server}\n${name}`;
}

/** 2.2: the challenge answered */
export async function signHello(privateKey: CryptoKey, nonce: string, server: string, name: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(helloText(nonce, server, name)));
  return toBase64Url(new Uint8Array(sig));
}

/** A key's fingerprint, short enough for a tell: SHA-256's first 8 bytes in hex */
export async function fingerprint(key: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64Url(key)));
  return [...hash.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A friend request's code: 8 letters and digits */
export function newCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => chars[b % chars.length]).join("");
}

/** 2.4.1: the one tell this feature sends, readable to someone on an original client */
export function friendRequestTell(code: string, fp: string): string {
  return `[Meridian Shards friend request ${code} ${fp}]`;
}

const TELL = /\[Meridian Shards friend request ([A-Z0-9]{4,16}) ([0-9a-f]{16})\]/;

/** A friend request's tell, wherever it sits in a line (the server may add "X tells you" and quotes) */
export function parseFriendRequestTell(text: string): { code: string; fp: string } | null {
  const m = TELL.exec(text);
  return m ? { code: m[1], fp: m[2] } : null;
}

/** Whether a line is (or echoes) a friend request's tell: never shown */
export function isFriendRequestTell(text: string): boolean {
  return text.includes("[Meridian Shards friend request ");
}

const SIDES = new Set(["N", "S", "E", "W"]);
const isSquare = (v: unknown): v is KodSquare => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < 1000);
const isFile = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** A body from someone else, checked: null when it isn't one we know */
export function readFriendBody(v: unknown): FriendBody | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  switch (b.type) {
    case "request":
    case "decline":
    case "cancel":
    case "remove":
      return { type: b.type };
    case "accept":
      return typeof b.code === "string" && b.code.length <= 16 ? { type: "accept", code: b.code } : null;
    case "loc":
      if (b.hidden === true) return { type: "loc", hidden: true };
      return isFile(b.room) && Number.isInteger(b.rid) && isSquare(b.at) ? { type: "loc", room: b.room, rid: b.rid as number, at: b.at } : null;
    case "hp":
      return typeof b.pct === "number" && b.pct >= 0 && b.pct <= 100 ? { type: "hp", pct: Math.round(b.pct) } : null;
    case "follow":
      return { type: "follow", on: b.on === true };
    case "follow-refused":
      return { type: "follow-refused", why: b.why === "stopped" || b.why === "chain" ? b.why : "refused" };
    case "ambient-ask":
      return isFile(b.room) ? { type: "ambient-ask", room: b.room } : null;
    case "ambient":
      return isFile(b.room) && Number.isInteger(b.seed) && Number.isFinite(b.since)
        ? {
            type: "ambient", room: b.room, seed: (b.seed as number) >>> 0, since: b.since as number,
            hour: Number.isInteger(b.hour) && (b.hour as number) >= 0 && (b.hour as number) < 24 ? (b.hour as number) : null,
          }
        : null;
    case "exit": {
      if (!isFile(b.from) || !isFile(b.to) || !isSquare(b.at)) return null;
      const out: FriendBody = { type: "exit", from: b.from, to: b.to, at: b.at };
      if (isSquare(b.door)) out.door = b.door;
      else if (typeof b.edge === "string" && SIDES.has(b.edge)) out.edge = b.edge as "N" | "S" | "E" | "W";
      return out;
    }
  }
  return null;
}
