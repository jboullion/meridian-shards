// Ours (docs/adr/0009-quests.md 3.3): the quest window, opened by what an NPC we talked to has for
// us (UC_QUEST_OFFERS, after activating them). Several quests are listed first. An offer shows
// the story, the band, the objectives with where they are, and the rewards, with Accept; a step
// ready to hand in shows Complete, then what comes next (or the reward). Everything is checked
// again by the server (util/questbook.kod); the text is the catalogue's (quests.ts).
// QuestInfoDialog is a quest's window away from its giver: a double click in the quest box or the
// Quests tab shows its story, who gave it, the progress and the reward, with Track and Abandon.

import { useEffect, useRef, useState } from "react";
import { bandText, objectiveLine, QUEST_OFFER, rewardsLine, rewardText, timeLeftText, type CatalogQuest, type CatalogStep, type GameSession, type QuestOffer } from "@shards/world";
import { useQuests, type QuestStore } from "../quests.ts";
import { Button, Check, ListBox, Window } from "./kit.tsx";

/** As the server's QUEST_REACH (4 squares), and a little: past it, the window closes */
const QUEST_REACH = 5 * 1024;

type View = { kind: "list" } | { kind: "quest"; id: number } | { kind: "after"; id: number; step: number };

/** The list's own state for a quest handed in from it and finished (not one of QUEST_OFFER's) */
const LIST_DONE = 0;

/** The list's mark before each quest: one to take, one to hand in, one under way (greyed), none for later, one done */
const STATE_LABEL: Record<number, string> = {
  [QUEST_OFFER.OFFER]: "!",
  [QUEST_OFFER.READY]: "?",
  [QUEST_OFFER.PENDING]: "?",
  [QUEST_OFFER.SOON]: "",
  [LIST_DONE]: "✓",
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
  npc, offers, store, session, onClose, service,
}: {
  npc: number;
  offers: QuestOffer[];
  store: QuestStore;
  session: GameSession;
  onClose: () => void;
  /** Ours (docs/adr/0012-cosmetics.md): the NPC is also a tailor or barber; its window */
  service?: { label: string; open: () => void };
}) {
  const serviceButton = service ? <Button onClick={service.open}>{service.label}</Button> : null;
  const [view, setView] = useState<View>(offers.length === 1 ? { kind: "quest", id: offers[0]!.id } : { kind: "list" });
  const [picked, setPicked] = useState<number | null>(offers[0]?.id ?? null);
  /** Quests accepted or handed in from the list's own buttons; the log (UC_QUEST_LOG) says when the server did it */
  const [sent, setSent] = useState<ReadonlySet<number>>(new Set());
  useQuests(store);
  const underWay = (id: number) => store.active.some((a) => a.id === id);
  const activeStep = (id: number) => store.active.find((a) => a.id === id)?.step;
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
    // What's changed since the list came (the server sends no new list): an offer taken is under
    // way; a step handed in moves the quest on (under way) or finishes it
    const stateOf = (x: QuestOffer) => {
      if (x.state === QUEST_OFFER.OFFER && underWay(x.id)) return QUEST_OFFER.PENDING;
      if (x.state === QUEST_OFFER.READY && sent.has(x.id)) {
        const step = activeStep(x.id);
        if (step === undefined) return LIST_DONE;
        if (step > x.step) return QUEST_OFFER.PENDING;
      }
      return x.state;
    };
    const fromList = (command: "accept" | "turnin", id: number) => {
      session.shardsCommand(`quest ${command} ${id}`);
      setSent((t) => new Set(t).add(id));
    };
    // A row's button: Accept an offer, or hand in a step that's ready (Complete on the last)
    const rowButton = (x: QuestOffer, state: number) => {
      const steps = store.quest(x.id)?.steps.length ?? 0;
      const label = state === QUEST_OFFER.OFFER ? "Accept" : state === QUEST_OFFER.READY ? (x.step >= steps ? "Complete" : "Hand in") : null;
      if (!label) return null;
      return (
        <button
          type="button"
          className="mk-btn quest-offer-accept"
          disabled={sent.has(x.id)}
          // its own click: neither picking the row nor opening the quest
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => fromList(state === QUEST_OFFER.OFFER ? "accept" : "turnin", x.id)}
        >
          {label}
        </button>
      );
    };
    return (
      <Window title={npcName} onClose={onClose} className="game-dialog quest-dialog">
        <ListBox
          label="Quests"
          autoFocus
          className="quest-offers"
          selected={picked}
          onSelect={setPicked}
          onActivate={(id) => setView({ kind: "quest", id })}
          items={offers.map((x) => {
            const state = stateOf(x);
            const min = store.quest(x.id)?.band.min;
            return {
              key: x.id,
              className: state === QUEST_OFFER.SOON || state === QUEST_OFFER.PENDING || state === LIST_DONE ? "quest-later" : "",
              label: (
                <span className="quest-offer">
                  <span className="quest-offer-mark">{STATE_LABEL[state] ?? ""}</span>
                  <span className="quest-offer-name">
                    {nameOf(x.id)}
                    {state === QUEST_OFFER.SOON && <small> requires {min !== undefined ? `${min} health` : "more health"}</small>}
                  </span>
                  {rowButton(x, state)}
                </span>
              ),
            };
          })}
        />
        <div className="mk-buttons">
          <Button isDefault disabled={picked === null} onClick={() => picked !== null && setView({ kind: "quest", id: picked })}>
            Open
          </Button>
          {serviceButton}
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
  const state = offer?.state === QUEST_OFFER.OFFER && underWay(quest.id) ? QUEST_OFFER.PENDING : (offer?.state ?? QUEST_OFFER.OFFER);
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
        {serviceButton}
        <Button onClick={onClose}>{state === QUEST_OFFER.OFFER ? "Decline" : "Close"}</Button>
      </div>
    </Window>
  );
}

