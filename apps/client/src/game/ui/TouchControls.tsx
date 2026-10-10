// The phone layout's controls over the view (ours, ADR 0003; on a touch screen, settings.ts touchUi):
//   - health, mana and vigor bars at the top left, our enchantments and the last few chat lines
//     under them
//   - Rest/Stand, Map, Chat and the interface drawer (inventory, spells...) at the top right, the
//     room's enchantments under them
//   - a joystick at the bottom left: forward, back and sliding, digital like the keys (move.c),
//     running when pushed to the edge; with the map open it moves by the map's directions
//   - Attack (held, it keeps attacking; it shows the weapon we wield), Open, Get, Cast (the quick
//     slots' wheel, QuickSlots.tsx, showing the last slot used) and Target (Target Next) at the
//     bottom right
// Turning and looking up or down is a drag on the view, tap targets, double tap activates and a
// long press examines (gameScene.ts, onPointerDown...).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ChatLine, GameSession } from "@shards/world";
import type { TouchMove } from "../gameScene.ts";
import type { IconRenderer } from "../icons.ts";
import type { Action, Settings } from "../settings.ts";
import { HudBars, HudEnchantments, ObjIcon } from "./Sidebar.tsx";
import { useWorld } from "./hooks.ts";
import { QuickWheel } from "./QuickSlots.tsx";
import type { QuickSlots } from "../quickSlots.ts";
import type { Cooldown } from "../cooldowns.ts";
import { wieldedWeapon } from "../equipment.ts";

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
  { action: "targetNext", label: "Target" },
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
  action, label, big, repeat, onPress, children,
}: {
  action: Action;
  label: string;
  big?: boolean;
  repeat?: boolean;
  onPress: (a: Action) => void;
  /** Drawn instead of the label (it stays the button's name) */
  children?: ReactNode;
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
      aria-label={label}
    >
      {children ?? label}
    </button>
  );
}

/** The Attack button's face: the weapon we wield over the word, or just the word bare handed. */
function AttackFace({ session, icons }: { session: GameSession; icons: IconRenderer }) {
  useWorld(session.world, ["playerOverlays", "inUse", "inventory"]);
  const weapon = wieldedWeapon(session.world);
  if (!weapon) return <>Attack</>;
  return (
    <span className="attack-face">
      <ObjIcon icons={icons} object={weapon} className="attack-weapon" />
      <span>Attack</span>
    </span>
  );
}

/**
 * How bright the ticker's colours are at least: relative luminance (WCAG, 0-1), so a blue gets
 * as light as a red to the eye, not only by HSL lightness. It's over the 3D view.
 */
const TICKER_LUMINANCE = 0.5;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r: number, g: number, b: number) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** HSL (h in degrees, s and l 0-1) to RGB (0-1) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/**
 * A server text colour (rgb(), as text.ts and session.ts give them) lifted for the ticker: the
 * same hue, made lighter until it's TICKER_LUMINANCE bright. The chat window keeps the originals.
 */
export function tickerColor(color: string | undefined): string | undefined {
  const m = color && /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255);
  if (luminance(r, g, b) >= TICKER_LUMINANCE) return color;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  while (l < 1 && luminance(...hslToRgb(h, s, l)) < TICKER_LUMINANCE) l += 0.01;
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(Math.min(1, l) * 100)}%)`;
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
            <span key={j} style={colored ? { color: tickerColor(s.color), fontWeight: s.bold ? "bold" : undefined } : undefined}>
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
  quickSlots, lastSlot, onUseSlot, onEditSlot, selecting, onSelectSelf, onCancelSelect, cooldown,
}: {
  /** The spell cooldown (cooldowns.ts), on the Cast button and its ring */
  cooldown: Cooldown | null;
  quickSlots: QuickSlots;
  /** The quick slot used last: a tap on Cast uses it again */
  lastSlot: number | null;
  onUseSlot: (i: number) => void;
  onEditSlot: (i: number) => void;
  /** Picking a spell target: our bars pick us, and the hint can cancel */
  selecting: boolean;
  onSelectSelf: () => void;
  onCancelSelect: () => void;
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
        <HudBars session={session} icons={icons} onSelectSelf={selecting ? onSelectSelf : undefined} />
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
          <ActionButton key={b.action} action={b.action} label={b.label} big={b.big} repeat={b.repeat} onPress={onPress}>
            {b.action === "attack" ? <AttackFace session={session} icons={icons} /> : undefined}
          </ActionButton>
        ))}
        <QuickWheel session={session} icons={icons} slots={quickSlots} last={lastSlot} onUse={onUseSlot} onEdit={onEditSlot} cooldown={cooldown} />
      </div>
      {selecting && (
        <div className="touch-select-hint">
          <span>Tap a target, or your health bars for yourself</span>
          <button type="button" className="touch-button small close" onClick={onCancelSelect} aria-label="Cancel">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
