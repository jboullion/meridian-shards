import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, UC } from "@shards/protocol";
import { BATTLE_FLAG, FACTION, gridCell, gridName, readFactionWar, WAR_STATE } from "../src/factionWar.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const UC_FACTION_WAR = userCommand(UC.FACTION_WAR, "packages/world/src/factionWar.ts");

/** factionwar.kod AddBattlePacket */
function battle(w: ByteWriter, state: number): ByteWriter {
  return w
    .u8(state)
    .u8(FACTION.DUKE)
    .u8(FACTION.PRINCESS)
    .u8(BATTLE_FLAG.SPAWNED)
    .u32(544)
    .string("Valley of Ileria")
    .u16(312)
    .u8(7)
    .u8(9)
    .u8(11)
    .u8(12)
    .u32(5400);
}

describe("UC_FACTION_WAR", () => {
  it("reads the battle alone (SendBattle)", () => {
    const e = fixture(UC_FACTION_WAR, readFactionWar, new ByteReader(battle(new ByteWriter().u8(2), WAR_STATE.FIGHT).finish()));
    expect(e).toEqual({
      type: "battle",
      battle: {
        state: WAR_STATE.FIGHT, attacker: 1, defender: 2, flags: BATTLE_FLAG.SPAWNED, rid: 544, room: "Valley of Ileria",
        secondsLeft: 312, attackersLeft: 7, defendersLeft: 9, attackersRaised: 11, defendersRaised: 12, nextSeconds: 5400,
      },
    });
  });

  it("reads all of it (SendWar)", () => {
    const w = new ByteWriter().u8(1).u8(FACTION.DUKE).u8(72).string("Captain").u16(3).u16(1).u16(4).u16(2).u8(1);
    battle(w, WAR_STATE.MUSTER);
    w.u8(2).u8(0).u8(1);
    w.u8(2).u32(544).string("Valley of Ileria").u8(2).u8(4).u32(50).string("Tos").u8(1).u8(1);
    w.u8(1).u32(50).string("Tos").u8(1).u8(1);
    w.u8(1).u32(593).string("Outskirts of Barloque").u8(1).u8(2).u8(2).u8(3).u32(600);
    w.u8(1).string("Scout").string("Captain").u16(3).u16(2).u16(4);
    w.u16(1).u32(544).u32(50).u8(1);
    const e = fixture(UC_FACTION_WAR, readFactionWar, new ByteReader(w.finish()));
    expect(e?.type).toBe("all");
    if (e?.type !== "all") return;
    expect(e.status).toMatchObject({ faction: 1, renown: 72, rank: "Captain", kills: 3, deaths: 1, fought: 4, won: 2, flags: 1, effort: [2, 0, 1] });
    expect(e.status.battle.state).toBe(WAR_STATE.MUSTER);
    expect(e.status.poles).toEqual([
      { rid: 544, name: "Valley of Ileria", owner: 2, flags: 4 },
      { rid: 50, name: "Tos", owner: 1, flags: 1 },
    ]);
    expect(e.status.towns).toEqual([{ rid: 50, name: "Tos", owner: 1, celebrating: 1 }]);
    expect(e.status.history).toEqual([{ rid: 593, name: "Outskirts of Barloque", attacker: 1, defender: 2, winner: 2, how: 3, secondsAgo: 600 }]);
    expect(e.status.ledger).toEqual([{ name: "Scout", rank: "Captain", kills: 3, won: 2, fought: 4 }]);
    expect(e.status.links).toEqual([{ a: 544, b: 50, front: true }]);
  });

  it("places flag rooms on the grid", () => {
    expect(gridCell(544)).toEqual({ col: 4, row: 4 });
    expect(gridName(544)).toBe("D4");
    expect(gridName(613)).toBe("K3");
    expect(gridCell(50)).toEqual({ col: 9, row: 5 });
    expect(gridName(50)).toBe("");
    expect(gridCell(12345)).toBeNull();
  });
});
