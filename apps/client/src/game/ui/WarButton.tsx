// Ours (docs/adr/0021-factions-and-the-faction-war.md, 2026-10-25): the War button, the faction
// flag that opens the War window. It's by the Modern map (MapCluster), in the Classic toolbar and
// on the phone's top row, always there. It glows while a battle is called or fought, and more
// strongly when our liege fights in it: since the 25th that is how players hear of a battle, as
// the server no longer announces them to everyone in chat and the banner over the view is gone.

import { BATTLE_FLAG, FACTION, WAR_STATE } from "@shards/world";
import { useFactionWar, type FactionWarStore } from "../factionWar.ts";

export function WarButton({ store, onOpen, className, tooltips = true }: {
  store: FactionWarStore;
  onOpen: () => void;
  /** Its place's own button classes: `map-button war-button`, `toolbar-button war-classic` or `touch-button small war-touch` */
  className: string;
  tooltips?: boolean;
}) {
  useFactionWar(store);
  const b = store.battle;
  const active = !!b && b.state !== WAR_STATE.NONE;
  const mine = store.status?.faction ?? FACTION.NEUTRAL;
  const ours = active && mine !== FACTION.NEUTRAL && (b.attacker === mine || b.defender === mine);
  const label = active ? `The Faction War (J): ${b.flags & BATTLE_FLAG.ASSAULT ? "an assault" : b.flags & BATTLE_FLAG.SIEGE ? "a siege" : "a battle"} at ${b.room}` : "The Faction War (J)";
  return (
    <button
      type="button"
      className={`${className}${active ? " active" : ""}${ours ? " ours" : ""}`}
      title={tooltips ? label : undefined}
      aria-label={label}
      onClick={(e) => {
        e.currentTarget.blur();
        onOpen();
      }}
    >
      ⚑
    </button>
  );
}
