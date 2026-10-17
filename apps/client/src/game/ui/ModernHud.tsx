// The Modern interface's HUD over the view (ours; settings.ts interfaceStyle, desktop only):
//   - UnitFrame, top left: our face, the green bars beside it (health, mana, vigor, experience:
//     Sidebar.tsx HudBars) and our enchantments under them. The phone has it too (TouchControls.tsx).
//   - TargetFrame, top centre: what's targeted, and a button to clear it
//   - MapCluster, top right: the minimap in a round frame (a click opens the full map), the
//     toolbar's Rest/Stand and mailbox at its top corners and its zoom buttons at the bottom, and
//     the room's name and enchantments. The character window and the rest have keys.
//   - ActionBar, bottom centre: the quick slots (Hotbar) alone, as on the phone.
//     The hands stay in the view's corners, as in Classic: their art is cut off along the outer
//     edge (it's meant to run off the screen), so anywhere else the swing shows a straight cut.
// The Classic interface draws the same things in the original's column (Sidebar.tsx).

import type { ReactNode } from "react";
import type { MapWay } from "../questWays.ts";
import type { Room } from "@shards/formats";
import type { GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import type { MapAnnotation } from "../annotations.ts";
import type { IconRenderer } from "../icons.ts";
import type { QuickSlot, QuickSlots } from "../quickSlots.ts";
import type { Cooldown } from "../cooldowns.ts";
import type { Settings } from "../settings.ts";
import { useWorld } from "./hooks.ts";
import { MiniMap } from "./MiniMap.tsx";
import { Hotbar } from "./QuickSlots.tsx";
import { ENCHANTMENT_EVENTS, HudBars, HudEnchantments, ObjIcon, PortraitIcon, shownEnchantments } from "./Sidebar.tsx";
import { ToolbarButtonView, type ToolbarButton } from "./Toolbar.tsx";

/** include/proto.h OF_ATTACKABLE */
const OF_ATTACKABLE = 0x8;

/** Our enchantments, or the room's: a right click looks at one (enchant.c WM_RBUTTONDOWN). */
function Enchantments({ session, icons, kind, tooltips, onLook }: { session: GameSession; icons: IconRenderer; kind: "player" | "room"; tooltips: boolean; onLook: (id: number) => void }) {
  const world = session.world;
  useWorld(world, ENCHANTMENT_EVENTS);
  const list = shownEnchantments(world, kind);
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
  session, icons, settings, selecting, onSelectSelf, onLook, onEmotes, touch = false,
}: {
  /** Ours: a click (a tap) on our face, when not picking a target, shows the Quick Emotes (Q) */
  onEmotes?: () => void;
  session: GameSession;
  icons: IconRenderer;
  settings: Settings;
  /** The phone's: its enchantments bigger, a tap looking at one */
  touch?: boolean;
  /** Picking a spell target: a click on our face or our bars picks us */
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
          // userarea.c UserAreaProc: a click picks us as a spell target; a right click looks at us.
          // Ours: otherwise a click shows the emotes
          onClick={() => (selecting ? onSelectSelf() : onEmotes?.())}
          onContextMenu={(e) => {
            e.preventDefault();
            if (self) onLook(self.id);
          }}
        >
          {self && <PortraitIcon icons={icons} object={self.info} />}
        </div>
        {/* The green bars, our enchantments under them */}
        <div className="unit-side">
          <HudBars session={session} icons={icons} onSelectSelf={selecting ? onSelectSelf : undefined} xpAsPercent={settings.xpAsPercent} />
          {touch ? (
            <HudEnchantments session={session} icons={icons} kind="player" onLook={onLook} />
          ) : (
            <Enchantments session={session} icons={icons} kind="player" tooltips={settings.tooltips} onLook={onLook} />
          )}
        </div>
      </div>
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
  session, icons, assets, settings, buttons, getRoom, roomName, annotations, onAnnotate, onLook, onZoom, onMap, tracker, getWay,
}: {
  /** Ours (docs/adr/0009-quests.md 5): tracked quests' areas and the way to them, for the map */
  getWay?: () => MapWay | null;
  /** Ours (docs/adr/0009-quests.md 4.2): the quest tracker, under the map */
  tracker?: ReactNode;
  /** The toolbar's Rest/Stand and mailbox, at the map's top corners (none with Show toolbar off) */
  buttons?: ToolbarButton[];
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
            questMarkers={settings.questMarkers}
            getWay={settings.showWay ? getWay : undefined}
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
        {buttons?.map((b, i) => (
          <ToolbarButtonView key={b.bitmap} assets={assets} button={b} tooltips={settings.tooltips} className={`map-tool ${i ? "top-right" : "top-left"}`} />
        ))}
      </div>
      {roomName && <div className="map-room-name">{roomName}</div>}
      <Enchantments session={session} icons={icons} kind="room" tooltips={settings.tooltips} onLook={onLook} />
      {tracker}
    </div>
  );
}

export function ActionBar({
  session, icons, settings, slots, onUse, onEdit, onSet, onSwap, cooldown,
}: {
  /** The spell cooldown, on the spell slots (cooldowns.ts) */
  cooldown: Cooldown | null;
  session: GameSession;
  icons: IconRenderer;
  settings: Settings;
  slots: QuickSlots;
  onUse: (i: number) => void;
  onEdit: (i: number) => void;
  onSet: (i: number, slot: QuickSlot) => void;
  onSwap: (a: number, b: number) => void;
}) {
  // Our bars are top left (UnitFrame): just the quick slots here, as on the phone
  return (
    <div className="action-bar">
      {/* The second row above the first (the numpad's keys; Second Hotbar, off by default), then the first (1-0) */}
      {settings.secondHotbar && (
        <Hotbar session={session} icons={icons} slots={slots} settings={settings} onUse={onUse} onEdit={onEdit} onSet={onSet} onSwap={onSwap} cooldown={cooldown} row={1} />
      )}
      <Hotbar session={session} icons={icons} slots={slots} settings={settings} onUse={onUse} onEdit={onEdit} onSet={onSet} onSwap={onSwap} cooldown={cooldown} />
    </div>
  );
}
