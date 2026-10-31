// The account service's view of blakserv: its `account` maintenance commands
// (shards-server blakserv/adminfn.c, admin_account_table), which answer in one-line
// "ACCOUNT ..." records. Commands run one at a time.

import { maint } from "../maint/maintClient.ts";

export interface Account {
  id: number;
  /** MD5 of the stored password digest: changes whenever the password does */
  stamp: string;
  /** "" when none is linked */
  email: string;
  /** Unix seconds; 0 if never */
  lastLogin: number;
  name: string;
}

export interface Character {
  id: number;
  name: string;
  online: boolean;
  /** Maximum hit points */
  hp: number;
  /** FACTION_*: 0 none, 1 the Duke, 2 the Princess, 3 the rebels */
  faction: number;
  renown: number;
  /** "" when none */
  guild: string;
  /** The renown rank's name */
  rank: string;
}

/** Runs one maintenance command and returns its output */
export type Runner = (command: string) => Promise<string>;

/** Every account record in a reply */
export function parseAccounts(output: string): Account[] {
  const out: Account[] = [];
  for (const line of output.split("\n")) {
    const m =
      /^ACCOUNT id=(\d+) stamp=([0-9a-f]{32}) email=(\S+)(?: login=(-?\d+))? name=(.+)$/.exec(
        line.trim(),
      );
    if (m)
      out.push({
        id: Number(m[1]),
        stamp: m[2]!,
        email: m[3] === "-" ? "" : m[3]!,
        lastLogin: Number(m[4] ?? 0),
        name: m[5]!,
      });
  }
  return out;
}

/** Every character in an `account characters` reply */
export function parseCharacters(output: string): Character[] {
  const out: Character[] = [];
  const text = (s: string) => (s === "-" ? "" : s);
  for (const line of output.split("\n")) {
    const m =
      /^CHAR id=(\d+) online=([01]) hp=(-?\d+) faction=(-?\d+) renown=(-?\d+) \| (.*?) \| (.*?) \| (.*)$/.exec(
        line.trim(),
      );
    if (m)
      out.push({
        id: Number(m[1]),
        online: m[2] === "1",
        hp: Number(m[3]),
        faction: Math.max(0, Number(m[4])),
        renown: Math.max(0, Number(m[5])),
        name: text(m[6]!),
        guild: text(m[7]!),
        rank: text(m[8]!),
      });
  }
  return out;
}

/** The id an "ACCOUNT OK id=N" reply carries, or null */
export function parseOk(output: string): number | null {
  const m = /^ACCOUNT OK id=(\d+)/m.exec(output);
  return m ? Number(m[1]) : null;
}

/** A name or email can't carry a line break into the maintenance port */
const clean = (s: string) => s.replace(/[\r\n]/g, "");

export class Blakserv {
  private queue: Promise<unknown> = Promise.resolve();
  private run: Runner;

  constructor(run: Runner) {
    this.run = run;
  }

  /** Runs commands one at a time, in order */
  private cmd(command: string): Promise<string> {
    const next = this.queue.then(() => this.run(command));
    this.queue = next.catch(() => undefined);
    return next;
  }

  async byName(name: string): Promise<Account | null> {
    return (
      parseAccounts(await this.cmd(`account byname ${clean(name)}`))[0] ?? null
    );
  }

  async byId(id: number): Promise<Account | null> {
    return parseAccounts(await this.cmd(`account byid ${id | 0}`))[0] ?? null;
  }

  async characters(id: number): Promise<Character[]> {
    return parseCharacters(await this.cmd(`account characters ${id | 0}`));
  }

  async byEmail(email: string): Promise<Account[]> {
    return parseAccounts(await this.cmd(`account byemail ${clean(email)}`));
  }

  /** The account's id if the digest (32 hex) is its password, else null */
  async check(name: string, digest: string): Promise<number | null> {
    return parseOk(await this.cmd(`account check ${digest} ${clean(name)}`));
  }

  async setDigest(id: number, digest: string): Promise<boolean> {
    return (
      parseOk(await this.cmd(`account digest ${id | 0} ${digest}`)) !== null
    );
  }

  /** Links an email, or clears it with "" */
  async setEmail(id: number, email: string): Promise<boolean> {
    return (
      parseOk(
        await this.cmd(`account email ${id | 0} ${clean(email) || "-"}`),
      ) !== null
    );
  }
}

/** The real maintenance port, one connection per command */
export const maintRunner: Runner = async (command) =>
  (await maint(command))[0] ?? "";
