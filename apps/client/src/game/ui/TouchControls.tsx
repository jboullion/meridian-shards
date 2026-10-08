// The phone layout's controls over the view (ours, ADR 0003; Touch Controls in the Bind Editor):
//   - health, mana and vigor bars at the top left, our enchantments and the last few chat lines
//     under them
//   - Map, Chat and the interface drawer (inventory, spells...) at the top right, the room's
//     enchantments under them
//   - a joystick at the bottom left: forward, back and sliding, digital like the keys (move.c),
//     running when pushed to the edge
//   - Attack, Open, Get, Look and Next Target at the bottom right, the actions of their keys
// Turning and looking up or down is a drag on the view, tap targets, double tap activates and a
// long press examines (gameScene.ts, onPointerDown...).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChatLine, GameSession } from "@shards/world";
import type { TouchMove } from "../gameScene.ts";
import type { IconRenderer } from "../icons.ts";
import type { Action, Settings } from "../settings.ts";
import { HudBars, HudEnchantments } from "./Sidebar.tsx";

/** The joystick's knob travel, px; past DEAD of it the move starts, past RUN it runs */
const RADIUS = 46;
const DEAD = 0.35;
const RUN = 0.85;
/** Chat lines stay over the view this long, ms */
const TICKER_MS = 8000;
const TICKER_LINES = 3;

const BUTTONS: { action: Action; label: string; big?: boolean }[] = [
  { action: "attack", label: "Attack", big: true },
  { action: "go", label: "Open" },
  { action: "interact", label: "Get" },
  { action: "lookAt", label: "Look" },
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
  session, icons, settings, chat, chatUnread, onMove, onPress, onChat, onDrawer, onMap, onLook,
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
  /** An enchantment tapped: its description */
  onLook: (id: number) => void;
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
        <button type="button" className="touch-button small" onClick={onMap}>
          Map
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
          <button
            key={b.action}
            type="button"
            className={`touch-button${b.big ? " big" : ""} ${b.action}`}
            // On press, not on release: an attack waits for no lifted finger
            onPointerDown={(e) => {
              e.preventDefault();
              onPress(b.action);
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
