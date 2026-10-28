// Ours (docs/adr/0009-quests.md 4.2): the Modern interface's quest box, on the right under the map
// by default. It lists the quests going, the tracked ones first (their names gold), each with its
// current objective and time left; a double click on one opens its window (QuestDialog.tsx
// QuestInfoDialog). Like the chat, it's a panel only while the pointer is over it: its title
// strip moves it (a double press puts it back), its left and bottom edges and the corner between
// them size it (settings questBoxAt, questBoxWidth, questBoxTall). It's zoomed by the HUD size:
// its place is in its parent's pixels, its size in its own.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { objectiveLine, timeLeftText } from "@shards/world";
import { SIGNET_QUEST_NAME, signetObjective, useQuests, type ActiveQuest, type QuestStore } from "../quests.ts";
import { DEFAULT_SETTINGS, updateSettings, type Settings } from "../settings.ts";

const MIN_WIDTH = 160;
const MIN_TALL = 60;
/** Unmoved: its top, under the map and the room's name (its own pixels) */
const BOX_TOP = 222;
/** How much of it stays in the view when it's dragged off an edge */
const KEEP_X = 80;
const KEEP_Y = 30;
/** A second press on the title strip within this puts it back */
const DOUBLE_MS = 400;

/**
 * One quest as the quest box and the Quests tab (QuestsPanel.tsx) draw it: its name (gold when
 * tracked, bronze for a signet ring), its time left, and one line under it. A double click (or
 * Enter, where it can take the focus) opens its window.
 */
export function QuestEntry({
  name, line, ready, time, tone = "plain", title, selected, aside, onOpen, onSelect,
}: {
  name: string;
  line?: ReactNode;
  /** The line is "Return to X": the quest's step is done */
  ready?: boolean;
  time?: string;
  tone?: "tracked" | "plain" | "bronze";
  title?: string;
  selected?: boolean;
  /** Something at its right, as the Quests tab's Track (clicks on it neither select nor open) */
  aside?: ReactNode;
  onOpen?: () => void;
  /** Given, a click selects it and it can take the focus */
  onSelect?: () => void;
}) {
  return (
    <div
      className={`quest-tracked${tone === "plain" ? "" : ` ${tone}`}${selected ? " selected" : ""}`}
      title={title}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !onOpen) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {aside && (
        <span className="quest-entry-aside" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {aside}
        </span>
      )}
      <b>{name}</b>
      {time && <small> {time}</small>}
      {line && <div className={ready ? "ready" : ""}>{line}</div>}
    </div>
  );
}

/** A quest going's line: its current step, or "Return to X" once the step's done */
export function currentStepLine(a: ActiveQuest): { line: string; ready: boolean } | null {
  const s = a.quest?.steps[a.step - 1];
  if (!s) return null;
  const ready = !s.auto && s.kind !== "talk" && s.kind !== "deliver" && a.count >= s.count;
  return { line: ready ? `Return to ${s.turnin.name}` : objectiveLine(s, a.count), ready };
}

/** Re-render every second while a quest has a time limit, for its countdown */
export function useTicking(on: boolean): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

