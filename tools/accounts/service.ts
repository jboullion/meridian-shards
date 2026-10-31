// The account service's routes (docs/adr/0030-account-recovery.md): link an email to a game
// account, then reset a forgotten password or recall forgotten account names through it.
// HTTP is accounts.ts's; this takes parsed JSON bodies and returns a status and a reply.
//
// Passwords arrive as the digest the game client sends at login (packages/protocol md5.ts,
// as hex), never in plain text. Replies to forgot/names never say whether anything matched.

import type { Blakserv } from "./blakserv.ts";
import type { Mailer } from "./mail.ts";
import { readToken, signToken } from "./tokens.ts";

export interface Reply {
  status: number;
  body: { ok: boolean; message?: string; email?: string; name?: string };
}

export interface ServiceOptions {
  blakserv: Blakserv;
  mail: Mailer;
  /** HMAC key for the links */
  secret: string;
  /** The site's origin, for links in emails (https://m59-shards.com) */
  siteUrl: string;
  /** Checks a Cloudflare Turnstile token; absent = no check */
  turnstile?: (token: string, ip: string) => Promise<boolean>;
  now?: () => number;
}

const HOUR = 60 * 60 * 1000;
const LINK_LIFE = 24 * HOUR;
const RESET_LIFE = HOUR;
/** Requests per address per 10 minutes, and emails per account or address per hour */
const PER_IP = 20;
const MAILS_PER_TARGET = 3;
/** The most accounts one forgot-password request mails links for */
const MAX_RESETS = 10;

const NEUTRAL =
  "If that matches an account with a linked email, we've sent a message to it.";

/** Counts events per key over a sliding window */
export class Limiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Records an event; false when the key is over its limit (the event isn't counted) */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => t > now - this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000)
      for (const [k, v] of this.hits)
        if (!v.some((t) => t > now - this.windowMs)) this.hits.delete(k);
    return true;
  }
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
export const validDigest = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
export const validEmail = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(v);
/** Account names as blakserv takes them: no control characters */
const validName = (v: unknown): v is string =>
  str(v, 64) !== null &&
  ![...(v as string)].some((ch) => ch.charCodeAt(0) < 32);

const reply = (
  status: number,
  ok: boolean,
  message?: string,
  extra: Partial<Reply["body"]> = {},
): Reply => ({
  status,
  body: { ok, ...(message ? { message } : {}), ...extra },
});

