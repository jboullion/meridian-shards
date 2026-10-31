// The account service (docs/adr/0030-account-recovery.md) against a fake blakserv that answers
// the `account` maintenance commands as shards-server's adminfn.c does.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Blakserv,
  parseAccounts,
  parseCharacters,
  parseOk,
} from "./blakserv.ts";
import type { Mail } from "./mail.ts";
import { createService, Limiter } from "./service.ts";
import { readToken, signToken } from "./tokens.ts";

/** The client's login digest (packages/protocol md5.ts) as hex */
const digest = (pw: string) =>
  Buffer.from(
    [...createHash("md5").update(pw).digest()].map((b) => b || 1),
  ).toString("hex");
const stampOf = (d: string) => createHash("md5").update(d).digest("hex");

function fakeServer() {
  const accounts = [
    { id: 1, name: "Alice", digest: digest("pw-alice"), email: "" },
    {
      id: 2,
      name: "Bob Two",
      digest: digest("pw-bob"),
      email: "bob@example.com",
    },
    {
      id: 3,
      name: "Bob Alt",
      digest: digest("pw-alt"),
      email: "Bob@Example.com",
    },
  ];
  const rec = (a: (typeof accounts)[0]) =>
    `ACCOUNT id=${a.id} stamp=${stampOf(a.digest)} email=${a.email || "-"} login=${a.id * 1000} name=${a.name}\n`;
  const run = async (c: string): Promise<string> => {
    const [, verb, rest = ""] = /^account (\w+) ?(.*)$/.exec(c) ?? [];
    const sp = rest.indexOf(" ");
    const [first, second] =
      sp < 0 ? [rest, ""] : [rest.slice(0, sp), rest.slice(sp + 1)];
    const byId = accounts.find((a) => a.id === Number(first));
    switch (verb) {
      case "byname": {
        const a = accounts.find(
          (x) => x.name.toLowerCase() === rest.toLowerCase(),
        );
        return a ? rec(a) : "ACCOUNT NONE\n";
      }
      case "byid":
        return byId ? rec(byId) : "ACCOUNT NONE\n";
      case "characters":
        return (
          (byId?.id === 2
            ? "CHAR id=900 online=1 hp=87 faction=2 renown=50 | Bobbin | The Wardens | Lieutenant\n" +
              "CHAR id=901 online=0 hp=20 faction=0 renown=0 | Bob's Alt | - | Recruit\n"
            : "") + "ACCOUNT END\n"
        );
      case "byemail":
        return (
          accounts
            .filter(
              (a) => a.email && a.email.toLowerCase() === rest.toLowerCase(),
            )
            .map(rec)
            .join("") + "ACCOUNT END\n"
        );
      case "check": {
        const a = accounts.find(
          (x) => x.name.toLowerCase() === second.toLowerCase(),
        );
        return a && a.digest === first
          ? `ACCOUNT OK id=${a.id}\n`
          : "ACCOUNT FAIL\n";
      }
      case "digest":
        if (!byId) return "ACCOUNT FAIL\n";
        byId.digest = second;
        return `ACCOUNT OK id=${byId.id}\n`;
      case "email":
        if (!byId) return "ACCOUNT FAIL\n";
        byId.email = second === "-" ? "" : second;
        return `ACCOUNT OK id=${byId.id}\n`;
    }
    return "Unknown command\n";
  };
  return { accounts, run };
}

function setup() {
  const server = fakeServer();
  const mails: Mail[] = [];
  let t = 1_000_000;
  const svc = createService({
    blakserv: new Blakserv(server.run),
    mail: async (m) => void mails.push(m),
    secret: "test-secret",
    siteUrl: "https://example.test",
    now: () => t,
  });
  const linkIn = (m: Mail) =>
    new URL(/https:\S+/.exec(m.text)![0]).searchParams.get("t")!;
  /** Signs in by password; the session cookie's value */
  const login = async (name: string, pw: string) => {
    const r = await svc.handle(
      "login",
      { name, passwordDigest: digest(pw) },
      "ip",
    );
    expect(r.status).toBe(200);
    return r.cookie!;
  };
  return {
    ...server,
    mails,
    svc,
    linkIn,
    login,
    advance: (ms: number) => (t += ms),
  };
}

describe("blakserv replies", () => {
  it("parses account records and OK", () => {
    const out =
      "> account byemail x\nACCOUNT id=7 stamp=" +
      "a".repeat(32) +
      " email=- login=1793399467 name=Some One\nACCOUNT END\n";
    expect(parseAccounts(out)).toEqual([
      {
        id: 7,
        stamp: "a".repeat(32),
        email: "",
        lastLogin: 1793399467,
        name: "Some One",
      },
    ]);
    expect(parseOk("ACCOUNT OK id=12\n")).toBe(12);
    expect(parseOk("ACCOUNT FAIL\n")).toBeNull();
  });

  it("parses characters, with spaces in a field and no guild", () => {
    const out =
      "> account characters 5\n" +
      "CHAR id=6405 online=0 hp=87 faction=2 renown=50 | Shard Scout | - | Lieutenant\n" +
      "ACCOUNT END\n";
    expect(parseCharacters(out)).toEqual([
      {
        id: 6405,
        online: false,
        hp: 87,
        faction: 2,
        renown: 50,
        name: "Shard Scout",
        guild: "",
        rank: "Lieutenant",
      },
    ]);
  });

  it("never lets a name break the command line", async () => {
    const sent: string[] = [];
    await new Blakserv(async (c) => (sent.push(c), "ACCOUNT NONE")).byName(
      "x\r\nsave game",
    );
    expect(sent).toEqual(["account byname xsave game"]);
  });
});

