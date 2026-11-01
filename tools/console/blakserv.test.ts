import { describe, expect, it } from "vitest";
import { inGame, parseStatus, parseWho } from "./blakserv.ts";

const WHO = `
Name                Act Ver Sess Port                   Where
----------------------------------------------------------------------------
jboullion            12 5055   1 ::ffff:127.0.0.1       Game - First Faction (6075)
shardscout           14 5055   3 ::ffff:10.0.0.4        Game - pick
?                       No    2 ::ffff:127.0.0.1       Maintenance
`;

const STATUS = `System Status -----------------------------
BlakSton Server v2.1 (Oct 31 2026 10:44:26) on unknown
Current time is Oct 31 2026 15:55:38
System started at Oct 31 2026 15:08:53
(up for 46 minutes 45 seconds = 2805 seconds)
----
Active accounts: 12
Next account number is 13
Clients on port 5959, maintenance on port 9998
There are 2 sessions (0 guests) logged on
`;

describe("parseWho", () => {
  it("reads each session and leaves out the maintenance connection", () => {
    const who = parseWho(WHO);
    expect(who).toEqual([
      { account: "jboullion", accountId: 12, session: 1, where: "Game - First Faction (6075)", room: "First Faction", rid: 6075 },
      { account: "shardscout", accountId: 14, session: 3, where: "Game - pick", room: null, rid: null },
    ]);
    expect(inGame(who).map((s) => s.account)).toEqual(["jboullion"]);
  });

  it("is empty for an empty table", () => {
    expect(parseWho(WHO.split("\n").slice(0, 3).join("\n"))).toEqual([]);
  });
});

describe("parseStatus", () => {
  it("reads the version, uptime and session counts", () => {
    expect(parseStatus(STATUS)).toEqual({
      version: "BlakSton Server v2.1 (Oct 31 2026 10:44:26)",
      uptimeSec: 2805,
      activeAccounts: 12,
      sessions: 2,
      guests: 0,
    });
  });

  it("gives nulls for text it doesn't know", () => {
    expect(parseStatus("nothing")).toEqual({ version: null, uptimeSec: null, activeAccounts: null, sessions: null, guests: null });
  });
});
