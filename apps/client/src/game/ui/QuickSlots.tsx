// The quick slots' faces (ours; quickSlots.ts holds the slots):
//   - Hotbar: the desktop's row of ten along the bottom of the view. A click or the slot's
//     key (Quick Slot 1-10: 1-9 and 0 by default) casts or uses it; an empty slot, or a right click,
//     opens the picker. Drop a spell from the Spells list or an item from the inventory on a
//     slot to fill it, or another slot to swap them.
//   - QuickWheel: the phone layout's Cast button. Hold it and the slots open in a ring in the
//     middle of the screen; slide (in that slot's direction, from where the finger went down)
//     toward one and let go to cast it (let go in the middle to cancel), or keep the finger on
//     one to change it. A tap casts the last slot again, whose icon the button shows (the first
//     time, it opens the ring to tap a slot instead).
//   - QuickSlotPicker: a slot's spell or item, from the ones we know and carry.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isNumberItem, type GameSession } from "@shards/world";
import type { ObjectInfo } from "@shards/protocol";
import { bareIcon, type Drawable, type IconRenderer } from "../icons.ts";
import { DRAG_ITEM, DRAG_SLOT, DRAG_SPELL, QUICK_SLOTS, slotFor, slotItem, slotSpell, type QuickSlot, type QuickSlots } from "../quickSlots.ts";
import { bindingLabel, type Action, type Settings } from "../settings.ts";
import { useWorld } from "./hooks.ts";
import { Button, Window } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

interface SlotView {
  slot: QuickSlot;
  /** What to draw: the spell or item it matches, else its saved icon */
  object: Drawable;
  /** Something matches: a spell we know, an item we carry */
  available: boolean;
  inUse: boolean;
  /** How many matching items we carry */
  count: number;
}

/** Each slot as it stands now, redrawn when spells, the inventory or what's in use change. */
function useSlotViews(session: GameSession, slots: QuickSlots): (SlotView | null)[] {
  const world = session.world;
  useWorld(world, ["spells", "inventory", "inUse"]);
  const rs = (id: number) => session.resource(id) ?? "";
  return slots.map((slot) => {
    if (!slot) return null;
    if (slot.kind === "spell") {
      const s = slotSpell(slot, world.spells, rs);
      return { slot, object: s?.object ?? bareIcon(slot.icon), available: !!s, inUse: false, count: 0 };
    }
    const o = slotItem(slot, world.inventory.values(), world.inUse, rs);
    const count = o ? [...world.inventory.values()].filter((x) => x.nameRes === o.nameRes).length : 0;
    return { slot, object: o ?? bareIcon(slot.icon), available: !!o, inUse: !!o && world.inUse.has(o.id), count };
  });
}

function SlotFace({ icons, view }: { icons: IconRenderer; view: SlotView | null }) {
  if (!view) return null;
  return (
    <>
      <ObjIcon icons={icons} object={view.object} className={view.available ? "qs-icon" : "qs-icon unavailable"} />
      {view.count > 1 && <span className="qs-count">{view.count}</span>}
    </>
  );
}

const slotTitle = (view: SlotView | null, key: string) =>
  `${view ? view.slot.name + (view.available ? "" : view.slot.kind === "spell" ? " (not known)" : " (none carried)") : "Empty"}${key ? ` (${key})` : ""}`;

