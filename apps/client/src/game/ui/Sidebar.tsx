// The original client's right-hand column (module/merintr):
//   user area (userarea.c): our face, with our enchantments under it (enchant.c)
//   main stats (statmain.c): health, mana, vigor and experience bars with their icons
//   minimap (clientd3d/map.c), with the room's enchantments in its top-right corner
//   stat groups (stats.c, statbtn.c): Inventory, Stats, Spells, Skills, Quests tabs
// drawn on the original's background bitmaps from the asset build (ui/*.bmp).

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { Room } from "@shards/formats";
import { STAT_GROUP, STAT_TAG, STATS, type ObjectInfo, type Statistic } from "@shards/protocol";
import { isNumberItem, localRes, type GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import { bareIcon, type Drawable, type IconOptions, type IconRenderer } from "../icons.ts";
import { useAsyncImage, useWorld } from "./hooks.ts";
import { useKeyedHalves, useKeyedImage } from "./keyed.ts";
import type { Settings } from "../settings.ts";
import { MiniMap } from "./MiniMap.tsx";
import type { MapAnnotation } from "../annotations.ts";
import { DRAG_SPELL } from "../quickSlots.ts";
import { Button } from "./kit.tsx";

/** include/proto.h OF_APPLYABLE: used on something else */
const OF_APPLYABLE = 0x1000;

/** statmain.c: main stat numbers */
export const STAT_HP = 1,
  STAT_MP = 2,
  STAT_VIGOR = 3,
  STAT_XP = 4;
export const MIN_VIGOR = 10; // statmain.h: below this you can't run; the bar turns red

export type Tab = "inventory" | "stats" | "spells" | "skills" | "friends" | "pets";
/** The tabs: the original's stat groups (stats.c), then ours, drawn with an icon of our own (no group, no bitmap) */
export const TABS: { tab: Tab; group: number | null; bitmap: string | null; label: string }[] = [
  { tab: "inventory", group: STAT_GROUP.INVENTORY, bitmap: "statbtn_left_invent.bmp", label: "Inventory" },
  { tab: "stats", group: STAT_GROUP.STATS, bitmap: "statbtn_left_stats.bmp", label: "Statistics" },
  { tab: "spells", group: STAT_GROUP.SPELLS, bitmap: "statbtn_left_spell.bmp", label: "Spells" },
  { tab: "skills", group: STAT_GROUP.SKILLS, bitmap: "statbtn_left_skills.bmp", label: "Skills" },
  // Ours: docs/adr/0005-friends.md and 0006-pets.md
  { tab: "friends", group: null, bitmap: null, label: "Friends" },
  { tab: "pets", group: null, bitmap: null, label: "Pets" },
];

/**
 * Our tabs' pictures, drawn where the original's tabs have their glyph bitmap: the game's own art,
 * as an item's in the inventory (group 1). Friends: the knight's shield (knhtshld.kod
 * knightshield_icon_rsc); Pets: the baby spider (spdrbaby.kod), the first pet there is.
 */
const TAB_ART: Partial<Record<Tab, string>> = {
  friends: "mtlshld.bgf",
  pets: "spdrby.bgf",
};

export function ObjIcon({
  icons, object, opts, className, title, onContextMenu, onClick,
}: {
  icons: IconRenderer;
  object: Drawable | null;
  opts?: IconOptions;
  className?: string;
  title?: string;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onClick?: (e: ReactMouseEvent) => void;
}) {
  const key = object ? icons.key(object, opts) : "";
  const url = useAsyncImage(key, () => (object ? icons.object(object, opts) : null));
  return (
    <span className={`obj-icon ${className ?? ""}`} title={title} onContextMenu={onContextMenu} onClick={onClick}>
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
}

/**
 * statbtn.c StatButtonDrawItem: the group's glyph on the left, the middle piece repeated up to
 * the right piece, each from the up or down half of its bitmap, drawn transparently.
 */
export function StatTab({
  assets, icons, bitmap, tab, label, tooltip, active, onClick,
}: {
  assets: AssetStore;
  /** Draws our tabs' pictures (TAB_ART) */
  icons: IconRenderer;
  /** The glyph's bitmap; null for our own tabs, drawn with their icon */
  bitmap: string | null;
  tab?: Tab;
  label: string;
  /** statbtn.c: the button's name as a tooltip (Show tooltips) */
  tooltip: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const mid = useKeyedHalves(assets.url("ui/statbtn_mid.bmp"));
  // Our tabs: the middle piece's stone under our icon
  const left = useKeyedHalves(assets.url(`ui/${bitmap ?? "statbtn_mid.bmp"}`));
  const art = !bitmap && tab ? TAB_ART[tab] : undefined;
  const icon = art ? <ObjIcon icons={icons} object={bareIcon(localRes(art))} /> : null;
  const right = useKeyedHalves(assets.url("ui/statbtn_right.bmp"));
  const half = (h: [string, string] | null) => (h ? { backgroundImage: `url(${h[active ? 1 : 0]})` } : undefined);
  return (
    <button className={`stat-tab${active ? " active" : ""}${icon ? " drawn" : ""}`} title={tooltip ? label : undefined} aria-label={label} onClick={onClick}>
      <span className="mid" style={half(mid)} />
      <span className={icon ? "glyph drawn" : "glyph"} style={half(left)}>
        {icon}
      </span>
      <span className="cap" style={half(right)} />
    </button>
  );
}

/**
 * A bar's fill, as percentages: the value, and the limit bar up to the current maximum (none for
 * XP). StatsMainChange: health and mana run to their current maximum. `low`: vigor too low to run.
 */
export function barValues(stat: Statistic, main: boolean): { value: number; limit: number; max: number; low: boolean; xp: boolean } {
  const n = stat.numeric!;
  const xp = main && stat.num === STAT_XP;
  const max = main && (stat.num === STAT_HP || stat.num === STAT_MP) ? n.currentMax : n.max;
  const span = max - n.min;
  const pct = (v: number) => (span === 0 ? 100 : Math.max(0, Math.min(100, ((v - n.min) * 100) / span)));
  const value = pct(n.value);
  const limit = xp ? value : Math.max(value, pct(n.currentMax));
  return { value, limit, max, low: main && stat.num === STAT_VIGOR && n.value < MIN_VIGOR, xp };
}

/** graphctl.c GraphCtlPaint: frame, value bar, limit bar, background, the number. */
export function StatBar({ stat, main = false, xpAsPercent = false }: { stat: Statistic; main?: boolean; xpAsPercent?: boolean }) {
  const n = stat.numeric!;
  const { value, limit, low, xp } = barValues(stat, main);
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

/**
 * TESTING ONLY: shows TEST_ENCHANTMENTS made-up enchantments on us and on the room besides the real
 * ones, to see how the rows look when full. They borrow our spells', skills' and items' pictures and
 * names (so a right click looks at that spell or item). Set to 0 to turn it off.
 */
const TEST_ENCHANTMENTS = 0;

/** The enchantments to draw: the real ones, plus the made-up ones while testing (TEST_ENCHANTMENTS). */
export function shownEnchantments(world: GameSession["world"], kind: "player" | "room"): ObjectInfo[] {
  const real = [...world.enchantments[kind].values()];
  if (!TEST_ENCHANTMENTS) return real;
  const seen = new Set(real.map((e) => e.id));
  const pool = [...world.spells.map((s) => s.object), ...world.skills, ...world.inventory.values()].filter((o) => !seen.has(o.id));
  // The room's from the other end, so the two rows differ
  if (kind === "room") pool.reverse();
  return [...real, ...pool.slice(0, TEST_ENCHANTMENTS)];
}

/** What a list of enchantments redraws on: TEST_ENCHANTMENTS borrows spells, skills and items. */
export const ENCHANTMENT_EVENTS: Parameters<typeof useWorld>[1] = TEST_ENCHANTMENTS ? ["enchantments", "spells", "skills", "inventory"] : ["enchantments"];

/**
 * Enchantments in a row (enchant.c): ours or the room's, each named on hover with Show tooltips, a
 * right click looking at it (WM_RBUTTONDOWN). The Classic interface's room enchantments sit in the
 * toolbar row (Toolbar.tsx ClassicToolbar); ours are under our face.
 */
export function EnchantmentRow({
  session, icons, kind, tooltips, onLook, className,
}: {
  session: GameSession;
  icons: IconRenderer;
  kind: "player" | "room";
  tooltips: boolean;
  onLook: (id: number) => void;
  className?: string;
}) {
  const world = session.world;
  useWorld(world, ENCHANTMENT_EVENTS);
  return (
    <div className={`enchantments ${kind} ${className ?? ""}`}>
      {shownEnchantments(world, kind).map((e) => (
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

/** Health, mana, vigor and experience over the view, for the Modern and phone layouts (ours; ModernHud.tsx UnitFrame): the interface's bars. */
export function HudBars({
  session, icons, onSelectSelf, xpAsPercent = false,
}: {
  session: GameSession;
  icons: IconRenderer;
  onSelectSelf?: () => void;
  /** Display XP as percent (config.xp_display_percent) */
  xpAsPercent?: boolean;
}) {
  const world = session.world;
  useWorld(world, ["stats"]);
  const bars = (world.stats.get(STAT_GROUP.MAIN) ?? [])
    .filter((s) => s.type === STATS.NUMERIC && s.numeric?.tag === STAT_TAG.INT)
    .sort((a, b) => a.num - b.num);
  return (
    // Picking a spell target: a tap on our bars picks us (the interface's face does on the desktop)
    <div className={onSelectSelf ? "hud-bars selecting" : "hud-bars"} onClick={onSelectSelf}>
      {bars.map((s) => (
        <div className="main-stat" key={s.num}>
          <ObjIcon icons={icons} object={bareIcon(s.nameRes)} className="stat-icon" />
          <StatBar stat={s} main xpAsPercent={xpAsPercent} />
        </div>
      ))}
    </div>
  );
}

/**
 * The enchantments on us or on the room, for the phone layout's view (ours; TouchControls.tsx):
 * the interface's enchant.c icons, bigger. A tap, or a long press (the right click), looks at one.
 */
export function HudEnchantments({
  session, icons, kind, onLook,
}: {
  session: GameSession;
  icons: IconRenderer;
  kind: "player" | "room";
  onLook: (id: number) => void;
}) {
  const world = session.world;
  useWorld(world, ENCHANTMENT_EVENTS);
  const list = shownEnchantments(world, kind);
  if (!list.length) return null;
  return (
    <div className={`hud-enchantments ${kind}`}>
      {list.map((e) => (
        <ObjIcon
          key={e.id}
          icons={icons}
          object={e}
          className="enchant"
          onClick={() => onLook(e.id)}
          onContextMenu={(ev) => {
            ev.preventDefault();
            onLook(e.id);
          }}
        />
      ))}
    </div>
  );
}

export function Sidebar({
  session, icons, assets, getRoom, tab, onTab, settings, onLookItem, onLook, onDropItem, onApplyItem, onPut, onTabOut, target, selecting, onSelectObject, onCast,
  annotations, onAnnotate, friendsPanel, petsPanel, onStudy, studying, onEmotes,
}: {
  /** Ours: a click on our face, when not picking a target, shows the Quick Emotes (Q) */
  onEmotes?: () => void;
  /** Ours: the Spells tab's Study button (StatList) */
  onStudy?: () => void;
  studying?: boolean;
  /** Ours: the Friends and Pets tabs' pages (GameView makes them) */
  friendsPanel: ReactNode;
  petsPanel: ReactNode;
  /** The room's map annotations (annotate.c), drawn with Map annotations on */
  annotations: readonly MapAnnotation[];
  /** A right click on the minimap, in room coordinates: add or edit an annotation */
  onAnnotate: (x: number, y: number) => void;
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
  /** inventry.c StartApply: an item to use on something (OF_APPLYABLE) */
  onApplyItem: (o: ObjectInfo) => void;
  /** inventry.c 'P' (A_PUT): put things in a container close by */
  onPut: () => void;
  /** inventry.c A_TABFWD / A_TABBACK: Tab on to the chat line, Shift+Tab back to the view */
  onTabOut: (forward: boolean) => void;
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
  /** tooltip.c: names on hover only with Show tooltips (enchant.c TTN_NEEDTEXT, statbtn.c) */
  const tip = (text: string) => (settings.tooltips ? text : undefined);

  const pick = (t: Tab, group: number | null) => {
    // stats.c: the inventory is always here; other groups are asked for when shown (ours have none)
    if (t !== "inventory" && group !== null) session.requestStats(group);
    onTab(t);
  };

  return (
    <aside className="sidebar" style={{ backgroundImage: ui("bkgnd.bmp") }}>
      <div className="user-area">
        <div
          className={selecting ? "portrait selecting" : "portrait"}
          title={self ? tip(rs(self.info.nameRes)) : undefined}
          // userarea.c UserAreaProc: a click picks us as a spell target; a right click looks at us.
          // Ours: otherwise a click shows the emotes
          onClick={() => (self && selecting ? onSelectObject(self.id) : onEmotes?.())}
          onContextMenu={(e) => {
            e.preventDefault();
            if (self) onLook(self.id);
          }}
        >
          {self && target === self.id && selfTargetImg && <img className="self-target" src={selfTargetImg} alt="" draggable={false} />}
          {self && <PortraitIcon icons={icons} object={self.info} />}
        </div>
        {/* Ours: picking a spell target, a click on our bars picks us, as on our face */}
        <div className={selecting ? "main-stats selecting" : "main-stats"} onClick={() => self && selecting && onSelectObject(self.id)}>
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
        {shownEnchantments(world, "player").map((e) => (
          <ObjIcon
            key={e.id}
            icons={icons}
            object={e}
            className="enchant"
            title={tip(rs(e.nameRes))}
            onContextMenu={(ev) => {
              // enchant.c WM_RBUTTONDOWN: look at the enchantment
              ev.preventDefault();
              onLook(e.id);
            }}
          />
        ))}
      </div>
      <div className="map-frame treat-map">
        {/* Show dynamic map (config.drawmap) off: just the map paper */}
        {settings.dynamicMap ? (
          <MiniMap
            world={world}
            getRoom={getRoom}
            zoom={settings.mapZoom}
            paper={assets.url("ui/mapbkgnd.bmp")}
            annotations={settings.mapAnnotations ? annotations : undefined}
            annotationIcon={assets.url("ui/annotate.bmp")}
            onAnnotate={onAnnotate}
            tooltips={settings.tooltips}
          />
        ) : (
          <div className="minimap off" style={{ backgroundImage: `url(${assets.url("ui/mapbkgnd.bmp")})` }} />
        )}
      </div>
      <div className="stat-tabs">
        {TABS.map((t) => (
          <StatTab key={t.tab} assets={assets} icons={icons} bitmap={t.bitmap} tab={t.tab} label={t.label} tooltip={settings.tooltips} active={tab === t.tab} onClick={() => pick(t.tab, t.group)} />
        ))}
      </div>
      {/* "inventory-panel": where dragging an object from the view picks it up (mermain.c A_ENDDRAG) */}
      <div className="stat-frame treat-inv">
      <div className={tab === "inventory" ? "stat-area inventory-panel" : "stat-area"} style={{ backgroundImage: ui("invbkgnd.bmp") }}>
        {tab === "inventory" ? (
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
          />
        ) : tab === "stats" ? (
          <NumericStats stats={world.stats.get(STAT_GROUP.STATS) ?? []} rs={rs} />
        ) : tab === "friends" ? (
          friendsPanel
        ) : tab === "pets" ? (
          petsPanel
        ) : (
          <StatList
            session={session}
            icons={icons}
            group={tab === "spells" ? STAT_GROUP.SPELLS : STAT_GROUP.SKILLS}
            onLook={onLook}
            onCast={onCast}
            onStudy={onStudy}
            studying={studying}
          />
        )}
      </div>
      </div>
    </aside>
  );
}

/**
 * Our face, as big as its box allows (the img's max-width and max-height in the CSS) at one scale
 * both ways: a whole number of *device* pixels per pixel when it's twice or more, else smoothed.
 * Device pixels are CSS pixels times the display scaling (devicePixelRatio, browser zoom included)
 * and the HUD Size zoom, so at 125% a face meant to be 2x is drawn 2 device pixels a pixel, not 2.5.
 * (Stretched to the box, a 30 x 45 face came out x1.73, uneven and blurred.)
 */
export function PortraitIcon({ icons, object }: { icons: IconRenderer; object: ObjectInfo }) {
  const key = `portrait:${icons.key(object)}`;
  const url = useAsyncImage(key, () => icons.portrait(object));
  const [size, setSize] = useState<{ w: number; h: number; crisp: boolean } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fit = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const css = getComputedStyle(img);
    const k = Math.min(parseFloat(css.maxWidth) / img.naturalWidth, parseFloat(css.maxHeight) / img.naturalHeight);
    if (!(k > 0)) return;
    // Device pixels per CSS pixel here: the screen's, times the cluster's CSS zoom (HUD Size)
    const zoom = (img as HTMLImageElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
    const device = devicePixelRatio * zoom;
    const kd = k * device;
    const next = kd >= 2
      ? { w: (img.naturalWidth * Math.floor(kd)) / device, h: (img.naturalHeight * Math.floor(kd)) / device, crisp: true }
      : { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k), crisp: false };
    setSize((s) => (s && s.w === next.w && s.h === next.h && s.crisp === next.crisp ? s : next));
  };
  // The display scaling changes with browser zoom (a resize) or a move to another screen
  // (the resolution query); HUD Size changes with a resize of the window or the settings
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const watch = () => {
      mq?.removeEventListener("change", onDpr);
      mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    const onDpr = () => {
      watch();
      fit();
    };
    watch();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    // device-pixel-content-box: the box's size in device pixels, which HUD Size's zoom changes
    if (imgRef.current?.parentElement) ro?.observe(imgRef.current.parentElement, { box: "device-pixel-content-box" });
    return () => {
      mq?.removeEventListener("change", onDpr);
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, [url]);
  // And on every render: changing HUD Size redraws the HUD (setSize keeps the same state, no loop)
  useEffect(fit);
  if (!url) return null;
  return (
    <img
      ref={imgRef}
      src={url}
      alt=""
      draggable={false}
      className={size?.crisp ? "crisp" : undefined}
      style={size ? { width: size.w, height: size.h } : undefined}
      onLoad={fit}
    />
  );
}

/** inventry.c: a grid of 40x40 boxes; in-use items sit on the yellow sun (inuse.bmp). */
export function Inventory({
  session, icons, assets, onLookItem, onDropItem, onApplyItem, onPut, onTabOut, selecting, onSelectObject, showAmounts, tooltips,
  hidden, minCells = 0, onDropOnGrid,
}: {
  /** Ours (the Modern interface's bag): items not shown here (those on the paper doll) */
  hidden?: ReadonlySet<number>;
  /** Ours: empty boxes after the items, up to this many cells in all */
  minCells?: number;
  /** Ours: an item from the paper doll dropped in the bag (taking it off) */
  onDropOnGrid?: (id: number) => void;
  /** Our item names on hover, with Show tooltips */
  tooltips: boolean;
  /** Show amounts for inventory items (config.inventory_num) */
  showAmounts: boolean;
  session: GameSession;
  icons: IconRenderer;
  assets: AssetStore;
  onLookItem: (o: ObjectInfo) => void;
  onDropItem: (o: ObjectInfo) => void;
  onApplyItem: (o: ObjectInfo) => void;
  onPut: () => void;
  onTabOut: (forward: boolean) => void;
  selecting: boolean;
  onSelectObject: (id: number) => void;
}) {
  const world = session.world;
  const [selected, setSelected] = useState<number | null>(null);
  const inUseImg = useKeyedImage(assets.url("ui/inuse.bmp"));
  const items = [...world.inventory.values()].filter((o) => !hidden?.has(o.id));
  const rs = (id: number) => session.resource(id) ?? "";
  const gridRef = useRef<HTMLDivElement>(null);
  // inventry.c A_TOGGLEUSE: an appliable item is used on something; others go in or out of use
  const toggleUse = (o: ObjectInfo) =>
    o.flags & OF_APPLYABLE ? onApplyItem(o) : world.inUse.has(o.id) ? session.unuse(o.id) : session.use(o.id);
  /** inventry.c A_CURSOR*: move the inventory cursor by rows and columns */
  const moveCursor = (from: number, dRow: number, dCol: number) => {
    const grid = gridRef.current;
    const cells = grid ? [...grid.querySelectorAll<HTMLElement>(".inv-item")] : [];
    if (!cells.length) return;
    const cols = Math.max(1, cells.filter((c) => c.offsetTop === cells[0].offsetTop).length);
    const i = Math.max(0, Math.min(items.length - 1, from + dRow * cols + dCol));
    setSelected(items[i].id);
    cells[i]?.focus();
  };
  /** inventry.c inventory_key_table */
  const KEY_MOVES: Record<string, [number, number]> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-1, 1], Home: [-1, -1], PageDown: [1, 1], End: [1, -1],
    Numpad8: [-1, 0], Numpad2: [1, 0], Numpad4: [0, -1], Numpad6: [0, 1], Numpad9: [-1, 1], Numpad7: [-1, -1], Numpad3: [1, 1], Numpad1: [1, -1],
  };
  return (
    <div
      className="inventory-grid"
      ref={gridRef}
      onDragOver={(e) => e.dataTransfer.types.includes("application/x-shards-item") && e.preventDefault()}
      // Ours: dropped on the bag's empty space, an item goes to the end (after the last item, where
      // the server puts it too); one from the paper doll is taken off instead
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData("application/x-shards-item"));
        if (!world.inventory.get(id)) return;
        e.preventDefault();
        e.stopPropagation();
        if (hidden?.has(id)) return onDropOnGrid?.(id);
        const all = [...world.inventory.values()];
        const last = all[all.length - 1];
        const move = last && world.moveInventoryItem(id, last.id);
        if (move) session.inventoryMove(move);
      }}
    >
      {items.map((o) => (
        <div
          key={o.id}
          className={selected === o.id ? "inv-item selected" : "inv-item"}
          style={selected === o.id ? { backgroundImage: `url(${assets.url("ui/icursor.bmp")})` } : undefined}
          title={tooltips ? (isNumberItem(o.id) ? `${o.amount} ` : "") + rs(o.nameRes) : undefined}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-shards-item", String(o.id));
            e.dataTransfer.effectAllowed = "move";
          }}
          // inventry.c: in GAME_SELECT a click picks the item as a spell target
          onClick={() => (selecting ? onSelectObject(o.id) : setSelected(o.id))}
          onDoubleClick={() => !selecting && toggleUse(o)}
          // inventry.c InventoryMoveCurrentItem: dropped on another item, it takes that place
          onDragOver={(e) => e.dataTransfer.types.includes("application/x-shards-item") && e.preventDefault()}
          onDrop={(e) => {
            const id = Number(e.dataTransfer.getData("application/x-shards-item"));
            if (!world.inventory.get(id)) return;
            e.preventDefault();
            e.stopPropagation();
            // From the paper doll: taken off, not moved
            if (hidden?.has(id)) onDropOnGrid?.(id);
            else {
              const move = world.moveInventoryItem(id, o.id);
              if (move) session.inventoryMove(move);
            }
          }}
          // inventry.c: VK_RBUTTON is A_LOOKINVENTORY
          onContextMenu={(e: ReactMouseEvent) => {
            e.preventDefault();
            setSelected(o.id);
            onLookItem(o);
          }}
          onKeyDown={(e) => {
            const index = items.findIndex((x) => x.id === o.id);
            const move = KEY_MOVES[e.code];
            if (move) moveCursor(index, move[0], move[1]);
            else if (e.code === "Space" || e.code === "KeyR" || e.code === "KeyU") toggleUse(o);
            else if (e.code === "KeyL") onLookItem(o);
            else if (e.code === "KeyP") onPut();
            else if (e.key === "Delete") onDropItem(o);
            else if (e.key === "Tab") onTabOut(!e.shiftKey);
            else if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); // A_GOTOMAIN
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          tabIndex={0}
        >
          {world.inUse.has(o.id) && inUseImg && <img className="in-use" src={inUseImg} alt="" draggable={false} />}
          <ObjIcon icons={icons} object={o} />
          {showAmounts && isNumberItem(o.id) && <span className="inv-num">{o.amount}</span>}
        </div>
      ))}
      {Array.from({ length: Math.max(0, minCells - items.length) }, (_, i) => (
        <div key={`empty-${i}`} className="inv-item empty" aria-hidden />
      ))}
    </div>
  );
}

/** statnum.c: name on the left; a bar with the number, or a resource string, on the right. */
export function NumericStats({ stats, rs }: { stats: Statistic[]; rs: (id: number) => string }) {
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

/** statlist.c: icon and "name NN%". */
export function StatList({
  session, icons, group, onLook, onCast, onStudy, studying,
}: {
  session: GameSession;
  icons: IconRenderer;
  group: number;
  onLook: (id: number) => void;
  onCast: (spell: number, numTargets: number) => void;
  /** Ours, the Spells tab only: Study mode's window (or stopping it, while `studying`) */
  onStudy?: () => void;
  studying?: boolean;
}) {
  const world = session.world;
  const [selected, setSelected] = useState<number | null>(null);
  // Ours: the Spells tab's search, by name as shown
  const [search, setSearch] = useState("");
  const stats = world.stats.get(group) ?? [];
  const spells = group === STAT_GROUP.SPELLS;
  const rs = (id: number) => session.resource(id) ?? "";
  const spellFor = (id: number) => world.spells.find((s) => s.object.id === id);
  const wanted = spells ? search.trim().toLowerCase() : "";
  const rows: ReactNode[] = stats.map((s, i) => {
    const l = s.list!;
    if (!l) return null;
    if (wanted && !rs(s.nameRes).toLowerCase().includes(wanted)) return null;
    return (
      <div
        key={`${s.num}:${i}`}
        className={`stat-list-row${selected === i ? " selected" : ""}`}
        onClick={() => setSelected(i)}
        // Ours: a spell dragged onto a quick slot fills it (QuickSlots.tsx Hotbar)
        draggable={group === STAT_GROUP.SPELLS && !!l.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_SPELL, String(l.id));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => {
          if (group === STAT_GROUP.SPELLS && l.id) onCast(l.id, spellFor(l.id)?.numTargets ?? 0);
          else if (l.id) onLook(l.id);
        }}
        // statlist.c StatsListRButton: look at it
        onContextMenu={(e) => {
          e.preventDefault();
          if (!l.id) return;
          setSelected(i);
          onLook(l.id);
        }}
      >
        <ObjIcon icons={icons} object={l.icon ? bareIcon(l.icon) : null} className="list-icon" />
        <span>{`${rs(s.nameRes)} ${l.value}%`}</span>
      </div>
    );
  });
  const shown = rows.filter(Boolean);
  return (
    <div className="stat-list">
      {spells && (
        <div className="spell-search">
          <span className="mk-edit">
            <input
              type="search"
              value={search}
              placeholder="Search spells"
              spellCheck={false}
              aria-label="Search spells"
              onChange={(e) => setSearch(e.target.value)}
              // Esc empties it, then gives the keys back to the game
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (search) setSearch("");
                else e.currentTarget.blur();
              }}
            />
          </span>
          {onStudy && (
            <Button onClick={onStudy} title={studying ? "Stop practising" : "Practise a spell while you're away"}>
              {studying ? "Stop" : "Study"}
            </Button>
          )}
        </div>
      )}
      {shown.length ? shown : <div className="stat-list-row muted">{wanted ? "No spells match" : "—"}</div>}
    </div>
  );
}