/** A quest's details away from its giver (the quest box, the Quests tab): to read, with Track and Abandon */
export function QuestInfoDialog({ id, store, session, onClose }: { id: number; store: QuestStore; session: GameSession; onClose: () => void }) {
  useQuests(store);
  const quest = store.quest(id);
  const active = store.active.find((a) => a.id === id);
  const left = active ? store.secondsLeft(active) : -1;
  // Its countdown, every second
  const [, tick] = useState(0);
  const timed = left >= 0;
  useEffect(() => {
    if (!timed) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [timed]);
  if (!quest) {
    return (
      <Window title="Quest" onClose={onClose} className="game-dialog quest-dialog">
        <p>{store.stale ? "Your game data is out of date: reload the page to see this quest." : "This quest isn't in your game data yet."}</p>
        <div className="mk-buttons">
          <Button isDefault onClick={onClose}>Close</Button>
        </div>
      </Window>
    );
  }
  const step = active?.step;
  const current = step !== undefined ? quest.steps[step - 1] : undefined;
  const done = store.done.find((d) => d.id === id);
  const where = quest.giver.rooms.map((r) => r.name).join(" or ");
  return (
    <Window title={quest.name} onClose={onClose} className="game-dialog quest-dialog quest-info">
      <p className="quest-band">
        {bandText(quest)}
        {quest.repeatHours !== null ? ", can be done again" : ""}
        {!active && done ? `, done${done.times > 1 ? ` ${done.times} times` : ""}` : ""}
      </p>
      <p className="quest-giver">
        Given by {quest.giver.name}
        {where ? `, ${where}` : ""}
      </p>
      <p className="quest-story">{quest.text.offer}</p>
      {current?.brief && <p className="quest-story">{current.brief}</p>}
      <h4>{active ? "Progress" : "Objectives"}</h4>
      <Objectives quest={quest} step={step} count={active?.count} />
      {timed && <p className="quest-time">Time left: {timeLeftText(left)}</p>}
      <p className="quest-reward">Reward: {rewardText(quest)}</p>
      <div className="mk-buttons">
        {active && <Check label="Track" title="Show its way on the map, and first in the quest box (up to three)" checked={store.isTracked(id)} onChange={(v) => store.setTracked(id, v)} />}
        {active && (
          <Button
            onClick={() => {
              if (!window.confirm(`Abandon ${quest.name}? You can take it on again from the start.`)) return;
              session.shardsCommand(`quest abandon ${id}`);
              onClose();
            }}
          >
            Abandon
          </Button>
        )}
        <Button isDefault onClick={onClose}>
          Close
        </Button>
      </div>
    </Window>
  );
}
