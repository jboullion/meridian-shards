// Signed links for the account service (docs/adr/0030-account-recovery.md): nothing is stored.
// A token is base64url(JSON).base64url(HMAC-SHA256) and carries the account's password stamp
// (an MD5 of its digest, from blakserv's `account byid`), so a reset link stops working once the
// password changes, including by its own use.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Purpose = "link" | "reset";

export interface TokenData {
  /** What the link does */
  p: Purpose;
  /** Account id */
  id: number;
  /** The email it was sent to */
  e: string;
  /** The account's password stamp when it was sent */
  s: string;
  /** Expiry, ms since the epoch */
  x: number;
}

const b64 = (b: Buffer) => b.toString("base64url");

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signToken(secret: string, data: TokenData): string {
  const body = b64(Buffer.from(JSON.stringify(data)));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The token's data if it is genuine, for this purpose and not expired; otherwise null */
export function readToken(
  secret: string,
  token: string,
  purpose: Purpose,
  now = Date.now(),
): TokenData | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let data: TokenData;
  try {
    data = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenData;
  } catch {
    return null;
  }
  if (
    data.p !== purpose ||
    typeof data.id !== "number" ||
    typeof data.x !== "number" ||
    data.x < now
  )
    return null;
  return data;
}
