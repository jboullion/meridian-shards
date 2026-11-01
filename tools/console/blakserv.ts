// Reads blakserv's `who` and `show status` answers (shards-server blakserv/adminfn.c AdminWho,
// AdminShowStatus) for the Shards Console (ADR 0031). Both are text for people, so the parsers
// take what they recognise and leave the rest.

export interface Session {
  /** "?" before login */
  account: string;
  accountId: number | null;
  session: number;
  /** "Game - <room> (<rid>)", "Game - pick" (choosing a character), "Maintenance", ... */
  where: string;
  /** The room, for a character in the game */
  room: string | null;
  rid: number | null;
}

export interface ServerStatus {
  /** "BlakSton Server v2.1 (Oct 31 2026 10:44:26)" */
  version: string | null;
  uptimeSec: number | null;
  activeAccounts: number | null;
  /** Every session, the maintenance connection asking included */
  sessions: number | null;
  guests: number | null;
}

/** The sessions in a `who` answer, the maintenance connections left out */
export function parseWho(output: string): Session[] {
  const out: Session[] = [];
  for (const line of output.split(/\r?\n/)) {
    // "%-18.18s " name, then the account id (blank before login), the client version ("No" for
    // none), the session, the address and where; the columns shift when there's no account
    if (line.length < 20) continue;
    const m = /^\s*(\d+)?\s+(\d+|No)\s*?(\d+)\s+(\S+)\s+(.+)$/.exec(line.slice(19));
    if (!m) continue;
    const where = m[5]!.trim();
    if (where === "Maintenance") continue;
    const room = /^Game - (.+) \((\d+)\)$/.exec(where);
    out.push({
      account: line.slice(0, 18).trim(),
      accountId: m[1] ? Number(m[1]) : null,
      session: Number(m[3]),
      where,
      room: room ? room[1]! : null,
      rid: room ? Number(room[2]) : null,
    });
  }
  return out;
}

/** Characters in the game: sessions past character choice */
export const inGame = (sessions: Session[]) => sessions.filter((s) => s.rid !== null);

export function parseStatus(output: string): ServerStatus {
  const num = (re: RegExp) => {
    const m = re.exec(output);
    return m ? Number(m[1]) : null;
  };
  return {
    version: /^(BlakSton Server .*?) on .*$/m.exec(output)?.[1] ?? null,
    uptimeSec: num(/= (\d+) seconds\)/),
    activeAccounts: num(/^Active accounts: (\d+)/m),
    sessions: num(/^There are (\d+) sessions/m),
    guests: num(/sessions \((\d+) guests\)/),
  };
}
