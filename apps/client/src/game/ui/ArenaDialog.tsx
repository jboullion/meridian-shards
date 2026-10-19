// Ours (docs/adr/0019-arena-bouts.md): the Arena window, from the crossed swords by the map (or
// typed "arena") in the Arena of Kraanan and the Arena of Death. Mock bouts against our server's
// arena fighters (arenabouts.kod), the watchers' matches of players without saying their words
// aloud, and our mock record and title.

import { useEffect, useState, type CSSProperties } from "react";
import {
  ARENA, ARENA_FLAG, BOUT_END, BOUT_STATE, arenaCommand, boutEndText,
  type ArenaPvpWord, type BoutRecord, type ArenaStatus, type GameSession,
} from "@shards/world";
import { Button, GroupBox, Tabs, Window } from "./kit.tsx";

const TABS = ["Mock bouts", "Player battles", "Record"] as const;
type Tab = (typeof TABS)[number];

const RULES: Record<number, string> = {
  [ARENA.KRAANAN]:
    "A melee: you and three arena fighters, everyone against everyone, matched to your health. Nobody dies in a mock bout: lose, and you wake in the stands with a tenth of your health. Win, and you leave as you came in. Four minutes on the sand.",
  [ARENA.DEATH]:
    "A duel against one of Johlan Tulca's elites: a gladiator in heavy armour, or a battle mage of Qor, Faren or Riija who will hold, web and blind you. They have about your health, and never less than 100. A mock bout here is still not a death: lose, and you're carried out of the cage. Three minutes.",
};

const STYLES: { word: ArenaPvpWord; label: string; title: string }[] = [
  { word: "traditional", label: "Traditional", title: "One against one" },
  { word: "lastman", label: "Last man standing", title: "Everyone against everyone" },
  { word: "guild", label: "Guild vs guild", title: "Two guilds" },
  { word: "royale", label: "Battle royale", title: "More than two guilds" },
];

