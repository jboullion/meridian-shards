// The Modern interface's character window (ours; the Inventory key, I): the original's five
// stat groups as tabs (stats.c, statbtn.c), in a stone window like the UE remaster's inventory
// (its ADR 0009). On the Inventory tab, the paper doll: our figure between the boxes for what we
// wear (equipment.ts, by itemslots.json), what we wield, our weight and bulk (the Stats group's
// "Weight Carried" and "Bulk Carried", user.kod), and the bag under them. The window isn't modal:
// the game keeps its keys while it's open. Drag its title to move it (kept in the settings);
// double click the title to put it back beside the map.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { STAT_GROUP, type ObjectInfo } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import { EQUIP_COLUMNS, layoutEquipment, wieldedWeapon, wornSlot, type EquipKey } from "../equipment.ts";
import type { IconRenderer } from "../icons.ts";
import { DRAG_ITEM } from "../quickSlots.ts";
import { updateSettings, type Settings } from "../settings.ts";
import { useWorld } from "./hooks.ts";
import { Window } from "./kit.tsx";
import { Inventory, NumericStats, ObjIcon, StatBar, StatList, StatTab, TABS, type Tab } from "./Sidebar.tsx";

/** How much of the window stays in the view however it's dragged or the window shrinks: its title, px */
const KEEP_X = 120;
const KEEP_Y = 52;
/** Two presses on the title this close together put the window back, ms */
const DOUBLE_MS = 400;
/** Below the window, room left in the view (as at its own place), px */
const BOTTOM_GAP = 10;

/** The bag's columns, and the boxes it shows at least (empty ones sunk in) */
const BAG_COLUMNS = 9;
const BAG_MIN_CELLS = BAG_COLUMNS * 4;

function EquipBox({
  session, icons, label, object, tooltips, onLook,
}: {
  session: GameSession;
  icons: IconRenderer;
  label: string;
  object: ObjectInfo | undefined;
  tooltips: boolean;
  onLook: (o: ObjectInfo) => void;
}) {
  const world = session.world;
  const name = object ? (session.resource(object.nameRes) ?? "") : "";
  return (
    <div
      className={object ? "equip-box filled" : "equip-box"}
      title={tooltips ? (object ? `${label}: ${name}` : label) : undefined}
      aria-label={object ? `${label}: ${name}` : label}
      draggable={!!object}
      // Out to the bag takes it off; onto a quick slot puts it there
      onDragStart={(e) => {
        if (!object) return;
        e.dataTransfer.setData(DRAG_ITEM, String(object.id));
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      // An item from the bag dropped here is used: the server decides where it goes
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_ITEM) && e.preventDefault()}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData(DRAG_ITEM));
        const o = world.inventory.get(id);
        if (!o) return;
        e.preventDefault();
        e.stopPropagation();
        if (!world.inUse.has(o.id)) session.use(o.id);
      }}
      onDoubleClick={() => object && session.unuse(object.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (object) onLook(object);
      }}
    >
      {object ? <ObjIcon icons={icons} object={object} /> : <span className="equip-label">{label}</span>}
    </div>
  );
}

/** Our figure, from the front (drawbmp.c DrawObject at angle 0). */
function Figure({ session, icons }: { session: GameSession; icons: IconRenderer }) {
  const self = session.world.self;
  return <div className="equip-figure">{self && <ObjIcon icons={icons} object={self.info} opts={{ group: 0 }} />}</div>;
}