export function Hotbar({
  session, icons, slots, settings, onUse, onEdit, onSet, onSwap,
}: {
  session: GameSession;
  icons: IconRenderer;
  slots: QuickSlots;
  /** The slots' keys for their labels, and Show tooltips */
  settings: Settings;
  onUse: (i: number) => void;
  onEdit: (i: number) => void;
  onSet: (i: number, slot: QuickSlot) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const world = session.world;
  const views = useSlotViews(session, slots);
  const rs = (id: number) => session.resource(id) ?? "";
  const accepts = (e: DragEvent) => [DRAG_ITEM, DRAG_SPELL, DRAG_SLOT].some((t) => e.dataTransfer.types.includes(t));
  const drop = (i: number, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const item = e.dataTransfer.getData(DRAG_ITEM);
    const spell = e.dataTransfer.getData(DRAG_SPELL);
    const from = e.dataTransfer.getData(DRAG_SLOT);
    if (from !== "") return onSwap(Number(from), i);
    const o = item ? world.inventory.get(Number(item)) : undefined;
    if (o) return onSet(i, slotFor("item", o, rs(o.nameRes)));
    const s = spell ? world.spells.find((x) => x.object.id === Number(spell)) : undefined;
    if (s) onSet(i, slotFor("spell", s.object, rs(s.object.nameRes)));
  };
  return (
    <div className="hotbar" role="toolbar" aria-label="Quick slots">
      {views.map((v, i) => {
        const bound = settings.keys[`quickSlot${i + 1}` as Action][0];
        const key = bound ? bindingLabel(bound) : "";
        return (
          <button
            key={i}
            type="button"
            className={`hotbar-slot${v ? "" : " empty"}${v?.inUse ? " in-use" : ""}`}
            title={settings.tooltips ? slotTitle(v, key) : undefined}
            aria-label={slotTitle(v, key)}
            draggable={!!v}
            onDragStart={(e) => e.dataTransfer.setData(DRAG_SLOT, String(i))}
            onDragOver={(e) => accepts(e) && e.preventDefault()}
            onDrop={(e) => drop(i, e)}
            onClick={(e) => {
              // Don't leave the keyboard focus on the slot: the game's keys go on working
              e.currentTarget.blur();
              onUse(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onEdit(i);
            }}
          >
            <SlotFace icons={icons} view={v} />
            {key && <span className="qs-key">{key}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The ring's radius and the dead zone in its middle, px */
const RING = 112;
const DEAD = 28;
/** A press longer than this (or a slide) opens the ring; resting on a slot this long changes it, ms */
const HOLD_MS = 180;
const EDIT_MS = 700;

/** The slot a slide from the press points at: 0 straight up, then clockwise. */
function slotAt(dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < DEAD) return null;
  const a = Math.atan2(dx, -dy);
  return (((Math.round(a / ((2 * Math.PI) / QUICK_SLOTS)) % QUICK_SLOTS) + QUICK_SLOTS) % QUICK_SLOTS);
}

const ringPos = (i: number) => {
  const a = (i * 2 * Math.PI) / QUICK_SLOTS;
  return { transform: `translate(${Math.round(Math.sin(a) * RING)}px, ${Math.round(-Math.cos(a) * RING)}px)` };
};

export function QuickWheel({
  session, icons, slots, last, onUse, onEdit,
}: {
  session: GameSession;
  icons: IconRenderer;
  slots: QuickSlots;
  /** The slot used last, which a tap casts again */
  last: number | null;
  onUse: (i: number) => void;
  onEdit: (i: number) => void;
}) {
  const views = useSlotViews(session, slots);
  const lastView = last !== null ? views[last] : null;
  // "hold": the finger is down and slides to a slot; "tap": opened by a tap, slots are tapped
  const [open, setOpen] = useState<"hold" | "tap" | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const press = useRef<{ id: number; x: number; y: number; open: boolean; hot: number | null; done: boolean } | null>(null);
  const timers = useRef({ open: 0, edit: 0 });
  const clear = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.edit);
  };
  useEffect(() => clear, []);
  const close = () => {
    clear();
    press.current = null;
    setOpen(null);
    setHot(null);
  };
  const openHold = () => {
    const p = press.current;
    if (!p || p.open) return;
    p.open = true;
    setOpen("hold");
  };
  const aim = (i: number | null) => {
    const p = press.current;
    if (!p || p.hot === i) return;
    p.hot = i;
    setHot(i);
    clearTimeout(timers.current.edit);
    if (i === null) return;
    // Resting on a slot: change it instead
    timers.current.edit = window.setTimeout(() => {
      if (press.current) press.current.done = true;
      setOpen(null);
      setHot(null);
      onEdit(i);
    }, EDIT_MS);
  };

  const down = (e: ReactPointerEvent) => {
    e.preventDefault();
    if (open === "tap") return close();
    if (press.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, open: false, hot: null, done: false };
    timers.current.open = window.setTimeout(openHold, HOLD_MS);
  };
  const move = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.done) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (!p.open && Math.hypot(dx, dy) > 12) openHold();
    if (p.open) aim(slotAt(dx, dy));
  };
  const up = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const { open: wasOpen, hot: i, done } = p;
    close();
    if (done) return;
    if (wasOpen) {
      if (i !== null) onUse(i);
      return;
    }
    // A tap: the last slot again, or the ring to tap one
    if (last !== null && slots[last]) onUse(last);
    else setOpen("tap");
  };

  return (
    <>
      <button
        type="button"
        className={`touch-button cast${open ? " pressed" : ""}${lastView ? " has-last" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={close}
        aria-label="Cast: tap for the last quick slot, hold and slide for the others"
      >
        {/* The last slot used, which a tap uses again */}
        {lastView ? <ObjIcon icons={icons} object={lastView.object} className={lastView.available ? "qs-icon" : "qs-icon unavailable"} /> : "Cast"}
      </button>
      {open && (
        <div
          className={`quick-wheel ${open}`}
          // The tap ring: a tap on its backdrop, between the slots, closes it
          onPointerDown={(e) => {
            if (open !== "tap" || e.target !== e.currentTarget) return;
            e.preventDefault();
            close();
          }}
        >
          {views.map((v, i) => (
            <SlotButton
              key={i}
              className={`quick-wheel-slot${hot === i ? " hot" : ""}${v ? "" : " empty"}${v?.inUse ? " in-use" : ""}`}
              style={ringPos(i)}
              label={slotTitle(v, "")}
              tappable={open === "tap"}
              onTap={() => {
                close();
                onUse(i);
              }}
              onLongPress={() => {
                close();
                onEdit(i);
              }}
            >
              <SlotFace icons={icons} view={v} />
            </SlotButton>
          ))}
          <div className="quick-wheel-name">
            {hot !== null ? (views[hot]?.slot.name ?? "Empty: let go to choose") : open === "hold" ? "Slide to a slot" : "Tap a slot"}
          </div>
          {open === "tap" && (
            <button type="button" className="quick-wheel-close" aria-label="Close" onPointerDown={(e) => {
                e.preventDefault();
                close();
              }}>
              ✕
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** A ring slot: in the tap ring, a tap uses it and a long press changes it. */
function SlotButton({
  className, style, label, tappable, onTap, onLongPress, children,
}: {
  className: string;
  style: CSSProperties;
  label: string;
  tappable: boolean;
  onTap: () => void;
  onLongPress: () => void;
  children: ReactNode;
}) {
  const timer = useRef(0);
  const long = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      style={{ ...style, pointerEvents: tappable ? "auto" : "none" }}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        long.current = false;
        timer.current = window.setTimeout(() => {
          long.current = true;
          onLongPress();
        }, EDIT_MS);
      }}
      onPointerUp={() => {
        clearTimeout(timer.current);
        if (!long.current) onTap();
      }}
      onPointerCancel={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** Choose a slot's spell or item (or empty it): the spells we know, then the items we carry. */
export function QuickSlotPicker({
  session, icons, index, current, onPick, onClose,
}: {
  session: GameSession;
  icons: IconRenderer;
  index: number;
  current: QuickSlot | null;
  onPick: (slot: QuickSlot | null) => void;
  onClose: () => void;
}) {
  const world = session.world;
  useWorld(world, ["spells", "inventory"]);
  const rs = (id: number) => session.resource(id) ?? "";
  const spells = [...world.spells].sort((a, b) => rs(a.object.nameRes).localeCompare(rs(b.object.nameRes)));
  // One row per kind of item (five potions are one choice), number items (shillings) left out
  const items: ObjectInfo[] = [];
  for (const o of world.inventory.values()) if (!isNumberItem(o.id) && !items.some((x) => x.nameRes === o.nameRes)) items.push(o);
  const pick = (kind: QuickSlot["kind"], o: ObjectInfo) => {
    onPick(slotFor(kind, o, rs(o.nameRes)));
    onClose();
  };
  const row = (kind: QuickSlot["kind"], o: ObjectInfo) => {
    const chosen = current?.kind === kind && current.nameRes === o.nameRes;
    return (
      <li key={`${kind}:${o.id}`} role="option" aria-selected={chosen} className={chosen ? "selected" : ""} onClick={() => pick(kind, o)}>
        <ObjIcon icons={icons} object={o} className="pick-icon" />
        <span className="look-list-name">{rs(o.nameRes)}</span>
      </li>
    );
  };
  return (
    <div className="mk-modal look-modal">
      <Window title={`Quick Slot ${index + 1}`} onClose={onClose} className="quick-slot-picker">
        <div className="mk-text">Choose what this slot casts or uses:</div>
        <span className="mk-edit list">
          <ul className="mk-list look-list" role="listbox" aria-label="Spells and items">
            {spells.length > 0 && <li className="quick-slot-heading">Spells</li>}
            {spells.map((s) => row("spell", s.object))}
            {items.length > 0 && <li className="quick-slot-heading">Items</li>}
            {items.map((o) => row("item", o))}
            {!spells.length && !items.length && <li className="muted">No spells or items yet</li>}
          </ul>
        </span>
        <div className="quick-slot-buttons">
          {current && (
            <Button
              onClick={() => {
                onPick(null);
                onClose();
              }}
            >
              Clear slot
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </Window>
    </div>
  );
}
