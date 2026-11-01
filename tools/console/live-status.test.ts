import { describe, expect, it } from "vitest";
import { readLive } from "./live-status.ts";

const MAINT = `> show status
System Status -----------------------------
BlakSton Server v2.1 (Oct 31 2026 10:44:26) on vm
(up for 3 days = 260000 seconds)
There are 3 sessions (0 guests) logged on
> who

Name                Act Ver Sess Port                   Where
----------------------------------------------------------------------------
alia                  3 5055   4 1.2.3.4                Game - Tos (301)
?                       No    9 ::ffff:127.0.0.1       Maintenance`;

describe("readLive", () => {
  it("reads a running server", () => {
    const live = readLive(`@@container\nrunning|2026-10-28T10:00:00.1Z|2\n@@age\n260000\n@@errors\n7\nline a\nline b\n@@maint\n${MAINT}\n`);
    expect(live.container).toEqual({ state: "running", startedAt: "2026-10-28T10:00:00.1Z", restarts: 2, ageSec: 260000 });
    expect(live.skipped).toBeUndefined();
    expect(live.server?.uptimeSec).toBe(260000);
    expect(live.players).toEqual([{ account: "alia", room: "Tos", rid: 301 }]);
    expect(live.errors).toEqual({ lines: 7, tail: ["line a", "line b"] });
  });

  it("reads the logs' sizes, largest first, without wc's total", () => {
    const live = readLive("@@container\nrunning|2026-10-28T10:00:00Z|0\n@@age\n30\n@@logs\n 1077736 log.txt\n39697880 admin.txt\n 4995526 error.txt\n45771142 total\n");
    expect(live.logs).toEqual([
      { name: "admin.txt", bytes: 39697880 },
      { name: "error.txt", bytes: 4995526 },
      { name: "log.txt", bytes: 1077736 },
    ]);
    expect(readLive("@@container\nmissing\n").logs).toEqual([]);
  });

  it("sends no maintenance commands while blakserv starts", () => {
    const live = readLive("@@container\nrunning|2026-10-31T10:00:00Z|0\n@@age\n30\n@@errors\n0\n");
    expect(live.skipped).toBe("starting");
    expect(live.server).toBeNull();
  });

  it("says when the container is missing or stopped", () => {
    expect(readLive("@@container\nmissing\n").skipped).toBe("not running");
    const stopped = readLive("@@container\nexited|2026-10-31T10:00:00Z|5\n@@age\n100\n");
    expect(stopped.skipped).toBe("not running");
    expect(stopped.container?.state).toBe("exited");
  });
});
