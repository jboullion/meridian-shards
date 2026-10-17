// Ours (docs/adr/0009-quests.md 3.3): the quest window, opened by what an NPC we talked to has for
// us (UC_QUEST_OFFERS, after activating them). Several quests are listed first. An offer shows
// the story, the band, the objectives with where they are, and the rewards, with Accept; a step
// ready to hand in shows Complete, then what comes next (or the reward). Everything is checked
// again by the server (util/questbook.kod); the text is the catalogue's (quests.ts).

import { useEffect, useRef, useState } from "react";
import { bandText, objectiveLine, QUEST_OFFER, rewardsLine, rewardText, timeLeftText, type CatalogQuest, type CatalogStep, type GameSession, type QuestOffer } from "@shards/world";
import type { QuestStore } from "../quests.ts";
import { Button, ListBox, Window } from "./kit.tsx";

/** As the server's QUEST_REACH (4 squares), and a little: past it, the window closes */
const QUEST_REACH = 5 * 1024;

type View = { kind: "list" } | { kind: "quest"; id: number } | { kind: "after"; id: number; step: number };

const STATE_LABEL: Record<number, string> = {
  [QUEST_OFFER.OFFER]: "!",
  [QUEST_OFFER.READY]: "?",
  [QUEST_OFFER.PENDING]: "…",
  [QUEST_OFFER.SOON]: "later",
};

/** Where a step is done: its rooms, or where its NPC stands */
function whereText(s: CatalogStep): string {
  const rooms = s.rooms.length ? s.rooms : s.kind === "talk" || s.kind === "deliver" ? s.turnin.rooms : [];
  return rooms.length ? rooms.map((r) => r.name).join(" or ") : "";
}

function Objectives({ quest, from = 0, step, count }: { quest: CatalogQuest; from?: number; step?: number; count?: number }) {
  return (
    <ul className="quest-objectives">
      {quest.steps.slice(from).map((s, i) => {
        const n = from + i + 1;
        const where = whereText(s);
        return (
          <li key={n} className={step !== undefined && n < step ? "done" : n === step ? "current" : ""}>
            {objectiveLine(s, n === step ? (count ?? 0) : step !== undefined && n < step ? s.count : 0)}
            {where && <small> ({where})</small>}
            {!s.auto && s.turnin.name !== quest.giver.name && s.kind !== "talk" && s.kind !== "deliver" && <small>, then to {s.turnin.name}</small>}
            {rewardsLine(s.rewards) && <small className="quest-step-reward"> +{rewardsLine(s.rewards)}</small>}
          </li>
        );
      })}
    </ul>
  );
}

