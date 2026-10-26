// Ours (docs/adr/0021-factions-and-the-faction-war.md, phase 5): the War window, from typing
// "war", its key (J), or the War button (WarButton.tsx). Where we stand with our liege (renown, rank, our war
// record), the battle called or being fought and the next one, the towns and who holds them, a
// map of the realm's flagpoles, the last battles, and our liege's war ledger. All of it comes
// from our server (factionwar.kod SendWar), asked for as the window opens and again as a battle
// is called, opens or ends.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BATTLE_FLAG, BATTLE_HOW, FACTION, LIEGE_NAMES, LIEGE_SHORT, POLE_FLAG, SOLDIER_FLAG, WAR_STATE,
  gridCell, gridName, warCommand,
  type GameSession, type WarBattle, type WarPole, type WarStatus,
} from "@shards/world";
import { Button, GroupBox, Tabs, Window } from "./kit.tsx";
import { formatCountdown, useFactionWar, useSecondTick, type FactionWarStore } from "../factionWar.ts";

const TABS = ["The war", "Map", "Ledger", "Battles"] as const;
type Tab = (typeof TABS)[number];

/** Renown each rank starts at (player.kod GetRenownRank) */
const RANKS: { at: number; name: string }[] = [
  { at: 0, name: "Recruit" },
  { at: 10, name: "Soldier" },
  { at: 25, name: "Sergeant" },
  { at: 45, name: "Lieutenant" },
  { at: 70, name: "Captain" },
  { at: 100, name: "Champion" },
];

/** The towns' poles on the map (RID_TOS, RID_BAR_NORTH, RID_CORNOTH, RID_MARION, RID_RAZA, RID_JASWEST) */
const TOWN_LETTERS: Readonly<Record<number, string>> = { 50: "T", 101: "B", 150: "C", 200: "M", 300: "R", 382: "J" };

/** The lieges' colours, as their soldiers' shields (dukeshld.kod, prinshld.kod, reblshld.kod) */
export const LIEGE_CLASS: Readonly<Record<number, string>> = {
  [FACTION.NEUTRAL]: "liege-none",
  [FACTION.DUKE]: "liege-duke",
  [FACTION.PRINCESS]: "liege-princess",
  [FACTION.REBEL]: "liege-rebel",
};

