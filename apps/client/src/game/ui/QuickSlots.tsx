// The quick slots' faces (ours; quickSlots.ts holds the slots):
//   - Hotbar: the row of ten along the bottom of the view, on the desktop and the phone. A click
//     or tap, or the slot's key (Quick Slot 1-10: 1-9 and 0 by default), casts or uses it; an
//     empty slot, or a right click (a long press on the phone), opens the picker. Drop a spell
//     from the Spells list or an item from the inventory on a slot to fill it, or another slot
//     to swap them.
//   - QuickSlotPicker: a slot's spell or item, from the ones we know and carry.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { isNumberItem, type GameSession } from "@shards/world";
import type { ObjectInfo } from "@shards/protocol";
import { bareIcon, type Drawable, type IconRenderer } from "../icons.ts";
import { DRAG_ITEM, DRAG_SLOT, DRAG_SPELL, QUICK_SLOTS, slotFor, slotItem, slotSpell, type QuickSlot, type QuickSlots } from "../quickSlots.ts";
import { bindingLabel, type Action, type Settings } from "../settings.ts";
import { useWorld } from "./hooks.ts";
import type { Cooldown } from "../cooldowns.ts";
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

function SlotFace({ icons, view, cooldown }: { icons: IconRenderer; view: SlotView | null; cooldown?: Cooldown | null }) {
  if (!view) return null;
  return (
    <>
      <ObjIcon icons={icons} object={view.object} className={view.available ? "qs-icon" : "qs-icon unavailable"} />
      {view.count > 1 && <span className="qs-count">{view.count}</span>}
      {cooldown && view.slot.kind === "spell" && view.available && <CooldownMask cooldown={cooldown} />}
    </>
  );
}

/**
 * The cooldown over a spell's slot (ours, cooldowns.ts): a shadow that clears clockwise from the
 * top as the time runs out, and the seconds left. Redrawn each frame while it lasts.
 */
export function CooldownMask({ cooldown }: { cooldown: Cooldown }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const total = cooldown.end - cooldown.start;
  const left = now === 0 ? total : cooldown.end - now;
  if (left <= 0 || total <= 0) return null;
  const done = Math.max(0, Math.min(1, 1 - left / total)) * 360;
  return (
    <span className="qs-cooldown" style={{ "--cd-done": `${done}deg` } as CSSProperties} aria-hidden>
      {Math.ceil(left / 1000)}
    </span>
  );
}

const slotTitle = (view: SlotView | null, key: string) =>
  `${view ? view.slot.name + (view.available ? "" : view.slot.kind === "spell" ? " (not known)" : " (none carried)") : "Empty"}${key ? ` (${key})` : ""}`;

/** The phone's hotbar: holding a slot this long changes it (as a right click does), ms */
const SLOT_HOLD_MS = 500;

export function Hotbar({
  session, icons, slots, settings, onUse, onEdit, onSet, onSwap, cooldown, row = 0, touch = false,
}: {
  /** The phone's: no keys to show, no dragging, and a long press changes a slot */
  touch?: boolean;
  /** Which row of ten: 0 the first (keys 1-0), 1 the Modern interface's second (the numpad) */
  row?: number;
  /** Ours: the spell cooldown to show on spell slots (the Modern interface's) */
  cooldown?: Cooldown | null;
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
  // A long press (the phone): its slot, to change, and the tap after it isn't a use
  const hold = useRef<{ timer: number; fired: boolean } | null>(null);
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
  };
  useEffect(() => endHold, []);
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
    <div className={row ? "hotbar second" : "hotbar"} role="toolbar" aria-label={row ? "Quick slots, second row" : "Quick slots"}>
      {views.slice(row * QUICK_SLOTS, (row + 1) * QUICK_SLOTS).map((v, j) => {
        const i = row * QUICK_SLOTS + j;
        const bound = settings.keys[`quickSlot${i + 1}` as Action][0];
        const key = bound && !touch ? bindingLabel(bound) : "";
        return (
          <button
            key={i}
            type="button"
            className={`hotbar-slot${v ? "" : " empty"}${v?.inUse ? " in-use" : ""}`}
            title={settings.tooltips ? slotTitle(v, key) : undefined}
            aria-label={slotTitle(v, key)}
            draggable={!!v && !touch}
            onPointerDown={(e) => {
              if (!touch || e.pointerType === "mouse") return;
              endHold();
              const h = { timer: 0, fired: false };
              h.timer = window.setTimeout(() => {
                h.fired = true;
                onEdit(i);
              }, SLOT_HOLD_MS);
              hold.current = h;
            }}
            onPointerUp={endHold}
            // Ours (the spell revamp, V5): a spell's range ring shows about us while the mouse is on its slot
            onPointerEnter={(e) => {
              const id = v?.slot.kind === "spell" && v.available ? (v.object as { id?: number }).id : undefined;
              if (e.pointerType === "mouse" && typeof id === "number") session.pointAtSpell(id);
            }}
            onPointerLeave={() => {
              endHold();
              session.pointAtSpell(null);
            }}
            onPointerCancel={endHold}
            onDragStart={(e) => e.dataTransfer.setData(DRAG_SLOT, String(i))}
            onDragOver={(e) => accepts(e) && e.preventDefault()}
            onDrop={(e) => drop(i, e)}
            onClick={(e) => {
              // Don't leave the keyboard focus on the slot: the game's keys go on working
              e.currentTarget.blur();
              if (hold.current?.fired) {
                hold.current = null;
                return;
              }
              onUse(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              // The phone's long press does it (a long press can fire this too)
              if (!touch) onEdit(i);
            }}
          >
            <SlotFace icons={icons} view={v} cooldown={cooldown} />
            {key && <span className="qs-key">{key}</span>}
          </button>
        );
      })}
    </div>
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
        <span className="look-list-name">{session.itemName(o)}</span>
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