export function createService(o: ServiceOptions) {
  const now = o.now ?? Date.now;
  const perIp = new Limiter(PER_IP, 10 * 60 * 1000);
  const perTarget = new Limiter(MAILS_PER_TARGET, HOUR);

  const human = async (body: Record<string, unknown>, ip: string) =>
    !o.turnstile ||
    (typeof body.turnstile === "string" &&
      (await o.turnstile(body.turnstile, ip)));

  /** The account a name and password digest sign in to, or a reply refusing */
  async function signIn(body: Record<string, unknown>) {
    if (!validName(body.name) || !validDigest(body.passwordDigest))
      return reply(400, false, "Enter your account name and password.");
    const id = await o.blakserv.check(body.name, body.passwordDigest);
    const acc = id === null ? null : await o.blakserv.byId(id);
    return acc ?? reply(401, false, "Wrong account name or password.");
  }

  const routes: Record<
    string,
    (body: Record<string, unknown>, ip: string) => Promise<Reply>
  > = {
    async status(body) {
      const acc = await signIn(body);
      if ("status" in acc) return acc;
      return reply(200, true, undefined, { name: acc.name, email: acc.email });
    },

    async link(body, ip) {
      if (!(await human(body, ip)))
        return reply(403, false, "Please complete the check and try again.");
      const acc = await signIn(body);
      if ("status" in acc) return acc;
      if (!validEmail(body.email))
        return reply(400, false, "That doesn't look like an email address.");
      const email = body.email.toLowerCase();
      if (
        !perTarget.take(`mail:${email}`, now()) ||
        !perTarget.take(`acct:${acc.id}`, now())
      )
        return reply(
          429,
          false,
          "Too many emails sent there lately. Try again in an hour.",
        );
      const t = signToken(o.secret, {
        p: "link",
        id: acc.id,
        e: email,
        s: acc.stamp,
        x: now() + LINK_LIFE,
      });
      await o.mail({
        to: email,
        subject: "Confirm your email for Meridian Shards",
        text:
          `Someone (hopefully you) asked to link this email to the Meridian Shards account "${acc.name}".\n\n` +
          `To confirm, open this link within 24 hours:\n${o.siteUrl}/account/verify/?t=${t}\n\n` +
          `Once it's linked, this address can reset the account's password.\nIf this wasn't you, ignore this email.`,
      });
      return reply(
        200,
        true,
        `We've sent a confirmation link to ${email}. It works for 24 hours.`,
      );
    },

    async verify(body) {
      const data = readToken(o.secret, String(body.t ?? ""), "link", now());
      const acc = data && (await o.blakserv.byId(data.id));
      // A changed password means someone else may have asked: the link no longer counts
      if (!data || !acc || acc.stamp !== data.s)
        return reply(400, false, "This link has expired. Ask for a new one.");
      if (!(await o.blakserv.setEmail(acc.id, data.e)))
        return reply(
          500,
          false,
          "The game server didn't take it. Try again later.",
        );
      if (acc.email && acc.email.toLowerCase() !== data.e)
        await o.mail({
          to: acc.email,
          subject: "Your Meridian Shards email was changed",
          text: `The account "${acc.name}" is now linked to ${data.e} instead of this address.\nIf you didn't do this, contact us on Discord.`,
        });
      return reply(200, true, `${data.e} is now linked to "${acc.name}".`, {
        name: acc.name,
        email: data.e,
      });
    },

    async unlink(body) {
      const acc = await signIn(body);
      if ("status" in acc) return acc;
      if (!acc.email) return reply(200, true, "No email is linked.");
      if (!(await o.blakserv.setEmail(acc.id, "")))
        return reply(
          500,
          false,
          "The game server didn't take it. Try again later.",
        );
      await o.mail({
        to: acc.email,
        subject: "Your Meridian Shards email was removed",
        text: `This address is no longer linked to the account "${acc.name}", and can't reset its password.\nIf you didn't do this, contact us on Discord.`,
      });
      return reply(200, true, "The email is no longer linked.", {
        name: acc.name,
        email: "",
      });
    },

    async forgot(body, ip) {
      if (!(await human(body, ip)))
        return reply(403, false, "Please complete the check and try again.");
      const key = str(body.nameOrEmail, 254);
      if (!key) return reply(400, false, "Enter your account name or email.");
      const found = key.includes("@")
        ? validEmail(key)
          ? await o.blakserv.byEmail(key)
          : []
        : validName(key)
          ? [await o.blakserv.byName(key)]
          : [];
      for (const acc of found.slice(0, MAX_RESETS)) {
        if (!acc || !acc.email || !perTarget.take(`acct:${acc.id}`, now()))
          continue;
        const t = signToken(o.secret, {
          p: "reset",
          id: acc.id,
          e: acc.email.toLowerCase(),
          s: acc.stamp,
          x: now() + RESET_LIFE,
        });
        await o.mail({
          to: acc.email,
          subject: `Reset the password for "${acc.name}"`,
          text:
            `Someone (hopefully you) asked to reset the password for the Meridian Shards account "${acc.name}".\n\n` +
            `To choose a new one, open this link within an hour:\n${o.siteUrl}/account/reset/?t=${t}\n\n` +
            `If this wasn't you, ignore this email: your password hasn't changed.`,
        });
      }
      return reply(200, true, NEUTRAL);
    },

    async names(body, ip) {
      if (!(await human(body, ip)))
        return reply(403, false, "Please complete the check and try again.");
      if (!validEmail(body.email))
        return reply(400, false, "That doesn't look like an email address.");
      const found = await o.blakserv.byEmail(body.email);
      if (
        found.length > 0 &&
        perTarget.take(`names:${body.email.toLowerCase()}`, now())
      )
        await o.mail({
          to: body.email,
          subject: "Your Meridian Shards account names",
          text:
            `These Meridian Shards accounts are linked to this address:\n\n${found.map((a) => `  ${a.name}`).join("\n")}\n\n` +
            `Forgot a password too? Reset it at ${o.siteUrl}/account/forgot/`,
        });
      return reply(200, true, NEUTRAL);
    },

    async reset(body) {
      if (!validDigest(body.passwordDigest))
        return reply(400, false, "Choose a new password.");
      const data = readToken(o.secret, String(body.t ?? ""), "reset", now());
      const acc = data && (await o.blakserv.byId(data.id));
      if (
        !data ||
        !acc ||
        acc.stamp !== data.s ||
        acc.email.toLowerCase() !== data.e
      )
        return reply(
          400,
          false,
          "This link has expired or was already used. Ask for a new one.",
        );
      if (!(await o.blakserv.setDigest(acc.id, body.passwordDigest)))
        return reply(
          500,
          false,
          "The game server didn't take it. Try again later.",
        );
      await o.mail({
        to: acc.email,
        subject: "Your Meridian Shards password was changed",
        text: `The password for "${acc.name}" was just changed through a reset link.\nIf you didn't do this, reset it again and contact us on Discord.`,
      });
      return reply(
        200,
        true,
        `The password for "${acc.name}" is changed. Log in with it in the game.`,
        { name: acc.name },
      );
    },
  };

  return {
    routes: Object.keys(routes),
    async handle(route: string, body: unknown, ip: string): Promise<Reply> {
      const fn = routes[route];
      if (!fn) return reply(404, false, "No such request.");
      if (!perIp.take(ip, now()))
        return reply(
          429,
          false,
          "Too many requests. Try again in a few minutes.",
        );
      if (typeof body !== "object" || body === null || Array.isArray(body))
        return reply(400, false, "Bad request.");
      return fn(body as Record<string, unknown>, ip);
    },
  };
}
