// Ours (docs/adr/0009-quests.md 4): the Quests tab of the character window and the interface column,
// from our server's log and the catalogue (quests.ts), in three tabs: Current (the quests going,
// and signet rings to return), Done, and Suggested (offered around Meridian for our health). Each
// quest is drawn as the Modern interface's quest box draws it (QuestBox.tsx QuestEntry): its gold
// name and one line, its current step or who gives it. A double click opens its window
// (QuestDialog.tsx QuestInfoDialog), where Abandon is. Up to three are tracked (a quest going's
// Track): their ways on the map, and first in the quest box.

import { useState } from "react";
import { bandText, rewardText, suggestedQuests, timeLeftText, type CatalogQuest } from "@shards/world";
import { SIGNET_QUEST_NAME, signetObjective, useQuests, type QuestStore } from "../quests.ts";
import { Check, Tabs } from "./kit.tsx";
import { currentStepLine, QuestEntry, useTicking } from "./QuestBox.tsx";

const TABS = ["Current", "Done", "Suggested"] as const;
type QuestTab = (typeof TABS)[number];

/** Who gives a quest, and where: "Pietro, Pietro's Wicked Brews" */
const giverLine = (q: CatalogQuest): string => {
  const where = q.giver.rooms.map((r) => r.name).join(" or ");
  return where ? `${q.giver.name}, ${where}` : q.giver.name;
};

export function QuestsPanel({
  store, maxHealth, onOpen,
}: {
  store: QuestStore | null;
  maxHealth: number | null;
  onOpen?: (id: number) => void;
}) {
  useQuests(store);
  const [tab, setTab] = useState<QuestTab>("Current");
  const [picked, setPicked] = useState<number | null>(null);
  const active = store?.activeQuests() ?? [];
  useTicking(tab === "Current" && active.some((a) => a.secondsLeft >= 0));
  if (!store) return <div className="quests-panel panel-note">Starting…</div>;

  const open = (id: number) => onOpen?.(id);
  let body;
  if (tab === "Current") {
    // The tracked ones first, in the order they were taken on (as the quest box)
    const going = [...active.filter((a) => store.isTracked(a.id)), ...active.filter((a) => !store.isTracked(a.id))];
    body =
      going.length || store.signets.length ? (
        <>
          {going.map((a) => {
            const left = store.secondsLeft(a);
            const step = currentStepLine(a);
            return (
              <QuestEntry
                key={a.id}
                name={a.quest?.name ?? `Quest ${a.id}`}
                line={step?.line ?? "This quest isn't in your game data yet."}
                ready={step?.ready}
                time={left >= 0 ? timeLeftText(left) : undefined}
                tone="tracked"
                title="Double-click for the quest's details"
                selected={picked === a.id}
                onSelect={() => setPicked(a.id)}
                onOpen={() => open(a.id)}
                aside={
                  <Check
                    label="Track"
                    title="Show its way on the map, and first in the quest box (up to three)"
                    checked={store.isTracked(a.id)}
                    onChange={(v) => store.setTracked(a.id, v)}
                  />
                }
              />
            );
          })}
          {/* Signet rings we carry, bronze: given to their owner (double-click them) for a reward */}
          {store.signets.map((r) => (
            <QuestEntry
              key={`signet-${r.id}`}
              name={SIGNET_QUEST_NAME}
              line={signetObjective(r)}
              tone="bronze"
              title="The ring bears their family crest. Give it to them (double-click them) for a reward."
            />
          ))}
        </>
      ) : (
        <p className="panel-note">No quests going. Look for a gold "!" over people in town.</p>
      );
  } else if (tab === "Done") {
    const done = store.done
      .map((d) => ({ ...d, quest: store.quest(d.id) }))
      .sort((a, b) => (a.quest?.name ?? "").localeCompare(b.quest?.name ?? ""));
    body = done.length ? (
      done.map((d) => {
        const extra = [d.times > 1 ? `done ${d.times} times` : "", d.quest?.repeatHours != null ? "can be done again" : ""].filter(Boolean).join(", ");
        return (
          <QuestEntry
            key={d.id}
            name={d.quest?.name ?? `Quest ${d.id}`}
            line={d.quest ? `${giverLine(d.quest)}${extra ? ` · ${extra}` : ""}` : undefined}
            tone="tracked"
            title="Double-click for the quest's details"
            selected={picked === d.id}
            onSelect={() => setPicked(d.id)}
            onOpen={() => open(d.id)}
          />
        );
      })
    ) : (
      <p className="panel-note">None done yet.</p>
    );
  } else {
    const suggested = maxHealth === null ? [] : suggestedQuests(store.catalog, maxHealth, store.active, store.done);
    body = suggested.length ? (
      suggested.map((q) => (
        <QuestEntry
          key={q.id}
          name={q.name}
          line={`${giverLine(q)} · ${bandText(q)}`}
          tone="tracked"
          title={`${q.text.offer}\n\nReward: ${rewardText(q)}\n\nDouble-click for the quest's details`}
          selected={picked === q.id}
          onSelect={() => setPicked(q.id)}
          onOpen={() => open(q.id)}
        />
      ))
    ) : (
      <p className="panel-note">Nothing to suggest for your health just now.</p>
    );
  }

  return (
    <div className="quests-panel">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {store.stale && <p className="panel-note quest-stale">Your game data is out of date: reload the page to see every quest.</p>}
      <div className="quests-list">{body}</div>
    </div>
  );
}