export function CharacterWindow({
  session, icons, assets, settings, itemSlots, tab, onTab, onClose, onLookItem, onLook, onDropItem, onApplyItem, onPut, onTabOut, selecting, onSelectObject, onCast,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  settings: Settings;
  /** itemslots.json: picture file -> where it's worn */
  itemSlots: Readonly<Record<string, string>>;
  tab: Tab;
  onTab: (t: Tab) => void;
  onClose: () => void;
  onLookItem: (o: ObjectInfo) => void;
  onLook: (id: number) => void;
  onDropItem: (o: ObjectInfo) => void;
  onApplyItem: (o: ObjectInfo) => void;
  onPut: () => void;
  onTabOut: (forward: boolean) => void;
  selecting: boolean;
  onSelectObject: (id: number) => void;
  onCast: (spell: number, numTargets: number) => void;
}) {
  const world = session.world;
  useWorld(world, ["stats", "inventory", "inUse", "playerOverlays", "spells", "skills", "objectChanged", "roomContents"]);
  const rs = (id: number) => session.resource(id) ?? "";

  // stats.c: the inventory is always here; other groups are asked for when shown. The Inventory
  // tab shows weight and bulk from the Stats group, so it asks for that.
  useEffect(() => {
    const group = tab === "inventory" ? STAT_GROUP.STATS : TABS.find((t) => t.tab === tab)?.group;
    if (group !== undefined) session.requestStats(group);
  }, [session, tab]);

  const inUse = [...world.inventory.values()].filter((o) => world.inUse.has(o.id));
  const wielded = wieldedWeapon(world);
  const { slots, placed } = layoutEquipment(inUse, (o) => wornSlot(o, itemSlots, (id) => session.resource(id)), wielded);
  // Weight and bulk are matched on the English names (the shown language may differ)
  const carried = (name: string) =>
    (world.stats.get(STAT_GROUP.STATS) ?? []).find((s) => s.numeric && session.englishResource(s.nameRes)?.toLowerCase() === name);
  const weight = carried("weight carried");
  const bulk = carried("bulk carried");
  const self = world.self;

  // Moving the window: dragged by its title, kept on letting go
  const anchorRef = useRef<HTMLDivElement>(null);
  const [dragAt, setDragAt] = useState<[number, number] | null>(null);
  const at = dragAt ?? settings.characterWindowAt;
  /** The HUD size: the window is zoomed by it, so its left and top are in view pixels / zoom */
  const zoom = settings.hudScale / 100;
  /** When the title was last pressed: a second press soon after is a double click. (Not
   * onDoubleClick: the pointer capture makes the window, not the title, its target.) */
  const lastPress = useRef(0);
  const startMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = anchorRef.current;
    const view = anchor?.offsetParent;
    const t = e.target as Element;
    if (e.button !== 0 || !anchor || !view || !t.closest(".mk-title") || t.closest("button")) return;
    e.preventDefault();
    if (e.timeStamp - lastPress.current < DOUBLE_MS) {
      lastPress.current = 0;
      updateSettings({ characterWindowAt: null });
      return;
    }
    lastPress.current = e.timeStamp;
    anchor.setPointerCapture(e.pointerId);
    const v = view.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const grabX = e.clientX - a.left,
      grabY = e.clientY - a.top;
    const place = (x: number, y: number): [number, number] => [
      Math.round(Math.max(KEEP_X - a.width, Math.min(v.width - KEEP_X, x - v.left - grabX))),
      Math.round(Math.max(0, Math.min(v.height - KEEP_Y, y - v.top - grabY))),
    ];
    let last: [number, number] | null = null;
    const move = (ev: PointerEvent) => {
      last = place(ev.clientX, ev.clientY);
      setDragAt(last);
    };
    const up = () => {
      anchor.removeEventListener("pointermove", move);
      anchor.removeEventListener("pointerup", up);
      anchor.removeEventListener("pointercancel", up);
      setDragAt(null);
      if (last) updateSettings({ characterWindowAt: last });
    };
    anchor.addEventListener("pointermove", move);
    anchor.addEventListener("pointerup", up);
    anchor.addEventListener("pointercancel", up);
  };
  // Where it was put, kept in view if the window has shrunk since; it grows down to the view's bottom
  const moved: CSSProperties | undefined = at
    ? {
        left: `clamp(${KEEP_X}px - 100%, ${at[0] / zoom}px, 100% - ${KEEP_X}px)`,
        top: `clamp(0px, ${at[1] / zoom}px, 100% - ${KEEP_Y}px)`,
        right: "auto",
        maxHeight: `calc(100% - min(${at[1] / zoom}px, 100% - ${KEEP_Y}px) - ${BOTTOM_GAP}px)`,
      }
    : undefined;

  const box = (key: EquipKey, label: string) => (
    <EquipBox key={key} session={session} icons={icons} label={label} object={slots[key]} tooltips={settings.tooltips} onLook={onLookItem} />
  );

  return (
    <div
      ref={anchorRef}
      className={`character-window-anchor${dragAt ? " moving" : ""}`}
      style={moved}
      onPointerDown={startMove}
    >
      <Window title={self ? rs(self.info.nameRes) : "Character"} onClose={onClose} className="character-window">
        <div className="cw-tabs" role="tablist">
          {TABS.map((t) => (
            <StatTab key={t.tab} assets={assets} bitmap={t.bitmap} label={t.label} tooltip={settings.tooltips} active={tab === t.tab} onClick={() => onTab(t.tab)} />
          ))}
        </div>
        {tab === "inventory" ? (
          <>
            <div className="cw-doll">
              <div className="equip-column">{EQUIP_COLUMNS[0].map((s) => box(s.key, s.label))}</div>
              <Figure session={session} icons={icons} />
              <div className="equip-column">{EQUIP_COLUMNS[1].map((s) => box(s.key, s.label))}</div>
              <div className="cw-info">
                <div className="cw-wield-label">Wielding</div>
                <div className="cw-wield">{wielded ? rs(wielded.nameRes) : "nothing"}</div>
                {weight && (
                  <div className="cw-carried">
                    <span>Weight</span>
                    <StatBar stat={weight} />
                  </div>
                )}
                {bulk && (
                  <div className="cw-carried">
                    <span>Bulk</span>
                    <StatBar stat={bulk} />
                  </div>
                )}
              </div>
            </div>
            {/* "inventory-panel": where dragging an object from the view picks it up (mermain.c A_ENDDRAG) */}
            <div className="cw-bag stat-area inventory-panel">
              <Inventory
                session={session}
                icons={icons}
                assets={assets}
                onLookItem={onLookItem}
                onDropItem={onDropItem}
                onApplyItem={onApplyItem}
                onPut={onPut}
                onTabOut={onTabOut}
                selecting={selecting}
                onSelectObject={onSelectObject}
                showAmounts={settings.inventoryNumbers}
                tooltips={settings.tooltips}
                hidden={placed}
                minCells={BAG_MIN_CELLS}
                // Off the paper doll into the bag: taken off
                onDropOnGrid={(id) => placed.has(id) && session.unuse(id)}
              />
            </div>
          </>
        ) : (
          <div className="cw-page stat-area">
            {tab === "stats" ? (
              <NumericStats stats={world.stats.get(STAT_GROUP.STATS) ?? []} rs={rs} />
            ) : (
              <StatList
                session={session}
                icons={icons}
                group={tab === "spells" ? STAT_GROUP.SPELLS : tab === "skills" ? STAT_GROUP.SKILLS : STAT_GROUP.QUESTS}
                onLook={onLook}
                onCast={onCast}
              />
            )}
          </div>
        )}
      </Window>
    </div>
  );
}