export function ArenaDialog({ status, session, onClose }: { status: ArenaStatus | null; session: GameSession; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("Mock bouts");
  useEffect(() => {
    session.shardsCommand(arenaCommand("status"));
  }, [session]);
  const send = (line: string) => session.shardsCommand(line);
  const here = status?.arena ?? ARENA.NONE;
  const title = here === ARENA.DEATH ? "The Arena of Death" : here === ARENA.KRAANAN ? "The Arena of Kraanan" : "The arenas";
  return (
    <Window title={title} onClose={onClose} className="game-dialog arena-window">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="arena-page">
        {tab === "Mock bouts" && <MockPage status={status} session={session} send={send} />}
        {tab === "Player battles" && <PlayersPage status={status} send={send} />}
        {tab === "Record" && <RecordPage status={status} />}
      </div>
      <div className="mk-buttons">
        <Button isDefault onClick={onClose}>
          Close
        </Button>
      </div>
    </Window>
  );
}

function MockPage({ status, session, send }: { status: ArenaStatus | null; session: GameSession; send: (line: string) => void }) {
  if (!status || status.arena === ARENA.NONE) {
    return <p>Mock bouts are fought in the Arena of Kraanan, through the foyer off East Ende in Tos, and in the Arena of Death, in East Ende itself. Go there, and press the crossed swords by your map.</p>;
  }
  const s = status;
  const mine = s.state === BOUT_STATE.COUNTDOWN || s.state === BOUT_STATE.FIGHTING || s.state === BOUT_STATE.ENDING;
  const queued = s.state === BOUT_STATE.QUEUED;
  const fighter = s.boutPlayer ? session.world.objects.get(s.boutPlayer) : undefined;
  const fighterName = fighter ? (session.resource(fighter.info.nameRes) ?? "Someone") : "Someone";
  let line: string;
  if (s.state === BOUT_STATE.COUNTDOWN) line = `Your bout begins in ${s.secondsLeft} seconds.`;
  else if (s.state === BOUT_STATE.FIGHTING) line = `Fight! ${formatTime(s.secondsLeft)} left.`;
  else if (s.state === BOUT_STATE.ENDING) line = "You are beaten.";
  else if (queued) line = s.place <= 1 && s.floor === BOUT_STATE.IDLE ? "You are next: your bout begins shortly." : `You are waiting: ${s.place} in line.`;
  else if (s.floor !== BOUT_STATE.IDLE) line = `${fighterName} is fighting a bout.`;
  else line = s.ended ? boutEndText(s.ended) : "The floor is free.";
  const pvpBusy = !!(s.flags & ARENA_FLAG.PVP_BUSY);
  return (
    <>
      <p className="arena-rules">{RULES[s.arena]}</p>
      <p className={`arena-state${mine ? " mine" : ""}${s.ended === BOUT_END.WON && !mine && !queued ? " won" : ""}`}>{line}</p>
      {pvpBusy && !mine && <p className="arena-note">Players have a match set up here: your bout waits until it's over.</p>}
      {s.floor !== BOUT_STATE.IDLE && s.opponents.length > 0 && (
        <GroupBox label={mine ? "Your opponents" : "On the floor"}>
          <ul className="arena-opponents">
            {s.opponents.map((o, i) => (
              <li key={i} className={o.id ? "" : "fallen"}>
                <span className="arena-opp-name">
                  {o.name}, {o.kindName}
                </span>
                <span className="arena-hp" style={{ "--hp": `${o.maxHp ? Math.round((100 * o.hp) / o.maxHp) : 0}%` } as CSSProperties}>
                  {o.id ? `${o.hp}/${o.maxHp}` : "beaten"}
                </span>
              </li>
            ))}
          </ul>
        </GroupBox>
      )}
      <div className="mk-buttons arena-actions">
        {mine ? (
          <Button onClick={() => send(arenaCommand("leave"))} disabled={s.state === BOUT_STATE.ENDING}>
            Give up the bout
          </Button>
        ) : queued ? (
          <Button onClick={() => send(arenaCommand("leave"))}>Leave the line</Button>
        ) : (
          <Button isDefault onClick={() => send(arenaCommand("join"))}>
            {s.arena === ARENA.DEATH ? "Join a duel" : "Join a mock battle"}
          </Button>
        )}
      </div>
    </>
  );
}

function PlayersPage({ status, send }: { status: ArenaStatus | null; send: (line: string) => void }) {
  if (!status || status.arena === ARENA.NONE) {
    return <p>Matches of players are fought in the Arena of Kraanan and the Arena of Death, run by their watchers.</p>;
  }
  const busy = status.floor !== BOUT_STATE.IDLE;
  const pvp = (word: ArenaPvpWord) => send(arenaCommand({ pvp: word }));
  return (
    <>
      <p className="arena-rules">
        Fights between players, as the arena's watcher runs them: choose a style, then say Champion to wait in the cage for a challenger. Others Challenge the champion, and the champion Accepts. Renege backs out.
        {status.arena === ARENA.DEATH ? " In the Arena of Death a match of players is a real death: the Underworld, and lost experience, though you keep your things." : " In the Arena of Kraanan nobody dies: the loser is put in the stands."}
      </p>
      {busy && <p className="arena-note">A mock bout holds the floor. Wait until it's over.</p>}
      <GroupBox label="Style">
        <div className="arena-row">
          {STYLES.map((st) => (
            <Button key={st.word} onClick={() => pvp(st.word)} disabled={busy} title={st.title}>
              {st.label}
            </Button>
          ))}
        </div>
      </GroupBox>
      <div className="mk-buttons arena-actions">
        <Button onClick={() => pvp("champion")} disabled={busy}>
          Champion
        </Button>
        <Button onClick={() => pvp("challenge")} disabled={busy}>
          Challenge
        </Button>
        <Button onClick={() => pvp("accept")} disabled={busy}>
          Accept
        </Button>
        <Button onClick={() => pvp("renege")}>Renege</Button>
      </div>
    </>
  );
}

function RecordPage({ status }: { status: ArenaStatus | null }) {
  const empty: BoutRecord = { wins: 0, losses: 0, streak: 0, best: 0 };
  const [kraanan, death] = status?.records ?? [empty, empty];
  return (
    <>
      <p className="arena-title">{status?.title || "Untested"}</p>
      <p className="arena-note">Your mock bouts. Matches of players are the watchers' own: their champions and trophies.</p>
      <table className="arena-record">
        <thead>
          <tr>
            <th />
            <th>Won</th>
            <th>Lost</th>
            <th>Streak</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          <RecordRow label="Melees, Arena of Kraanan" r={kraanan} />
          <RecordRow label="Duels, Arena of Death" r={death} />
        </tbody>
      </table>
    </>
  );
}

function RecordRow({ label, r }: { label: string; r: BoutRecord }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{r.wins}</td>
      <td>{r.losses}</td>
      <td>{r.streak}</td>
      <td>{r.best}</td>
    </tr>
  );
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
