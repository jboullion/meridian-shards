// The Modern interface's HUD over the view (ours; settings.ts interfaceStyle, desktop only):
//   - UnitFrame, top left: our face, name and enchantments, and the toolbar's Rest/Stand and mailbox
//   - TargetFrame, top centre: what's targeted, and a button to clear it
//   - MapCluster, top right: the minimap in a round frame (a click opens the full map), its zoom
//     buttons, and the room's name and enchantments. The character window and the rest have keys.
//   - ActionBar, bottom centre: health and mana, vigor, the quick slots (Hotbar) and experience.
//     The hands stay in the view's corners, as in Classic: their art is cut off along the outer
//     edge (it's meant to run off the screen), so anywhere else the swing shows a straight cut.
// The Classic interface draws the same things in the original's column (Sidebar.tsx).

import type { ReactNode } from "react";
import type { Room } from "@shards/formats";
import { STAT_GROUP, STAT_TAG, STATS, type Statistic } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import type { MapAnnotation } from "../annotations.ts";
import type { IconRenderer } from "../icons.ts";
import type { QuickSlot, QuickSlots } from "../quickSlots.ts";
import type { Settings } from "../settings.ts";
import { useWorld } from "./hooks.ts";
import { MiniMap } from "./MiniMap.tsx";
import { Hotbar } from "./QuickSlots.tsx";
import { ObjIcon, PortraitIcon, STAT_HP, STAT_MP, STAT_VIGOR, STAT_XP, barValues } from "./Sidebar.tsx";
import { ToolbarButtonView, type ToolbarButton } from "./Toolbar.tsx";

/** include/proto.h OF_ATTACKABLE */
const OF_ATTACKABLE = 0x8;

/** Our enchantments, or the room's: a right click looks at one (enchant.c WM_RBUTTONDOWN). */
function Enchantments({ session, icons, kind, tooltips, onLook }: { session: GameSession; icons: IconRenderer; kind: "player" | "room"; tooltips: boolean; onLook: (id: number) => void }) {
  const world = session.world;
  useWorld(world, ["enchantments"]);
  const list = [...world.enchantments[kind].values()];
  if (!list.length) return null;
  return (
    <div className={`modern-enchantments ${kind}`}>
      {list.map((e) => (
        <ObjIcon
          key={e.id}
          icons={icons}
          object={e}
          className="enchant"
          title={tooltips ? (session.resource(e.nameRes) ?? "") : undefined}
          onContextMenu={(ev) => {
            ev.preventDefault();
            onLook(e.id);
          }}
        />
      ))}
    </div>
  );
}

export function UnitFrame({
  session, icons, settings, buttons, assets, selecting, onSelectSelf, onLook,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  settings: Settings;
  /** Rest/Stand and the mailbox (none with Show toolbar off) */
  buttons?: ToolbarButton[];
  /** Picking a spell target: a click on our face picks us */
  selecting: boolean;
  onSelectSelf: () => void;
  onLook: (id: number) => void;
}) {
  const world = session.world;
  useWorld(world, ["objectChanged", "roomContents"]);
  const self = world.self;
  return (
    <div className="unit-frame">
      <div className="unit-top">
        <div
          className={selecting ? "unit-portrait selecting" : "unit-portrait"}
          // userarea.c UserAreaProc: a click picks us as a spell target; a right click looks at us
          onClick={() => selecting && onSelectSelf()}
          onContextMenu={(e) => {
            e.preventDefault();
            if (self) onLook(self.id);
          }}
        >
          {self && <PortraitIcon icons={icons} object={self.info} />}
        </div>
        <div className="unit-side">
          <div className="unit-name">{self ? (session.resource(self.info.nameRes) ?? "") : ""}</div>
          {buttons && (
            <div className="unit-buttons" role="toolbar" aria-label="Toolbar">
              {buttons.map((b) => (
                <ToolbarButtonView key={b.bitmap} assets={assets} button={b} tooltips={settings.tooltips} />
              ))}
            </div>
          )}
        </div>
      </div>
      <Enchantments session={session} icons={icons} kind="player" tooltips={settings.tooltips} onLook={onLook} />
    </div>
  );
}

/** The selected target (ours): its picture and name, red if it can be attacked. */
export function TargetFrame({ session, icons, target, onLook, onClear }: { session: GameSession; icons: IconRenderer; target: number | null; onLook: (id: number) => void; onClear: () => void }) {
  const world = session.world;
  useWorld(world, ["objectChanged", "objectRemoved", "roomContents"]);
  const o = target !== null ? world.objects.get(target) : undefined;
  if (!o) return null;
  const attackable = (o.info.flags & OF_ATTACKABLE) !== 0 && o.id !== world.self?.id;
  return (
    <div
      className={attackable ? "target-frame attackable" : "target-frame"}
      onContextMenu={(e) => {
        e.preventDefault();
        onLook(o.id);
      }}
    >
      <ObjIcon icons={icons} object={o.info} opts={{ group: 0 }} className="target-icon" />
      <span className="target-name">{session.resource(o.info.nameRes) ?? ""}</span>
      <button type="button" className="target-clear" aria-label="Clear the target" title="Clear the target" onClick={(e) => {
          e.currentTarget.blur();
          onClear();
        }}>
        ×
      </button>
    </div>
  );
}