describe("tokens", () => {
  const data = { p: "reset" as const, id: 4, e: "a@b.c", s: "s", x: 2000 };
  it("round-trip, and refuse tampering, expiry and the wrong purpose", () => {
    const tok = signToken("k", data);
    expect(readToken("k", tok, "reset", 1000)).toEqual(data);
    expect(readToken("k", tok, "reset", 3000)).toBeNull();
    expect(readToken("k", tok, "link", 1000)).toBeNull();
    expect(readToken("other", tok, "reset", 1000)).toBeNull();
    const forged =
      signToken("k", { ...data, id: 5 }).split(".")[0] +
      "." +
      tok.split(".")[1];
    expect(readToken("k", forged, "reset", 1000)).toBeNull();
  });
});

describe("sessions", () => {
  it("signs in by password, shows the account and its characters, and logs out", async () => {
    const s = setup();
    const session = await s.login("Bob Two", "pw-bob");
    const me = await s.svc.handle("me", {}, "ip", session);
    expect(me.body).toMatchObject({
      ok: true,
      kind: "account",
      accounts: [
        {
          id: 2,
          name: "Bob Two",
          email: "bob@example.com",
          lastLogin: 2000,
          characters: [
            {
              name: "Bobbin",
              online: true,
              guild: "The Wardens",
              rank: "Lieutenant",
            },
            { name: "Bob's Alt", online: false, guild: "" },
          ],
        },
      ],
    });
    const out = await s.svc.handle("logout", {}, "ip", session);
    expect(out.cookie).toBeNull();
    expect((await s.svc.handle("me", {}, "ip")).status).toBe(401);
  });

  it("refuses a wrong password, and changes without a session", async () => {
    const s = setup();
    const r = await s.svc.handle(
      "login",
      { name: "Alice", passwordDigest: digest("nope") },
      "ip",
    );
    expect(r.status).toBe(401);
    expect(r.cookie).toBeUndefined();
    const link = await s.svc.handle(
      "link",
      { accountId: 1, email: "a@b.cd" },
      "ip",
    );
    expect(link.status).toBe(401);
    expect(s.mails).toHaveLength(0);
  });

  it("signs in by email link to every account on that email", async () => {
    const s = setup();
    await s.svc.handle("signin", { email: "BOB@example.com" }, "ip");
    expect(s.mails[0]!.subject).toBe("Sign in to Meridian Shards");
    const t = s.linkIn(s.mails[0]!);
    const r = await s.svc.handle("session", { t }, "ip");
    expect(typeof r.cookie).toBe("string");
    const me = await s.svc.handle("me", {}, "ip", r.cookie!);
    expect(me.body.kind).toBe("email");
    expect((me.body.accounts as { name: string }[]).map((a) => a.name)).toEqual(
      ["Bob Two", "Bob Alt"],
    );
    // The emailed link itself isn't a session
    expect((await s.svc.handle("me", {}, "ip", t)).status).toBe(401);
  });

  it("expires sign-in links after 15 minutes", async () => {
    const s = setup();
    await s.svc.handle("signin", { email: "bob@example.com" }, "ip");
    s.advance(16 * 60 * 1000);
    const r = await s.svc.handle("session", { t: s.linkIn(s.mails[0]!) }, "ip");
    expect(r.status).toBe(400);
    expect(r.cookie).toBeUndefined();
  });

  it("sends no sign-in link to an email no account has, but answers the same", async () => {
    const s = setup();
    const none = await s.svc.handle(
      "signin",
      { email: "nobody@example.com" },
      "ip",
    );
    const some = await s.svc.handle(
      "signin",
      { email: "bob@example.com" },
      "ip",
    );
    expect(none).toEqual(some);
    expect(s.mails).toHaveLength(1);
  });

  it("ends an account's session when its password changes", async () => {
    const s = setup();
    const session = await s.login("Bob Two", "pw-bob");
    s.accounts[1]!.digest = digest("changed");
    const me = await s.svc.handle("me", {}, "ip", session);
    expect(me.status).toBe(401);
    expect(me.cookie).toBeNull();
  });

  it("won't change an account outside the session", async () => {
    const s = setup();
    const session = await s.login("Alice", "pw-alice");
    const r = await s.svc.handle("unlink", { accountId: 2 }, "ip", session);
    expect(r.status).toBe(403);
    expect(s.accounts[1]!.email).toBe("bob@example.com");
  });

  it("doesn't count `me` towards the per-address limit", async () => {
    const s = setup();
    const session = await s.login("Alice", "pw-alice");
    for (let i = 0; i < 30; i++) await s.svc.handle("me", {}, "ip", session);
    expect((await s.svc.handle("me", {}, "ip", session)).status).toBe(200);
  });
});