export function WarDialog({ store, session, onClose }: { store: FactionWarStore; session: GameSession; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("The war");
  useFactionWar(store);
  useSecondTick(true);
  useEffect(() => {
    session.shardsCommand(warCommand());
  }, [session]);
  // A battle called, opened or ended: all of it again (the map and the ledger change too)
  const state = store.battle?.state ?? WAR_STATE.NONE;
  const last = useRef(state);
  useEffect(() => {
    if (last.current !== state) session.shardsCommand(warCommand());
    last.current = state;
  }, [session, state]);
  const s = store.status;
  return (
    <Window title="The Faction War" onClose={onClose} className="game-dialog war-window">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="war-page">
        {!s ? (
          <p>Asking the heralds...</p>
        ) : (
          <>
            {tab === "The war" && <WarPage s={s} store={store} />}
            {tab === "Map" && <MapPage s={s} />}
            {tab === "Ledger" && <LedgerPage s={s} />}
            {tab === "Battles" && <BattlesPage s={s} store={store} />}
          </>
        )}
      </div>
      <div className="mk-buttons">
        <Button isDefault onClick={onClose}>
          Close
        </Button>
      </div>
    </Window>
  );
}

function Liege({ faction, short }: { faction: number; short?: boolean }) {
  return <span className={`war-liege ${LIEGE_CLASS[faction] ?? ""}`}>{(short ? LIEGE_SHORT : LIEGE_NAMES)[faction] ?? "No liege"}</span>;
}

/** What the battle is, in a sentence */
export function battleText(b: WarBattle, seconds: number): string {
  const att = LIEGE_SHORT[b.attacker] ?? "Someone";
  const def = LIEGE_SHORT[b.defender] ?? "someone";
  const siege = !!(b.flags & BATTLE_FLAG.SIEGE);
  if (b.state === WAR_STATE.MUSTER) {
    if (siege) return `${cap(att)}'s army lays siege to ${def} at ${b.room}. It gathers in ${formatCountdown(seconds)}.`;
    if (b.flags & BATTLE_FLAG.OPEN_GROUND) return `${cap(att)} and ${def} both march on ${b.room}, which no liege holds. The armies meet in ${formatCountdown(seconds)}.`;
    return `${cap(att)} marches on ${b.room}, held by ${def}. The armies meet in ${formatCountdown(seconds)}.`;
  }
  if (b.state === WAR_STATE.FIGHT) {
    const field = b.flags & BATTLE_FLAG.SPAWNED ? `${cap(att)} ${b.attackersLeft} of ${b.attackersRaised}, ${def} ${b.defendersLeft} of ${b.defendersRaised}.` : "The armies wait for a soldier to take the field.";
    return `${siege ? "The siege" : "The battle"} at ${b.room}: ${field} ${formatCountdown(seconds)} left.`;
  }
  return "";
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function WarPage({ s, store }: { s: WarStatus; store: FactionWarStore }) {
  const b = s.battle;
  const next = store.nextSeconds();
  const ours = s.faction !== FACTION.NEUTRAL && (b.attacker === s.faction || b.defender === s.faction);
  const rankAt = RANKS.filter((r) => r.at <= s.renown).pop() ?? RANKS[0]!;
  const nextRank = RANKS.find((r) => r.at > s.renown);
  const towns = s.towns;
  const halfStaff = (rid: number) => s.poles.some((p) => p.rid === rid && p.flags & POLE_FLAG.HALF_STAFF);
  return (
    <>
      <GroupBox label="Your service">
        {s.faction === FACTION.NEUTRAL ? (
          <p>You serve no liege. Duke Akardius in Tos, Princess Kateriina in Barloque and Jonas D'Accor in Jasper take soldiers who have proved themselves.</p>
        ) : (
          <>
            <p className="war-rank">
              {s.rank || rankAt.name} of <Liege faction={s.faction} />
            </p>
            <div className="war-renown" style={{ "--renown": `${s.renown}%` } as CSSProperties} title={`${s.renown} renown of 100`}>
              {s.renown} renown{nextRank ? `, ${nextRank.at - s.renown} to ${nextRank.name}` : ""}
            </div>
            <p className="war-note">
              {s.flags & SOLDIER_FLAG.SHIELD ? "You wear your soldier's shield: you may join your liege's battles, and enemy soldiers may attack you." : "Your soldier's shield is put away: wear it to join your liege's battles."}
              {s.flags & SOLDIER_FLAG.REGROUPING ? " You are regrouping after a defeat: enemy soldiers leave you be until you strike or join a battle." : ""}
            </p>
            <table className="war-record">
              <tbody>
                <tr>
                  <th>Soldiers bested</th>
                  <td>{s.kills}</td>
                  <th>Fallen</th>
                  <td>{s.deaths}</td>
                </tr>
                <tr>
                  <th>Battles fought</th>
                  <td>{s.fought}</td>
                  <th>Won</th>
                  <td>{s.won}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </GroupBox>
      <GroupBox label="The battle">
        {b.state === WAR_STATE.NONE ? (
          <p>No battle now. {next !== null ? `The lieges call the next in ${formatCountdown(next)}.` : ""}</p>
        ) : (
          <>
            <p className={`war-battle${ours ? " ours" : ""}`}>{battleText(b, store.secondsLeft())}</p>
            {ours && <p className="war-note">Your liege fights here. Wear your shield and go to {b.room}.</p>}
          </>
        )}
        <p className="war-note">
          War effort for the next battle:{" "}
          {[FACTION.DUKE, FACTION.PRINCESS, FACTION.REBEL].map((f, i) => (
            <span key={f}>
              {i > 0 && ", "}
              <Liege faction={f} short /> {s.effort[i]}
            </span>
          ))}
          .
        </p>
      </GroupBox>
      <GroupBox label="The towns">
        <ul className="war-towns">
          {towns.map((t) => (
            <li key={t.rid}>
              <span className="war-town-name">{t.name}</span>
              <Liege faction={t.owner} />
              {t.celebrating !== FACTION.NEUTRAL && <span className="war-tag">celebrating</span>}
              {halfStaff(t.rid) && <span className="war-tag sad">flags at half-staff</span>}
            </li>
          ))}
        </ul>
      </GroupBox>
    </>
  );
}

function MapPage({ s }: { s: WarStatus }) {
  const [hover, setHover] = useState<WarPole | null>(null);
  const cells = s.poles.map((p) => ({ p, at: gridCell(p.rid) })).filter((c) => c.at);
  const counts = [FACTION.DUKE, FACTION.PRINCESS, FACTION.REBEL, FACTION.NEUTRAL].map((f) => s.poles.filter((p) => p.owner === f).length);
  return (
    <>
      <div className="war-map" role="img" aria-label="The realm's flagpoles">
        {cells.map(({ p, at }) => (
          <span
            key={p.rid}
            className={`war-pole ${LIEGE_CLASS[p.owner] ?? ""}${p.flags & POLE_FLAG.TOWN ? " town" : ""}${p.flags & POLE_FLAG.BATTLE ? " battle" : ""}${p.flags & POLE_FLAG.HALF_STAFF ? " half" : ""}`}
            style={{ gridColumn: at!.col, gridRow: at!.row }}
            title={`${p.name}${gridName(p.rid) ? ` (${gridName(p.rid)})` : ""}: ${LIEGE_NAMES[p.owner] ?? "no liege"}`}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
          >
            {p.flags & POLE_FLAG.BATTLE ? "⚔" : p.flags & POLE_FLAG.TOWN ? (TOWN_LETTERS[p.rid] ?? p.name[0]) : ""}
          </span>
        ))}
      </div>
      <p className="war-map-caption">
        {hover ? (
          <>
            {hover.name}
            {gridName(hover.rid) ? ` (${gridName(hover.rid)})` : ""}: <Liege faction={hover.owner} />
            {hover.flags & POLE_FLAG.BATTLE ? ", where the armies fight" : ""}
          </>
        ) : (
          "The realm's flagpoles, north at the top. Large squares are the towns' own poles: Tos, Barloque, Cor Noth, Marion, Jasper and Raza."
        )}
      </p>
      <p className="war-legend">
        <Liege faction={FACTION.DUKE} short /> {counts[0]}, <Liege faction={FACTION.PRINCESS} short /> {counts[1]}, <Liege faction={FACTION.REBEL} short /> {counts[2]}, <Liege faction={FACTION.NEUTRAL} short /> {counts[3]}
      </p>
    </>
  );
}

function LedgerPage({ s }: { s: WarStatus }) {
  if (s.faction === FACTION.NEUTRAL) return <p>Each liege keeps a ledger of their best soldiers. You serve no liege.</p>;
  if (s.ledger.length === 0) return <p>None of {LIEGE_NAMES[s.faction]}'s soldiers have fought yet.</p>;
  return (
    <>
      <p className="war-note">{LIEGE_NAMES[s.faction]}'s war ledger: the soldiers who have served best.</p>
      <table className="war-ledger">
        <thead>
          <tr>
            <th />
            <th>Soldier</th>
            <th>Rank</th>
            <th>Bested</th>
            <th>Battles won</th>
          </tr>
        </thead>
        <tbody>
          {s.ledger.map((e, i) => (
            <tr key={i}>
              <td>{i + 1}.</td>
              <th>{e.name}</th>
              <td>{e.rank}</td>
              <td>{e.kills}</td>
              <td>
                {e.won} of {e.fought}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BattlesPage({ s, store }: { s: WarStatus; store: FactionWarStore }) {
  if (s.history.length === 0) return <p>No battles have been fought yet.</p>;
  const since = store.secondsSinceStatus();
  return (
    <ul className="war-history">
      {s.history.map((h, i) => (
        <li key={i}>
          <span className="war-history-place">{h.name || gridName(h.rid) || "Somewhere"}</span>{" "}
          <Liege faction={h.attacker} short /> against <Liege faction={h.defender} short />: <Liege faction={h.winner} short /> won
          {h.how === BATTLE_HOW.UNWATCHED ? " (unwatched)" : h.how === BATTLE_HOW.TIME ? " (as the light failed)" : ""}
          <span className="war-ago">{agoText(h.secondsAgo + since)}</span>
        </li>
      ))}
    </ul>
  );
}

function agoText(seconds: number): string {
  if (seconds < 90) return "just now";
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}
