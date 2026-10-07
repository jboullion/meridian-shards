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

/** Inventory right click / spell or quest actions, shown by the game view as a menu. */
export interface ItemMenu {
  object: ObjectInfo;
  x: number;
  y: number;
}

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

/** graphctl.c GraphCtlPaint: frame, value bar, limit bar, background, the number. */
function StatBar({ stat, main = false }: { stat: Statistic; main?: boolean }) {
  const n = stat.numeric!;
  const xp = main && stat.num === STAT_XP;
  // StatsMainChange: health and mana run to their current maximum
  const max = main && (stat.num === STAT_HP || stat.num === STAT_MP) ? n.currentMax : n.max;
  const span = max - n.min;
  const pct = (v: number) => (span === 0 ? 100 : Math.max(0, Math.min(100, ((v - n.min) * 100) / span)));
  const value = pct(n.value);
  const limit = xp ? value : Math.max(value, pct(n.currentMax));
  const low = main && stat.num === STAT_VIGOR && n.value < MIN_VIGOR;
  const text = xp ? `${n.value} XP / ${n.max} XP` : String(n.value);
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
  session, icons, assets, getRoom, tab, onTab, mapZoom, onItemMenu, onDropItem,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  getRoom: () => Room | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  mapZoom: number;
  onItemMenu: (m: ItemMenu) => void;
  onDropItem: (o: ObjectInfo) => void;
}) {
  const world = session.world;
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
          className="portrait"
          title={self ? rs(self.info.nameRes) : ""}
          onClick={() => self && session.look(self.id)}
        >
          {self && <PortraitIcon icons={icons} object={self.info} />}
        </div>
        <div className="main-stats">
          {main
            .sort((a, b) => a.num - b.num)
            .map((s) => (
              <div className="main-stat" key={s.num}>
                <ObjIcon icons={icons} object={bareIcon(s.nameRes)} className="stat-icon" />
                <StatBar stat={s} main />
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
        <MiniMap world={world} getRoom={getRoom} zoom={mapZoom} paper={assets.url("ui/mapbkgnd.bmp")} />
        <div className="enchantments room">
          {[...world.enchantments.room.values()].map((e) => (
            <ObjIcon key={e.id} icons={icons} object={e} className="enchant" title={rs(e.nameRes)} />
          ))}
        </div>
      </div>
      <div className="stat-tabs">
        {TABS.map((t) => (
          <button
            key={t.tab}
            className={tab === t.tab ? "stat-tab active" : "stat-tab"}
            title={t.label}
            onClick={() => pick(t.tab, t.group)}
            style={{ backgroundImage: `${ui("statbtn_right.bmp")}, ${ui("statbtn_mid.bmp")}` }}
          >
            <span className="glyph" style={{ backgroundImage: ui(t.bitmap) }} />
          </button>
        ))}
      </div>
      <div className="stat-area" style={{ backgroundImage: ui("invbkgnd.bmp") }}>
        {tab === "inventory" ? (
          <Inventory session={session} icons={icons} assets={assets} onItemMenu={onItemMenu} onDropItem={onDropItem} />
        ) : tab === "stats" ? (
          <NumericStats stats={world.stats.get(STAT_GROUP.STATS) ?? []} rs={rs} />
        ) : (
          <StatList
            session={session}
            icons={icons}
            group={tab === "spells" ? STAT_GROUP.SPELLS : tab === "skills" ? STAT_GROUP.SKILLS : STAT_GROUP.QUESTS}
            onItemMenu={onItemMenu}
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
  session, icons, assets, onItemMenu, onDropItem,
}: {
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  onItemMenu: (m: ItemMenu) => void;
  onDropItem: (o: ObjectInfo) => void;
}) {
  const world = session.world;
  const [selected, setSelected] = useState<number | null>(null);
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
          onClick={() => setSelected(o.id)}
          onDoubleClick={() => toggleUse(o)}
          onContextMenu={(e: ReactMouseEvent) => {
            e.preventDefault();
            setSelected(o.id);
            onItemMenu({ object: o, x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key === "Delete") onDropItem(o);
          }}
          tabIndex={0}
        >
          {world.inUse.has(o.id) && <img className="in-use" src={assets.url("ui/inuse.bmp")} alt="" draggable={false} />}
          <ObjIcon icons={icons} object={o} />
          {isNumberItem(o.id) && <span className="inv-num">{o.amount}</span>}
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
  session, icons, group, onItemMenu,
}: {
  session: GameSession;
  icons: IconRenderer;
  group: number;
  onItemMenu: (m: ItemMenu) => void;
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
    const object = spellFor(l.id)?.object ?? world.skills.find((k) => k.id === l.id) ?? null;
    return (
      <div
        key={`${s.num}:${i}`}
        className={`stat-list-row${header ? " header" : ""}${selected === i ? " selected" : ""}`}
        onClick={() => setSelected(i)}
        onDoubleClick={() => {
          if (group === STAT_GROUP.SPELLS && l.id) {
            const sp = spellFor(l.id);
            // A spell needing a target is aimed at ourselves until targeting arrives (milestone 6)
            const self = world.player?.id;
            session.cast(l.id, sp && sp.numTargets > 0 && self ? [{ id: self }] : []);
          } else if (l.id) session.look(l.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!l.id) return;
          setSelected(i);
          const o = object ?? ({ id: l.id, nameRes: s.nameRes, iconRes: l.icon } as ObjectInfo);
          onItemMenu({ object: o, x: e.clientX, y: e.clientY });
        }}
      >
        {!header && <ObjIcon icons={icons} object={l.icon ? bareIcon(l.icon) : null} className="list-icon" />}
        <span>{quests ? rs(s.nameRes) : `${rs(s.nameRes)} ${l.value}%`}</span>
      </div>
    );
  });
  return <div className="stat-list">{rows.length ? rows : <div className="stat-list-row muted">—</div>}</div>;
}