describe("account service", () => {
  it("links an email only after the link is opened", async () => {
    const s = setup();
    const session = await s.login("alice", "pw-alice");
    const r = await s.svc.handle(
      "link",
      { accountId: 1, email: "Alice@Mail.com" },
      "ip",
      session,
    );
    expect(r.status).toBe(200);
    expect(s.accounts[0]!.email).toBe("");
    expect(s.mails[0]!.to).toBe("alice@mail.com");
    const v = await s.svc.handle("verify", { t: s.linkIn(s.mails[0]!) }, "ip");
    expect(v.body).toMatchObject({ ok: true, email: "alice@mail.com" });
    expect(s.accounts[0]!.email).toBe("alice@mail.com");
  });

  it("resets a password once, through a linked email", async () => {
    const s = setup();
    const f = await s.svc.handle("forgot", { nameOrEmail: "Bob Two" }, "ip");
    expect(f.body.ok).toBe(true);
    expect(s.mails).toHaveLength(1);
    const t = s.linkIn(s.mails[0]!);
    const r = await s.svc.handle(
      "reset",
      { t, passwordDigest: digest("new-pw") },
      "ip",
    );
    expect(r.status).toBe(200);
    expect(s.accounts[1]!.digest).toBe(digest("new-pw"));
    expect(s.mails.at(-1)!.subject).toMatch(/was changed/);
    // The password changed, so the same link is dead
    const again = await s.svc.handle(
      "reset",
      { t, passwordDigest: digest("other") },
      "ip",
    );
    expect(again.status).toBe(400);
    expect(s.accounts[1]!.digest).toBe(digest("new-pw"));
  });

  it("mails a reset for every account on an email, and lists their names", async () => {
    const s = setup();
    await s.svc.handle("forgot", { nameOrEmail: "BOB@example.com" }, "ip");
    expect(s.mails.map((m) => m.subject)).toEqual([
      'Reset the password for "Bob Two"',
      'Reset the password for "Bob Alt"',
    ]);
    await s.svc.handle("names", { email: "bob@example.com" }, "ip");
    expect(s.mails.at(-1)!.text).toMatch(/Bob Two\n {2}Bob Alt/);
  });

  it("answers the same whether or not anything matched", async () => {
    const s = setup();
    const none = await s.svc.handle("forgot", { nameOrEmail: "Nobody" }, "ip");
    const unlinked = await s.svc.handle(
      "forgot",
      { nameOrEmail: "Alice" },
      "ip",
    );
    const linked = await s.svc.handle(
      "forgot",
      { nameOrEmail: "Bob Two" },
      "ip",
    );
    expect(none).toEqual(linked);
    expect(unlinked).toEqual(linked);
    expect(s.mails).toHaveLength(1);
  });

  it("expires reset links after an hour", async () => {
    const s = setup();
    await s.svc.handle("forgot", { nameOrEmail: "Bob Two" }, "ip");
    s.advance(61 * 60 * 1000);
    const r = await s.svc.handle(
      "reset",
      { t: s.linkIn(s.mails[0]!), passwordDigest: digest("x") },
      "ip",
    );
    expect(r.status).toBe(400);
  });

  it("won't take a link token as a reset token", async () => {
    const s = setup();
    const session = await s.login("Alice", "pw-alice");
    await s.svc.handle(
      "link",
      { accountId: 1, email: "a@b.cd" },
      "ip",
      session,
    );
    const r = await s.svc.handle(
      "reset",
      { t: s.linkIn(s.mails[0]!), passwordDigest: digest("x") },
      "ip",
    );
    expect(r.status).toBe(400);
  });

  it("unlinks and tells the old address", async () => {
    const s = setup();
    const session = await s.login("Bob Two", "pw-bob");
    const r = await s.svc.handle("unlink", { accountId: 2 }, "ip", session);
    expect(r.body.ok).toBe(true);
    expect(s.accounts[1]!.email).toBe("");
    expect(s.mails[0]!.to).toBe("bob@example.com");
  });

  it("limits emails per account", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++)
      await s.svc.handle("forgot", { nameOrEmail: "Bob Two" }, "ip");
    expect(s.mails).toHaveLength(3);
  });

  it("limits requests per address", async () => {
    const l = new Limiter(2, 1000);
    expect([
      l.take("a", 0),
      l.take("a", 1),
      l.take("a", 2),
      l.take("b", 2),
      l.take("a", 1001),
    ]).toEqual([true, true, false, true, true]);
  });
});
