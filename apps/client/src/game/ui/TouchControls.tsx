// The phone layout's controls over the view (ours, ADR 0003; Touch Controls in the Bind Editor):
//   - health, mana and vigor bars at the top left, our enchantments and the last few chat lines
//     under them
//   - Rest/Stand, Map, Chat and the interface drawer (inventory, spells...) at the top right, the
//     room's enchantments under them
//   - a joystick at the bottom left: forward, back and sliding, digital like the keys (move.c),
//     running when pushed to the edge; with the map open it moves by the map's directions
//   - Attack (held, it keeps attacking), Open, Get and Next Target at the bottom right
// Turning and looking up or down is a drag on the view, tap targets, double tap activates and a
// long press examines (gameScene.ts, onPointerDown...).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChatLine, GameSession } from "@shards/world";
import type { TouchMove } from "../gameScene.ts";
import type { IconRenderer } from "../icons.ts";
import type { Action, Settings } from "../settings.ts";
import { HudBars, HudEnchantments } from "./Sidebar.tsx";

/** The joystick's knob travel, px; past DEAD of it the move starts, past RUN it runs */
const RADIUS = 37;
const DEAD = 0.35;
const RUN = 0.85;
/** Chat lines stay over the view this long, ms */
const TICKER_MS = 8000;
const TICKER_LINES = 3;

/** A held button with `repeat` acts again this often; the game rate-limits attacks itself (gameuser.c: one per 250 ms) */
const REPEAT_MS = 100;

const BUTTONS: { action: Action; label: string; big?: boolean; repeat?: boolean }[] = [
  // Held, it keeps attacking, as a held attack key does
  { action: "attack", label: "Attack", big: true, repeat: true },
  { action: "go", label: "Open" },
  { action: "interact", label: "Get" },
  { action: "targetNext", label: "Next" },
];

const NO_MOVE: TouchMove = { forward: 0, strafe: 0, run: false };

function Joystick({ onMove }: { onMove: (m: TouchMove) => void }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const finger = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const last = useRef<TouchMove>(NO_MOVE);
  const send = (m: TouchMove) => {
    const l = last.current;
    if (l.forward === m.forward && l.strafe === m.strafe && l.run === m.run) return;
    last.current = m;
    onMove(m);
  };
  const update = (e: ReactPointerEvent) => {
    const f = finger.current;
    if (!f || e.pointerId !== f.id) return;
    let dx = e.clientX - f.cx,
      dy = e.clientY - f.cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx * RADIUS) / d;
      dy = (dy * RADIUS) / d;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / RADIUS,
      ny = dy / RADIUS;
    send({
      forward: ny < -DEAD ? 1 : ny > DEAD ? -1 : 0,
      strafe: nx > DEAD ? 1 : nx < -DEAD ? -1 : 0,
      run: Math.min(1, d / RADIUS) >= RUN,
    });
  };
  const end = (e: ReactPointerEvent) => {
    if (finger.current?.id !== e.pointerId) return;
    finger.current = null;
    setKnob(null);
    send(NO_MOVE);
  };
  // Stop moving if the controls go away mid-push
  useEffect(() => () => onMove(NO_MOVE), [onMove]);
  return (
    <div
      className="touch-stick"
      onPointerDown={(e) => {
        if (finger.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        finger.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        update(e);
      }}
      onPointerMove={update}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Move"
    >
      <div className="touch-knob" style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined} />
    </div>
  );
}

/**
 * An action on press, not on release (an attack waits for no lifted finger). With `repeat` it
 * goes on while the finger stays down.
 */
function ActionButton({
  action, label, big, repeat, onPress,
}: {
  action: Action;
  label: string;
  big?: boolean;
  repeat?: boolean;
  onPress: (a: Action) => void;
}) {
  const timer = useRef(0);
  const stop = () => {
    clearInterval(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`touch-button${big ? " big" : ""} ${action}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress(action);
        if (!repeat) return;
        // The finger's up and cancel come here even if it slides off the button
        e.currentTarget.setPointerCapture(e.pointerId);
        stop();
        timer.current = window.setInterval(() => onPress(action), REPEAT_MS);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      {label}
    </button>
  );
}

/** The last few chat lines, for a few seconds, while the chat is put away. */
function ChatTicker({ chat, colored }: { chat: ChatLine[]; colored: boolean }) {
  // A clock ticking once a second; a line newer than it shows until it's TICKER_MS old
  const [now, setNow] = useState(() => Date.now());
  const recent = chat.slice(-TICKER_LINES).filter((l) => now - l.time < TICKER_MS);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!recent.length) return null;
  return (
    <div className="touch-ticker" aria-hidden>
      {recent.map((l, i) => (
        <div key={`${l.time}-${i}`} className="touch-ticker-line">
          {l.spans.map((s, j) => (
            <span key={j} style={colored ? { color: s.color, fontWeight: s.bold ? "bold" : undefined } : undefined}>
              {s.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function TouchControls({
  session, icons, settings, chat, chatUnread, onMove, onPress, onChat, onDrawer, onMap, mapOpen, onLook, resting, onRest,
}: {
  session: GameSession;
  icons: IconRenderer;
  settings: Settings;
  chat: ChatLine[];
  /** New lines since the chat was last open */
  chatUnread: boolean;
  onMove: (m: TouchMove) => void;
  onPress: (a: Action) => void;
  onChat: () => void;
  onDrawer: () => void;
  onMap: () => void;
  /** The map is over the view: its button closes it */
  mapOpen: boolean;
  /** An enchantment tapped: its description */
  onLook: (id: number) => void;
  /** command.c pinfo.resting, for the Rest / Stand button (the toolbar's rest.bmp) */
  resting: boolean;
  onRest: () => void;
}) {
  return (
    <div className="touch-controls">
      <div className="touch-hud">
        <HudBars session={session} icons={icons} />
        <HudEnchantments session={session} icons={icons} kind="player" onLook={onLook} />
        <ChatTicker chat={chat} colored={settings.coloredText} />
      </div>
      <HudEnchantments session={session} icons={icons} kind="room" onLook={onLook} />
      <div className="touch-top-buttons">
        {/* The toolbar's Rest/Stand (mermain.c default_buttons): typed "rest" or "stand" */}
        <button type="button" className={`touch-button small${resting ? " pressed" : ""}`} onClick={onRest}>
          {resting ? "Stand" : "Rest"}
        </button>
        <button type="button" className={`touch-button small${mapOpen ? " close" : ""}`} onClick={onMap} aria-label={mapOpen ? "Close the map" : "Map"}>
          {mapOpen ? "✕" : "Map"}
        </button>
        <button type="button" className={`touch-button small${chatUnread ? " unread" : ""}`} onClick={onChat}>
          Chat
        </button>
        <button type="button" className="touch-button small" onClick={onDrawer} aria-label="Inventory, spells and map">
          Items
        </button>
      </div>
      <Joystick onMove={onMove} />
      <div className="touch-actions">
        {BUTTONS.map((b) => (
          <ActionButton key={b.action} action={b.action} label={b.label} big={b.big} repeat={b.repeat} onPress={onPress} />
        ))}
      </div>
    </div>
  );
}
