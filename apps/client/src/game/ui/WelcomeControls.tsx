// Ours: the first controls, shown once on entering the game for the first time on the desktop
// (settings.seenControls): moving and opening doors, the inventory, the left click and the right drag, drawn like
// the Help window's keyboard and mouse (HelpDialog.tsx) but small. The keys are the player's own
// bindings; F1 (Help) has the rest.

import type { ReactNode } from "react";
import { bindingLabel, type Action, type Settings } from "../settings.ts";
import { Button, Window } from "./kit.tsx";

/** The Help window's colours: Movement's keys, Interface's, the mouse's highlight */
const MOVE = "#4f9fe8";
const PANEL = "#b07ae0";

const KEY = 34;

/** A key's cap: the first key bound to the action, or "?" with none */
function keyName(settings: Settings, a: Action): string {
  const b = settings.keys[a][0];
  return b ? bindingLabel(b) : "?";
}

/** One key cap, its top-left corner at (x, y) */
function Cap({ x, y, label, color, w = KEY }: { x: number; y: number; label: string; color: string; w?: number }) {
  return (
    <g className="wc-key">
      <rect x={x} y={y} width={w} height={KEY} rx={5} fill={color} />
      <rect x={x + 1} y={y + 1} width={w - 2} height={KEY - 5} rx={4} className="wc-key-top" />
      <text x={x + w / 2} y={y + (KEY - 4) / 2 + 1} style={{ fontSize: label.length > 2 ? 9 : 15 }}>
        {label}
      </text>
    </g>
  );
}

/** The mouse, one button lit; `drag` adds arrows for holding and dragging */
function Mouse({ lit, drag = false }: { lit: "left" | "right"; drag?: boolean }) {
  return (
    <svg viewBox="0 0 80 84" className="wc-figure" aria-hidden>
      <path className="mouse-body" d="M40 6 C22 6 14 20 14 38 V58 C14 72 25 80 40 80 C55 80 66 72 66 58 V38 C66 20 58 6 40 6 Z" />
      <path className={lit === "left" ? "mouse-button wc-lit" : "mouse-button"} d="M38.5 7.5 C24 8.5 15.5 20 15.5 36 V40 H38.5 Z" />
      <path className={lit === "right" ? "mouse-button wc-lit" : "mouse-button"} d="M41.5 7.5 C56 8.5 64.5 20 64.5 36 V40 H41.5 Z" />
      <rect className="mouse-wheel" x="36.5" y="15" width="7" height="15" rx="3.5" />
      {drag && (
        <g className="wc-arrows">
          <path d="M2 44 H12 M2 44 l4 -4 M2 44 l4 4" />
          <path d="M78 44 H68 M78 44 l-4 -4 M78 44 l-4 4" />
        </g>
      )}
    </svg>
  );
}

function Item({ figure, title, children }: { figure: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="wc-item">
      {figure}
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function WelcomeControls({ settings, onHelp, onClose }: { settings: Settings; onHelp: () => void; onClose: () => void }) {
  const w = keyName(settings, "forward"),
    a = keyName(settings, "strafeLeft"),
    s = keyName(settings, "backward"),
    d = keyName(settings, "strafeRight");
  const step = KEY + 4;
  return (
    // Over everything (the character window too), as Help is, till it's put away
    <div className="mk-modal welcome-modal">
      <Window title="Controls" onClose={onClose} className="welcome-controls">
        <div className="wc-grid">
          <Item
            title="Move"
            figure={
              <svg viewBox={`0 0 ${3 * step} ${3 * step}`} className="wc-figure wc-keys wc-move" aria-hidden>
                <Cap x={step} y={0} label={w} color={MOVE} />
                <Cap x={0} y={step} label={a} color={MOVE} />
                <Cap x={step} y={step} label={s} color={MOVE} />
                <Cap x={2 * step} y={step} label={d} color={MOVE} />
                <Cap x={0} y={2 * step} label={keyName(settings, "go")} color={MOVE} w={3 * step - 4} />
              </svg>
            }
          >
            Forward, left, back and right. Hold Shift to run. {keyName(settings, "go")} opens a door in front of you.
          </Item>
          <Item
            title="Inventory"
            figure={
              <svg viewBox={`0 0 ${3 * step} ${2 * step}`} className="wc-figure wc-keys" aria-hidden>
                <Cap x={step} y={step / 2} label={keyName(settings, "inventory")} color={PANEL} />
              </svg>
            }
          >
            Your things, what you wear, your spells and skills.
          </Item>
          <Item title="Left click: interact" figure={<Mouse lit="left" />}>
            Click someone to target them; double-click to use, open or talk.
          </Item>
          <Item title="Right click: camera" figure={<Mouse lit="right" drag />}>
            Hold the right button and drag to turn the view. A right click looks at something.
          </Item>
        </div>
        <p className="wc-note">Press F1 at any time for every control and the rest of the interface.</p>
        <div className="mk-buttons">
          <Button onClick={onHelp}>All controls…</Button>
          <Button isDefault onClick={onClose}>
            Got it
          </Button>
        </div>
      </Window>
    </div>
  );
}
