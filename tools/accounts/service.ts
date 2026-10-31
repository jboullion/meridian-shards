// The account service's routes (docs/adr/0030-account-recovery.md): link an email to a game
// account, then reset a forgotten password or recall forgotten account names through it.
// HTTP is accounts.ts's; this takes parsed JSON bodies and returns a status and a reply.
//
// Passwords arrive as the digest the game client sends at login (packages/protocol md5.ts,
// as hex), never in plain text. Replies to forgot/names/signin never say whether anything matched.
//
// The account page signs in with a session (a signed token in an HttpOnly cookie, which
// accounts.ts reads and writes): an account's, by name and password, or an email's, through an
// emailed sign-in link, which covers every account linked to that email.

import type { Account, Blakserv, Character } from "./blakserv.ts";
import type { Mailer } from "./mail.ts";
import { readToken, signToken } from "./tokens.ts";

export interface Reply {
  status: number;
  body: { ok: boolean; message?: string } & Record<string, unknown>;
  /** A session token to set as the cookie, or null to clear it */
  cookie?: string | null;
}

/** What the account page shows for one account */
export interface AccountView {
  id: number;
  name: string;
  email: string;
  lastLogin: number;
  characters: Character[];
}

/** Who a session is: one account, or every account linked to an email */
interface Session {
  kind: "account" | "email";
  email: string;
  accounts: Account[];
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
const SIGNIN_LIFE = HOUR / 4;
export const SESSION_LIFE = 30 * 24 * HOUR;
/** The most accounts an email's session shows */
const MAX_ACCOUNTS = 10;
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

  /** Who the cookie's token signs in, or null: an account's session ends when its password changes */
  async function resolve(token: string | undefined): Promise<Session | null> {
    const data = token ? readToken(o.secret, token, "session", now()) : null;
    if (!data) return null;
    if (data.id > 0) {
      const acc = await o.blakserv.byId(data.id);
      return acc && acc.stamp === data.s
        ? { kind: "account", email: acc.email, accounts: [acc] }
        : null;
    }
    if (!validEmail(data.e)) return null;
    const accounts = (await o.blakserv.byEmail(data.e)).slice(0, MAX_ACCOUNTS);
    return { kind: "email", email: data.e, accounts };
  }

  const sessionFor = (acc: Account | null, email = "") =>
    signToken(o.secret, {
      p: "session",
      id: acc?.id ?? 0,
      e: email,
      s: acc?.stamp ?? "",
      x: now() + SESSION_LIFE,
    });

  const signedOut = (): Reply => ({
    ...reply(401, false, "You're signed out. Sign in again."),
    cookie: null,
  });

  /** The session's account the body names ({accountId}), or a reply refusing */
  async function sessionAccount(body: Record<string, unknown>, token?: string) {
    const session = await resolve(token);
    if (!session) return signedOut();
    const acc = session.accounts.find((a) => a.id === body.accountId);
    return acc ?? reply(403, false, "That account isn't yours to change.");
  }

  const routes: Record<
    string,
    (
      body: Record<string, unknown>,
      ip: string,
      token?: string,
    ) => Promise<Reply>
  > = {
    async login(body) {
      const acc = await signIn(body);
      if ("status" in acc) return acc;
      return { ...reply(200, true), cookie: sessionFor(acc) };
    },

    async signin(body, ip) {
      if (!(await human(body, ip)))
        return reply(403, false, "Please complete the check and try again.");
      if (!validEmail(body.email))
        return reply(400, false, "That doesn't look like an email address.");
      const email = body.email.toLowerCase();
      const found = await o.blakserv.byEmail(email);
      if (found.length > 0 && perTarget.take(`signin:${email}`, now())) {
        const t = signToken(o.secret, {
          p: "signin",
          id: 0,
          e: email,
          s: "",
          x: now() + SIGNIN_LIFE,
        });
        await o.mail({
          to: email,
          subject: "Sign in to Meridian Shards",
          text:
            `To sign in to your Meridian Shards account page, open this link within 15 minutes:\n` +
            `${o.siteUrl}/account/signin/?t=${t}\n\n` +
            `It shows every account linked to this address.\nIf this wasn't you, ignore this email.`,
        });
      }
      return reply(
        200,
        true,
        "If that email is linked to an account, we've sent a sign-in link to it. It works for 15 minutes.",
      );
    },

    async session(body) {
      const data = readToken(o.secret, String(body.t ?? ""), "signin", now());
      if (!data || !validEmail(data.e))
        return reply(400, false, "This link has expired. Ask for a new one.");
      return { ...reply(200, true), cookie: sessionFor(null, data.e) };
    },

    async me(_body, _ip, token) {
      const session = await resolve(token);
      if (!session) return token ? signedOut() : reply(401, false);
      const accounts: AccountView[] = [];
      for (const a of session.accounts)
        accounts.push({
          id: a.id,
          name: a.name,
          email: a.email,
          lastLogin: a.lastLogin,
          characters: await o.blakserv.characters(a.id),
        });
      return reply(200, true, undefined, {
        kind: session.kind,
        email: session.email,
        accounts,
      });
    },

    async logout() {
      return { ...reply(200, true), cookie: null };
    },

    async link(body, ip, token) {
      if (!(await human(body, ip)))
        return reply(403, false, "Please complete the check and try again.");
      const acc = await sessionAccount(body, token);
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

    async unlink(body, _ip, token) {
      const acc = await sessionAccount(body, token);
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
    /** `token` is the session cookie's value, if the request carried one */
    async handle(
      route: string,
      body: unknown,
      ip: string,
      token?: string,
    ): Promise<Reply> {
      const fn = routes[route];
      if (!fn) return reply(404, false, "No such request.");
      // The account page asks `me` on every visit: only the rest count towards the limit
      if (route !== "me" && route !== "logout" && !perIp.take(ip, now()))
        return reply(
          429,
          false,
          "Too many requests. Try again in a few minutes.",
        );
      if (typeof body !== "object" || body === null || Array.isArray(body))
        return reply(400, false, "Bad request.");
      return fn(body as Record<string, unknown>, ip, token);
    },
  };
}
