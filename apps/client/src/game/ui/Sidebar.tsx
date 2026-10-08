// The original client's right-hand column (module/merintr):
//   user area (userarea.c): our face, with our enchantments under it (enchant.c)
//   main stats (statmain.c): health, mana, vigor and experience bars with their icons
//   minimap (clientd3d/map.c), with the room's enchantments in its top-right corner
//   stat groups (stats.c, statbtn.c): Inventory, Stats, Spells, Skills, Quests tabs
// drawn on the original's background bitmaps from the asset build (ui/*.bmp).

import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { Room } from "@shards/formats";
import { STAT_GROUP, STAT_TAG, STATS, type ObjectInfo, type Statistic } from "@shards/protocol";
import { isNumberItem, type GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import { bareIcon, type Drawable, type IconOptions, type IconRenderer } from "../icons.ts";
import { useAsyncImage, useWorld } from "./hooks.ts";
import { useKeyedHalves, useKeyedImage } from "./keyed.ts";
import type { Settings } from "../settings.ts";
import { MiniMap } from "./MiniMap.tsx";

/** statmain.c: main stat numbers */
const STAT_HP = 1,
  STAT_MP = 2,
  STAT_VIGOR = 3,
  STAT_XP = 4;
const MIN_VIGOR = 10; // statmain.h: below this you can't run; the bar turns red

export type Tab = "inventory" | "stats" | "spells" | "skills" | "quests";
const TABS: { tab: Tab; group: number; bitmap: string; label: string }[] = [
  { tab: "inventory", group: STAT_GROUP.INVENTORY, bitmap: "statbtn_left_invent.bmp", label: "Inventory" },
  { tab: "stats", group: STAT_GROUP.STATS, bitmap: "statbtn_left_stats.bmp", label: "Statistics" },
  { tab: "spells", group: STAT_GROUP.SPELLS, bitmap: "statbtn_left_spell.bmp", label: "Spells" },
  { tab: "skills", group: STAT_GROUP.SKILLS, bitmap: "statbtn_left_skills.bmp", label: "Skills" },
  { tab: "quests", group: STAT_GROUP.QUESTS, bitmap: "statbtn_left_quest.bmp", label: "Quests" },
];

export function ObjIcon({
  icons, object, opts, className, title,
}: {
  icons: IconRenderer;
  object: Drawable | null;
  opts?: IconOptions;
  className?: string;
  title?: string;
}) {
  const key = object ? icons.key(object, opts) : "";
  const url = useAsyncImage(key, () => (object ? icons.object(object, opts) : null));
  return <span className={`obj-icon ${className ?? ""}`} title={title}>{url && <img src={url} alt="" draggable={false} />}</span>;
}

/**
 * statbtn.c StatButtonDrawItem: the group's glyph on the left, the middle piece repeated up to
 * the right piece, each from the up or down half of its bitmap, drawn transparently.
 */
function StatTab({
  assets, bitmap, label, active, onClick,
}: {
  assets: AssetStore;
  bitmap: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const left = useKeyedHalves(assets.url(`ui/${bitmap}`));
  const mid = useKeyedHalves(assets.url("ui/statbtn_mid.bmp"));
  const right = useKeyedHalves(assets.url("ui/statbtn_right.bmp"));
  const half = (h: [string, string] | null) => (h ? { backgroundImage: `url(${h[active ? 1 : 0]})` } : undefined);
  return (
    <button className={active ? "stat-tab active" : "stat-tab"} title={label} aria-label={label} onClick={onClick}>
      <span className="mid" style={half(mid)} />
      <span className="glyph" style={half(left)} />
      <span className="cap" style={half(right)} />
    </button>
  );
}

/** graphctl.c GraphCtlPaint: frame, value bar, limit bar, background, the number. */
function StatBar({ stat, main = false, xpAsPercent = false }: { stat: Statistic; main?: boolean; xpAsPercent?: boolean }) {
  const n = stat.numeric!;
  const xp = main && stat.num === STAT_XP;
  // StatsMainChange: health and mana run to their current maximum
  const max = main && (stat.num === STAT_HP || stat.num === STAT_MP) ? n.currentMax : n.max;
  const span = max - n.min;
  const pct = (v: number) => (span === 0 ? 100 : Math.max(0, Math.min(100, ((v - n.min) * 100) / span)));
  const value = pct(n.value);
  const limit = xp ? value : Math.max(value, pct(n.currentMax));
  const low = main && stat.num === STAT_VIGOR && n.value < MIN_VIGOR;
  // Display XP as percent (config.xp_display_percent)
  const text = xp ? (xpAsPercent ? `${Math.floor(value)}% XP` : `${n.value} XP / ${n.max} XP`) : String(n.value);
  return (
    <div className="stat-bar">
      <div className="fill" style={{ width: `${value}%`, background: low ? "rgb(255,0,0)" : undefined }} />
      {limit > value && <div className="limit" style={{ left: `${value}%`, width: `${limit - value}%` }} />}
      <span className={xp ? "num xp" : value > 70 ? "num inside" : "num"} style={xp || value > 70 ? undefined : { left: `calc(${value}% + 2px)` }}>
        {text}
      </span>
    </div>
  );
}

export function Sidebar({
  session, icons, assets, getRoom, tab, onTab, settings, onLookItem, onLook, onDropItem, target, selecting, onSelectObject, onCast,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  getRoom: () => Room | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Map zoom, Show dynamic map, Show amounts for inventory items, Display XP as percent */
  settings: Settings;
  /** Right click on an inventory item (inventry.c A_LOOKINVENTORY): its description with Drop and Use */
  onLookItem: (o: ObjectInfo) => void;
  /** Right click on our face, a spell or a skill: its description, nothing more (SetDescParams DESC_NONE) */
  onLook: (id: number) => void;
  onDropItem: (o: ObjectInfo) => void;
  /** The selected target, for the self-target ring behind our face */
  target: number | null;
  /** Picking a spell target (GAME_SELECT): clicks on our face or an item pick it */
  selecting: boolean;
  /** Our face or an item was picked as a spell target */
  onSelectObject: (id: number) => void;
  onCast: (spell: number, numTargets: number) => void;
}) {
  const world = session.world;
  const selfTargetImg = useKeyedImage(assets.url("ui/selftrgt.bmp"));
  useWorld(world, ["stats", "enchantments", "inventory", "inUse", "spells", "skills", "roomContents", "objectChanged"]);
  const ui = (name: string) => `url(${assets.url(`ui/${name}`)})`;
  const main = (world.stats.get(STAT_GROUP.MAIN) ?? []).filter((s) => s.type === STATS.NUMERIC && s.numeric?.tag === STAT_TAG.INT);
  const self = world.self;
  const rs = (id: number) => session.resource(id) ?? "";

  const pick = (t: Tab, group: number) => {
    // stats.c: the inventory is always here; other groups are asked for when shown
    if (t !== "inventory") session.requestStats(group);
    onTab(t);
  };

  return (
    <aside className="sidebar" style={{ backgroundImage: ui("bkgnd.bmp") }}>
      <div className="user-area">
        <div
          className={selecting ? "portrait selecting" : "portrait"}
          title={self ? rs(self.info.nameRes) : ""}
          // userarea.c UserAreaProc: a click picks us as a spell target; a right click looks at us
          onClick={() => self && selecting && onSelectObject(self.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (self) onLook(self.id);
          }}
        >
          {self && target === self.id && selfTargetImg && <img className="self-target" src={selfTargetImg} alt="" draggable={false} />}
          {self && <PortraitIcon icons={icons} object={self.info} />}
        </div>
        <div className="main-stats">
          {main
            .sort((a, b) => a.num - b.num)
            .map((s) => (
              <div className="main-stat" key={s.num}>
                <ObjIcon icons={icons} object={bareIcon(s.nameRes)} className="stat-icon" />
                <StatBar stat={s} main xpAsPercent={settings.xpAsPercent} />
              </div>
            ))}
        </div>
      </div>
      <div className="enchantments player">
        {[...world.enchantments.player.values()].map((e) => (
          <ObjIcon key={e.id} icons={icons} object={e} className="enchant" title={rs(e.nameRes)} />
        ))}
      </div>
      <div className="map-frame">
        {/* Show dynamic map (config.drawmap) off: just the map paper */}
        {settings.dynamicMap ? (
          <MiniMap world={world} getRoom={getRoom} zoom={settings.mapZoom} paper={assets.url("ui/mapbkgnd.bmp")} />
        ) : (
          <div className="minimap off" style={{ backgroundImage: `url(${assets.url("ui/mapbkgnd.bmp")})` }} />
        )}
        <div className="enchantments room">
          {[...world.enchantments.room.values()].map((e) => (
            <ObjIcon key={e.id} icons={icons} object={e} className="enchant" title={rs(e.nameRes)} />
          ))}
        </div>
      </div>
      <div className="stat-tabs">
        {TABS.map((t) => (
          <StatTab key={t.tab} assets={assets} bitmap={t.bitmap} label={t.label} active={tab === t.tab} onClick={() => pick(t.tab, t.group)} />
        ))}
      </div>
      {/* "inventory-panel": where dragging an object from the view picks it up (mermain.c A_ENDDRAG) */}
      <div className={tab === "inventory" ? "stat-area inventory-panel" : "stat-area"} style={{ backgroundImage: ui("invbkgnd.bmp") }}>
        {tab === "inventory" ? (
          <Inventory
            session={session}
            icons={icons}
            assets={assets}
            onLookItem={onLookItem}
            onDropItem={onDropItem}
            selecting={selecting}
            onSelectObject={onSelectObject}
            showAmounts={settings.inventoryNumbers}
          />
        ) : tab === "stats" ? (
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
    </aside>
  );
}

function PortraitIcon({ icons, object }: { icons: IconRenderer; object: ObjectInfo }) {
  const key = `portrait:${icons.key(object)}`;
  const url = useAsyncImage(key, () => icons.portrait(object));
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

/** inventry.c: a grid of 40x40 boxes; in-use items sit on the yellow sun (inuse.bmp). */
function Inventory({
  session, icons, assets, onLookItem, onDropItem, selecting, onSelectObject, showAmounts,
}: {
  /** Show amounts for inventory items (config.inventory_num) */
  showAmounts: boolean;
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  onLookItem: (o: ObjectInfo) => void;
  onDropItem: (o: ObjectInfo) => void;
  selecting: boolean;
  onSelectObject: (id: number) => void;
}) {
  const world = session.world;
  const [selected, setSelected] = useState<number | null>(null);
  const inUseImg = useKeyedImage(assets.url("ui/inuse.bmp"));
  const items = [...world.inventory.values()];
  const rs = (id: number) => session.resource(id) ?? "";
  const toggleUse = (o: ObjectInfo) => (world.inUse.has(o.id) ? session.unuse(o.id) : session.use(o.id));
  return (
    <div className="inventory-grid">
      {items.map((o) => (
        <div
          key={o.id}
          className={selected === o.id ? "inv-item selected" : "inv-item"}
          style={selected === o.id ? { backgroundImage: `url(${assets.url("ui/icursor.bmp")})` } : undefined}
          title={(isNumberItem(o.id) ? `${o.amount} ` : "") + rs(o.nameRes)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-shards-item", String(o.id));
            e.dataTransfer.effectAllowed = "move";
          }}
          // inventry.c: in GAME_SELECT a click picks the item as a spell target
          onClick={() => (selecting ? onSelectObject(o.id) : setSelected(o.id))}
          onDoubleClick={() => !selecting && toggleUse(o)}
          // inventry.c: VK_RBUTTON is A_LOOKINVENTORY
          onContextMenu={(e: ReactMouseEvent) => {
            e.preventDefault();
            setSelected(o.id);
            onLookItem(o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Delete") onDropItem(o);
          }}
          tabIndex={0}
        >
          {world.inUse.has(o.id) && inUseImg && <img className="in-use" src={inUseImg} alt="" draggable={false} />}
          <ObjIcon icons={icons} object={o} />
          {showAmounts && isNumberItem(o.id) && <span className="inv-num">{o.amount}</span>}
        </div>
      ))}
    </div>
  );
}

/** statnum.c: name on the left; a bar with the number, or a resource string, on the right. */
function NumericStats({ stats, rs }: { stats: Statistic[]; rs: (id: number) => string }) {
  return (
    <div className="stat-rows">
      {[...stats]
        .sort((a, b) => a.num - b.num)
        .map((s) => (
          <div className="stat-row" key={s.num}>
            <span className="stat-name">{rs(s.nameRes)}</span>
            {s.numeric?.tag === STAT_TAG.RES ? (
              <span className="stat-value">{rs(s.numeric.value)}</span>
            ) : s.numeric ? (
              <StatBar stat={s} />
            ) : null}
          </div>
        ))}
    </div>
  );
}

/** statlist.c: icon and "name NN%" (quests: name only; headers green). */
function StatList({
  session, icons, group, onLook, onCast,
}: {
  session: GameSession;
  icons: IconRenderer;
  group: number;
  onLook: (id: number) => void;
  onCast: (spell: number, numTargets: number) => void;
}) {
  const world = session.world;
  const [selected, setSelected] = useState<number | null>(null);
  const stats = world.stats.get(group) ?? [];
  const quests = group === STAT_GROUP.QUESTS;
  const rs = (id: number) => session.resource(id) ?? "";
  const spellFor = (id: number) => world.spells.find((s) => s.object.id === id);
  const rows: ReactNode[] = stats.map((s, i) => {
    const l = s.list!;
    if (!l) return null;
    const header = quests && l.value === 0;
    return (
      <div
        key={`${s.num}:${i}`}
        className={`stat-list-row${header ? " header" : ""}${selected === i ? " selected" : ""}`}
        onClick={() => setSelected(i)}
        onDoubleClick={() => {
          if (group === STAT_GROUP.SPELLS && l.id) onCast(l.id, spellFor(l.id)?.numTargets ?? 0);
          else if (l.id) onLook(l.id);
        }}
        // statlist.c StatsListRButton: look at it (not quest headers)
        onContextMenu={(e) => {
          e.preventDefault();
          if (!l.id || header) return;
          setSelected(i);
          onLook(l.id);
        }}
      >
        {!header && <ObjIcon icons={icons} object={l.icon ? bareIcon(l.icon) : null} className="list-icon" />}
        <span>{quests ? rs(s.nameRes) : `${rs(s.nameRes)} ${l.value}%`}</span>
      </div>
    );
  });
  return <div className="stat-list">{rows.length ? rows : <div className="stat-list-row muted">—</div>}</div>;
}
