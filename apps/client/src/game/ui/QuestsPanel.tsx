// Ours (docs/adr/0009-quests.md 4): the Quests tab of the character window and the interface column,
// from our server's log and the catalogue (quests.ts): the quests going, with their objectives,
// time left, Track and Abandon; those suggested for our health, and who gives them; those done.
// Up to three are tracked: their ways on the map, and first in the Modern interface's quest box
// (QuestBox.tsx). A double click on one going opens its window (QuestDialog.tsx QuestInfoDialog).

import { useEffect, useState } from "react";
import { bandText, objectiveLine, rewardText, suggestedQuests, timeLeftText, type GameSession } from "@shards/world";
import { SIGNET_QUEST_NAME, signetObjective, useQuests, type QuestStore } from "../quests.ts";
import { PanelSection } from "./FriendsPanel.tsx";
import { Button, Check, ListBox } from "./kit.tsx";

/** Re-render every second while a quest has a time limit, for its countdown */
function useTicking(on: boolean): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

export function QuestsPanel({
  store, session, maxHealth, onOpen, showSuggested, onShowSuggested,
}: {
  store: QuestStore | null;
  session: GameSession;
  maxHealth: number | null;
  onOpen?: (id: number) => void;
  /** Ours: "Suggested for you" shows (settings.questSuggestions, off by default), and its checkbox */
  showSuggested: boolean;
  onShowSuggested: (on: boolean) => void;
}) {
  useQuests(store);
  const [picked, setPicked] = useState<number | null>(null);
  const active = store?.activeQuests() ?? [];
  useTicking(active.some((a) => a.secondsLeft >= 0));
  if (!store) return <div className="quests-panel panel-note">Starting…</div>;

  // Ours: signet rings we carry are listed too, as bronze quests (keyed by minus the ring's id)
  const ring = picked !== null && picked < 0 ? (store.signets.find((r) => -r.id === picked) ?? null) : null;
  const current = ring ? null : (active.find((a) => a.id === picked) ?? active[0] ?? null);
  const shownRing = ring ?? (current ? null : (store.signets[0] ?? null));
  const suggested = maxHealth === null ? [] : suggestedQuests(store.catalog, maxHealth, store.active, store.done);
  const done = store.done.map((d) => ({ ...d, quest: store.quest(d.id) })).sort((a, b) => (a.quest?.name ?? "").localeCompare(b.quest?.name ?? ""));

  return (
    <div className="quests-panel">
      {store.stale && <p className="panel-note quest-stale">Your game data is out of date: reload the page to see every quest.</p>}
      <PanelSection title="Going">
        {active.length || store.signets.length ? (
          <>
            <ListBox
              className="panel-list"
              label="Quests going"
              selected={current?.id ?? (shownRing ? -shownRing.id : null)}
              onSelect={setPicked}
              onActivate={(k) => k > 0 && onOpen?.(k)}
              items={[
                ...active.map((a) => ({ key: a.id, label: a.quest?.name ?? `Quest ${a.id}` })),
                ...store.signets.map((r) => ({ key: -r.id, label: SIGNET_QUEST_NAME, className: "quest-bronze" })),
              ]}
            />
            {shownRing && (
              <div className="quest-detail">
                <ul className="quest-objectives">
                  <li className="current">{signetObjective(shownRing)}</li>
                </ul>
                <p className="panel-note">The ring bears their family crest. Give it to them (double-click them) for a reward.</p>
              </div>
            )}
            {current && (
              <div className="quest-detail">
                {current.quest ? (
                  <ul className="quest-objectives">
                    {current.quest.steps.map((s, i) => {
                      const n = i + 1;
                      if (n > current.step) return null;
                      return (
                        <li key={n} className={n < current.step ? "done" : "current"}>
                          {objectiveLine(s, n < current.step ? s.count : current.count)}
                          {n === current.step && !s.auto && s.count <= current.count && s.kind !== "talk" && s.kind !== "deliver" && <small> (return to {s.turnin.name})</small>}
                          {n === current.step && (s.kind === "talk" || s.kind === "deliver") && s.turnin.rooms.length > 0 && <small> ({s.turnin.rooms.map((r) => r.name).join(" or ")})</small>}
                          {n === current.step && s.rooms.length > 0 && <small> ({s.rooms.map((r) => r.name).join(" or ")})</small>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="panel-note">This quest isn't in your game data yet.</p>
                )}
                {store.secondsLeft(current) >= 0 && <p className="panel-note">Time left: {timeLeftText(store.secondsLeft(current))}</p>}
                <div className="panel-row wrap">
                  <Check label="Track" title="Show its way on the map, and first in the quest box (up to three)" checked={store.isTracked(current.id)} onChange={(v) => store.setTracked(current.id, v)} />
                  <Button
                    onClick={() => {
                      if (window.confirm(`Abandon ${current.quest?.name ?? "this quest"}? You can take it on again from the start.`)) session.shardsCommand(`quest abandon ${current.id}`);
                    }}
                  >
                    Abandon
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="panel-note">None. Look for a gold "!" over people in town.</p>
        )}
      </PanelSection>
      <PanelSection title="Done">
        {done.length ? (
          <ul className="quest-done">
            {done.map((d) => (
              <li key={d.id}>
                {d.quest?.name ?? `Quest ${d.id}`}
                {d.times > 1 && <small> ×{d.times}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">None yet.</p>
        )}
      </PanelSection>
      {showSuggested && (
        <PanelSection title="Suggested for you">
          {suggested.length ? (
            <ul className="quest-suggested">
              {suggested.slice(0, 12).map((q) => (
                <li key={q.id} title={`${q.text.offer}\n\nReward: ${rewardText(q)}`}>
                  <b>{q.name}</b>{" "}
                  <small>
                    {q.giver.name}
                    {q.giver.rooms.length ? `, ${q.giver.rooms[0]!.name}` : ""}; {bandText(q)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-note">Nothing for your health just now.</p>
          )}
        </PanelSection>
      )}
      <Check label="Show suggestions" title="Quests offered around Meridian for your health, and who gives them" checked={showSuggested} onChange={onShowSuggested} />
    </div>
  );
}