export function QuestDialog({
  npc, offers, store, session, onClose,
}: {
  npc: number;
  offers: QuestOffer[];
  store: QuestStore;
  session: GameSession;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(offers.length === 1 ? { kind: "quest", id: offers[0]!.id } : { kind: "list" });
  const [picked, setPicked] = useState<number | null>(offers[0]?.id ?? null);
  const [from] = useState(() => {
    const self = session.world.self;
    return self ? { x: self.x, y: self.y } : null;
  });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const t = window.setInterval(() => {
      const self = session.world.self;
      if (from && self && Math.hypot(self.x - from.x, self.y - from.y) > QUEST_REACH) close.current();
    }, 250);
    return () => window.clearInterval(t);
  }, [session, from]);

  const o = session.world.objects.get(npc);
  const npcName = (o && session.resource(o.info.nameRes)) || "Quests";
  const nameOf = (id: number) => store.quest(id)?.name ?? `Quest ${id}`;

  if (view.kind === "list") {
    return (
      <Window title={npcName} onClose={onClose} className="game-dialog quest-dialog">
        <ListBox
          label="Quests"
          autoFocus
          selected={picked}
          onSelect={setPicked}
          onActivate={(id) => setView({ kind: "quest", id })}
          items={offers.map((x) => ({ key: x.id, label: `${STATE_LABEL[x.state] ?? ""} ${nameOf(x.id)}`, className: x.state === QUEST_OFFER.SOON || x.state === QUEST_OFFER.PENDING ? "quest-later" : "" }))}
        />
        <div className="mk-buttons">
          <Button isDefault disabled={picked === null} onClick={() => picked !== null && setView({ kind: "quest", id: picked })}>
            Open
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </Window>
    );
  }

  const quest = store.quest(view.id);
  const back = offers.length > 1 ? () => setView({ kind: "list" }) : null;
  if (!quest) {
    return (
      <Window title={npcName} onClose={onClose} className="game-dialog quest-dialog">
        <p>{store.stale ? "Your game data is out of date: reload the page to see this quest." : "This quest isn't in your game data yet."}</p>
        <div className="mk-buttons">
          <Button isDefault onClick={onClose}>Close</Button>
        </div>
      </Window>
    );
  }

  // After a hand-in: what comes next, or the reward
  if (view.kind === "after") {
    const last = view.step >= quest.steps.length;
    const next = quest.steps[view.step];
    return (
      <Window title={quest.name} onClose={onClose} className="game-dialog quest-dialog">
        <p className="quest-story">{last ? quest.text.complete : next?.brief || quest.text.progress || "There's more to do."}</p>
        {last ? (
          <p className="quest-reward">Reward: {rewardText(quest)}</p>
        ) : (
          next && (
            <>
              <h4>Next</h4>
              <Objectives quest={quest} from={view.step} />
            </>
          )
        )}
        <div className="mk-buttons">
          <Button isDefault onClick={onClose}>OK</Button>
        </div>
      </Window>
    );
  }

  const offer = offers.find((x) => x.id === quest.id);
  const state = offer?.state ?? QUEST_OFFER.OFFER;
  const active = store.active.find((a) => a.id === quest.id);
  const step = active?.step ?? offer?.step ?? 1;
  const current = quest.steps[step - 1];

  let story: string;
  if (state === QUEST_OFFER.OFFER || state === QUEST_OFFER.SOON) story = quest.text.offer;
  else if (state === QUEST_OFFER.READY) story = step >= quest.steps.length ? "Is it done?" : "You're back.";
  else story = quest.text.progress || current?.brief || "Come back when it's done.";

  const accept = () => {
    session.shardsCommand(`quest accept ${quest.id}`);
    onClose();
  };
  const handIn = () => {
    session.shardsCommand(`quest turnin ${quest.id}`);
    setView({ kind: "after", id: quest.id, step });
  };

  return (
    <Window title={quest.name} onClose={onClose} className="game-dialog quest-dialog">
      <p className="quest-band">
        {bandText(quest)}
        {quest.timeLimitMinutes ? `, ${timeLeftText(quest.timeLimitMinutes * 60)} to do it` : ""}
        {quest.repeatHours !== null ? ", can be done again" : ""}
      </p>
      <p className="quest-story">{story}</p>
      {state === QUEST_OFFER.SOON && <p className="quest-later">Come back when you have {quest.band.min} health.</p>}
      <h4>{state === QUEST_OFFER.OFFER || state === QUEST_OFFER.SOON ? "Objectives" : "Progress"}</h4>
      <Objectives quest={quest} step={active ? step : undefined} count={active?.count} />
      {(state === QUEST_OFFER.OFFER || state === QUEST_OFFER.SOON || (state === QUEST_OFFER.READY && step >= quest.steps.length)) && (
        <p className="quest-reward">Reward: {rewardText(quest)}</p>
      )}
      <div className="mk-buttons">
        {state === QUEST_OFFER.OFFER && (
          <Button isDefault onClick={accept}>
            Accept
          </Button>
        )}
        {state === QUEST_OFFER.READY && (
          <Button isDefault onClick={handIn}>
            {step >= quest.steps.length ? "Complete" : "Hand in"}
          </Button>
        )}
        {back && <Button onClick={back}>Back</Button>}
        <Button onClick={onClose}>{state === QUEST_OFFER.OFFER ? "Decline" : "Close"}</Button>
      </div>
    </Window>
  );
}
