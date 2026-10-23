// Ours (docs/adr/0021-factions-and-the-faction-war.md, phase 5): the battle banner at the top of
// the view while one of the lieges' battles is called or fought: where, who, the time to the
// clash or left of the fight, and the armies' troops standing. Lit when our liege is in it; a
// click opens the War window.

import { BATTLE_FLAG, FACTION, LIEGE_SHORT, WAR_STATE } from "@shards/world";
import { formatCountdown, useFactionWar, useSecondTick, type FactionWarStore } from "../factionWar.ts";
import { LIEGE_CLASS } from "./WarDialog.tsx";

export function BattleBanner({ store, onOpen }: { store: FactionWarStore; onOpen: () => void }) {
  useFactionWar(store);
  const b = store.battle;
  const on = !!b && b.state !== WAR_STATE.NONE;
  useSecondTick(on);
  if (!b || !on) return null;
  const mine = store.status?.faction ?? FACTION.NEUTRAL;
  const ours = mine !== FACTION.NEUTRAL && (b.attacker === mine || b.defender === mine);
  const seconds = store.secondsLeft();
  const siege = !!(b.flags & BATTLE_FLAG.SIEGE);
  const side = (f: number, n: number) => (
    <span className={`war-liege ${LIEGE_CLASS[f] ?? ""}`}>
      {LIEGE_SHORT[f] ?? "?"}
      {b.state === WAR_STATE.FIGHT && b.flags & BATTLE_FLAG.SPAWNED ? ` ${n}` : ""}
    </span>
  );
  return (
    <button type="button" className={`battle-banner${ours ? " ours" : ""}`} onClick={onOpen} title="The Faction War (J)">
      <span className="battle-banner-title">
        {siege ? "Siege" : "Battle"}: {b.room}
      </span>
      <span className="battle-banner-sides">
        {side(b.attacker, b.attackersLeft)} <span className="battle-banner-vs">against</span> {side(b.defender, b.defendersLeft)}
      </span>
      <span className="battle-banner-time">{b.state === WAR_STATE.MUSTER ? `They meet in ${formatCountdown(seconds)}` : `${formatCountdown(seconds)} left`}</span>
    </button>
  );
}