/** A round button by the map. */
function MapButton({ label, className, onClick, children }: {
  label: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`map-button${className ? ` ${className}` : ""}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function MapCluster({
  session, icons, assets, settings, getRoom, roomName, annotations, onAnnotate, onLook, onZoom, onMap,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  settings: Settings;
  getRoom: () => Room | null;
  roomName: string;
  annotations: readonly MapAnnotation[];
  onAnnotate: (x: number, y: number) => void;
  onLook: (id: number) => void;
  /** +1 zooms in, -1 out (the Map Zoom keys) */
  onZoom: (dir: 1 | -1) => void;
  /** A click on the map: the full map over the view (the Map key) */
  onMap: () => void;
}) {
  const paper = assets.url("ui/mapbkgnd.bmp");
  return (
    <div className="map-cluster">
      <div className="map-ring">
        {/* Show dynamic map (config.drawmap) off: just the map paper */}
        {settings.dynamicMap ? (
          <MiniMap
            world={session.world}
            getRoom={getRoom}
            zoom={settings.mapZoom}
            paper={paper}
            annotations={settings.mapAnnotations ? annotations : undefined}
            annotationIcon={assets.url("ui/annotate.bmp")}
            onAnnotate={onAnnotate}
            onClick={onMap}
            tooltips={settings.tooltips}
          />
        ) : (
          <div className="minimap off clickable" style={{ backgroundImage: `url(${paper})` }} onClick={onMap} />
        )}
        <MapButton label="Zoom out" className="zoom-out" onClick={() => onZoom(-1)}>
          −
        </MapButton>
        <MapButton label="Zoom in" className="zoom-in" onClick={() => onZoom(1)}>
          +
        </MapButton>
      </div>
      {roomName && <div className="map-room-name">{roomName}</div>}
      <Enchantments session={session} icons={icons} kind="room" tooltips={settings.tooltips} onLook={onLook} />
    </div>
  );
}

/** One of the action bar's bars: the fill, the limit bar, and "value / max" (or XP). */
function HudBar({ stat, kind, xpAsPercent = false }: { stat: Statistic; kind: string; xpAsPercent?: boolean }) {
  const n = stat.numeric!;
  const { value, limit, max, low, xp } = barValues(stat, true);
  const text = xp ? (xpAsPercent ? `${Math.floor(value)}% XP` : `${n.value} / ${n.max} XP`) : `${n.value} / ${max}`;
  return (
    <div className={`hud-bar ${kind}${low ? " low" : ""}`} title={xp ? text : undefined}>
      <div className="fill" style={{ width: `${value}%` }} />
      {limit > value && <div className="limit" style={{ left: `${value}%`, width: `${limit - value}%` }} />}
      {/* The XP bar is a thin line: its numbers on hover */}
      {!xp && <span className="hud-bar-text">{text}</span>}
    </div>
  );
}

export function ActionBar({
  session, icons, settings, slots, selecting, onSelectSelf, onUse, onEdit, onSet, onSwap,
}: {
  session: GameSession;
  icons: IconRenderer;
  settings: Settings;
  slots: QuickSlots;
  selecting: boolean;
  onSelectSelf: () => void;
  onUse: (i: number) => void;
  onEdit: (i: number) => void;
  onSet: (i: number, slot: QuickSlot) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const world = session.world;
  useWorld(world, ["stats"]);
  const main = new Map(
    (world.stats.get(STAT_GROUP.MAIN) ?? []).filter((s) => s.type === STATS.NUMERIC && s.numeric?.tag === STAT_TAG.INT).map((s) => [s.num, s]),
  );
  const bar = (num: number, kind: string) => {
    const s = main.get(num);
    return s ? <HudBar stat={s} kind={kind} xpAsPercent={settings.xpAsPercent} /> : <div className={`hud-bar ${kind} empty`} />;
  };
  return (
    <div className="action-bar">
      {/* Picking a spell target: a click on our bars picks us, as on our face */}
      <div className={selecting ? "action-bar-stats selecting" : "action-bar-stats"} onClick={() => selecting && onSelectSelf()}>
        <div className="hud-bar-row">
          {bar(STAT_HP, "health")}
          {bar(STAT_MP, "mana")}
        </div>
        {bar(STAT_VIGOR, "vigor")}
      </div>
      <Hotbar session={session} icons={icons} slots={slots} settings={settings} onUse={onUse} onEdit={onEdit} onSet={onSet} onSwap={onSwap} />
      {bar(STAT_XP, "xp")}
    </div>
  );
}