/** Follows one pointer from its press until it's let go, on the element pressed */
function follow(e: ReactPointerEvent<HTMLElement>, move: (ev: PointerEvent) => void, done: () => void): void {
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    done();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

export function QuestBox({ store, settings, onOpen }: { store: QuestStore | null; settings: Settings; onOpen: (id: number) => void }) {
  useQuests(store);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastPress = useRef(0);
  /** While dragging: the place and size it's being given, kept on letting go */
  const [drag, setDrag] = useState<{ at: [number, number] | null; width: number; tall: number | null } | null>(null);
  const active = store?.activeQuests() ?? [];
  useTicking(active.some((a) => a.secondsLeft >= 0));
  if (!store || !(active.length || store.signets.length)) return null;
  // The tracked ones first, in the order they were taken on
  const quests = [...active.filter((a) => store.isTracked(a.id)), ...active.filter((a) => !store.isTracked(a.id))];

  const zoom = settings.hudScale / 100;
  const at = drag ? drag.at : settings.questBoxAt;
  const width = drag?.width ?? settings.questBoxWidth;
  const tall = drag ? drag.tall : settings.questBoxTall;
  const top = at ? `clamp(0px, ${at[1] / zoom}px, 100% - ${KEEP_Y}px)` : `${BOX_TOP}px`;
  const place: CSSProperties = {
    width: `${width}px`,
    ...(at ? { left: `clamp(${KEEP_X}px - ${width}px, ${at[0] / zoom}px, 100% - ${KEEP_X}px)`, right: "auto", top } : {}),
    ...(tall !== null ? { height: `${tall}px` } : {}),
    maxHeight: `calc(100% - ${top} - 10px)`,
  };

  const rects = () => {
    const box = boxRef.current;
    const parent = box?.offsetParent;
    return box && parent ? { g: parent.getBoundingClientRect(), c: box.getBoundingClientRect() } : null;
  };

  /** The title strip: moves it; a double press puts it back */
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = rects();
    if (!r || e.button !== 0) return;
    if (e.timeStamp - lastPress.current < DOUBLE_MS) {
      lastPress.current = 0;
      e.preventDefault();
      updateSettings({ questBoxAt: null, questBoxTall: null, questBoxWidth: DEFAULT_SETTINGS.questBoxWidth });
      return;
    }
    lastPress.current = e.timeStamp;
    const { g, c } = r;
    const grabX = e.clientX - c.left,
      grabY = e.clientY - c.top;
    let last: [number, number] | null = null;
    follow(
      e,
      (ev) => {
        last = [
          Math.round(Math.max(KEEP_X - c.width, Math.min(g.width - KEEP_X, ev.clientX - g.left - grabX))),
          Math.round(Math.max(0, Math.min(g.height - KEEP_Y, ev.clientY - g.top - grabY))),
        ];
        setDrag({ at: last, width, tall });
      },
      () => {
        setDrag(null);
        if (last) updateSettings({ questBoxAt: last });
      },
    );
  };

  /** Its left edge (wider or narrower, the right edge staying put), its bottom edge, or both */
  const resize = (e: ReactPointerEvent<HTMLDivElement>, across: boolean, down: boolean) => {
    const r = rects();
    if (!r) return;
    const { g, c } = r;
    let next = { at, width, tall };
    follow(
      e,
      (ev) => {
        next = { ...next };
        if (across) {
          next.width = Math.round(Math.max(MIN_WIDTH, Math.min(c.right - g.left, c.right - ev.clientX) / zoom));
          // Moved, its left is where it's placed: keep the right edge where it was
          if (at) next.at = [Math.round(c.right - g.left - next.width * zoom), at[1]];
        }
        if (down) next.tall = Math.round(Math.max(MIN_TALL, Math.min(g.bottom - 10 - c.top, ev.clientY - c.top) / zoom));
        setDrag(next);
      },
      () => {
        setDrag(null);
        updateSettings({ questBoxAt: next.at, questBoxWidth: next.width, questBoxTall: next.tall });
      },
    );
  };

  return (
    <div className={drag ? "quest-box dragging" : "quest-box"} ref={boxRef} style={place}>
      <div className="quest-box-title" onPointerDown={move} title="Drag to move the quests; double-click to put them back">
        Quests <small>{active.length + store.signets.length}</small>
      </div>
      <div className="quest-box-list">
        {quests.map((a) => {
          const left = store.secondsLeft(a);
          const step = currentStepLine(a);
          return (
            <QuestEntry
              key={a.id}
              name={a.quest?.name ?? `Quest ${a.id}`}
              line={step?.line}
              ready={step?.ready}
              time={left >= 0 ? timeLeftText(left) : undefined}
              tone={store.isTracked(a.id) ? "tracked" : "plain"}
              title="Double-click for the quest's details"
              onOpen={() => onOpen(a.id)}
            />
          );
        })}
        {/* Ours: signet rings we carry, bronze (UC_SIGNETS) */}
        {store.signets.map((r) => (
          <QuestEntry key={`signet-${r.id}`} name={SIGNET_QUEST_NAME} line={signetObjective(r)} tone="bronze" />
        ))}
      </div>
      <div className="quest-box-resize-left" onPointerDown={(e) => resize(e, true, false)} title="Drag to make the quests wider or narrower" aria-hidden />
      <div className="quest-box-resize-bottom" onPointerDown={(e) => resize(e, false, true)} title="Drag to make the quests taller or shorter" aria-hidden />
      <div className="quest-box-resize-corner" onPointerDown={(e) => resize(e, true, true)} title="Drag to resize the quests" aria-hidden />
    </div>
  );
}
