// Our title bar. On the desktop it replaces the system's (the window has no frame), so it
// moves the window when dragged, maximizes on a double click, and has the minimize,
// maximize and close buttons (macOS keeps its own traffic lights on the left instead).
// In the game it also has the ☰ menu, the room's name (the original's "Meridian 59 ---
// The Inn of Raza" title) and the latency meter (lagbox.c).

import { useEffect, useState, type ReactNode } from "react";
import type { AssetStore } from "../assets.ts";
import { desktop, isAndroid, type DesktopWindowState } from "../host.ts";

export interface TitleBarMenuItem {
  label: string;
  onSelect?: () => void;
  /** A submenu (the original's Actions and Spells menus) */
  items?: TitleBarMenuItem[];
  /** A line between groups of items */
  separator?: boolean;
  /** A check mark (CheckMenuItem), as on the chosen language */
  checked?: boolean;
}

/** The ☰ menu's items, submenus opening beside them (on hover or keyboard focus). */
function MenuList({ items, onDone, className }: { items: TitleBarMenuItem[]; onDone: () => void; className: string }) {
  return (
    <ul className={className} role="menu">
      {items.map((m, i) =>
        m.separator ? (
          <li key={`sep${i}`} role="separator" className="menu-separator" />
        ) : (
          <li key={`${m.label}${i}`} role="none" className={m.items ? "has-submenu" : undefined}>
            <button
              type="button"
              role={m.checked !== undefined ? "menuitemradio" : "menuitem"}
              aria-checked={m.checked}
              aria-haspopup={m.items ? "menu" : undefined}
              onClick={() => {
                if (m.items) return;
                onDone();
                m.onSelect?.();
              }}
            >
              {m.checked !== undefined && <span className="menu-check">{m.checked ? "✓" : ""}</span>}
              {m.label}
              {m.items && <span className="submenu-arrow">▸</span>}
            </button>
            {m.items && <MenuList items={m.items} onDone={onDone} className="title-menu title-submenu" />}
          </li>
        ),
      )}
    </ul>
  );
}

/** lagbox.c s_adwLatencyMetric (round trip, ms) and IDS_LATENCY0..8. */
const LATENCY_METRICS: [number, string][] = [
  [100, "very fast connection"],
  [250, "fast connection"],
  [500, "somewhat fast connection"],
  [750, "above average connection"],
  [1000, "average connection"],
  [2000, "below average connection"],
  [4000, "somewhat poor connection"],
  [8000, "poor connection"],
  [Infinity, "very poor connection"],
];

/** The meter's colour: green to 250 ms, yellow to 750 ms, red beyond (lagbox.c's green, gold and orange-to-red bands). */
export function latencyLevel(ms: number): "good" | "fair" | "poor" {
  return ms <= 250 ? "good" : ms <= 750 ? "fair" : "poor";
}

/** "fast connection: approximately 73ms latency" (IDS_LATENCYMETRIC). */
export function latencyText(ms: number): string {
  const label = LATENCY_METRICS.find(([max]) => ms <= max)![1];
  return `${label}: approximately ${ms}ms latency`;
}

function WindowButtons() {
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  useEffect(() => desktop?.onWindowState(setState), []);
  const d = desktop;
  if (!d) return null;
  return (
    <div className="window-buttons">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => d.windowControl("minimize")}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M1 5.5h8" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={state.maximized || state.fullscreen ? "Restore" : "Maximize"}
        title={state.fullscreen ? "Leave fullscreen" : state.maximized ? "Restore" : "Maximize"}
        onClick={() => d.windowControl("maximize")}
      >
        <svg viewBox="0 0 10 10" aria-hidden>
          {state.maximized || state.fullscreen ? <path d="M3 1h6v6M1 3h6v6H1z" /> : <path d="M1 1h8v8H1z" />}
        </svg>
      </button>
      <button type="button" className="close" aria-label="Log off and close" title="Log off and close" onClick={() => d.windowControl("close")}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar({
  assets, title, menu, latency, tooltips = true, className,
}: {
  /** For the flower icon (ui/icon1.ico); none before the assets load */
  assets?: AssetStore | null;
  title: string;
  menu?: TitleBarMenuItem[];
  /** The latency meter: a round trip in ms, null while waiting for the first echo, undefined for no meter */
  latency?: number | null;
  /** Show tooltips: the latency meter's (lagbox.c TTN_NEEDTEXT) */
  tooltips?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".title-menu, .menu-button")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const frameless = !!desktop && !isAndroid;
  const ownButtons = frameless && desktop?.platform !== "darwin";
  return (
    <header
      className={`title-bar${frameless ? " frameless" : ""}${desktop?.platform === "darwin" ? " mac" : ""} ${className ?? ""}`}
    >
      {assets && <img className="title-icon" src={assets.url("ui/icon1.ico")} alt="" draggable={false} />}
      {menu && (
        <button type="button" className={`menu-button${open ? " open" : ""}`} aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          ☰
        </button>
      )}
      <span className="title-text">{title}</span>
      <span className="title-spacer" />
      {latency !== undefined && <LatencyMeter ms={latency} tooltip={tooltips} />}
      {ownButtons && <WindowButtons />}
      {open && menu && <MenuList items={menu} onDone={() => setOpen(false)} className="title-menu" />}
    </header>
  );
}

function LatencyMeter({ ms, tooltip }: { ms: number | null; tooltip: boolean }) {
  const text = ms === null ? "Measuring latency…" : latencyText(ms);
  return (
    <span className={`latency ${ms === null ? "waiting" : latencyLevel(ms)}`} aria-label={text} tabIndex={0}>
      {tooltip && (
        <span className="latency-tip" role="tooltip">
          {ms === null ? text : `${ms} ms: ${text.split(":")[0]}`}
        </span>
      )}
    </span>
  );
}

/** A page under the title bar on the desktop (the login, character and loading screens); just the page in a browser or on Android. */
export function Framed({ assets, children }: { assets?: AssetStore | null; children: ReactNode }) {
  if (!desktop || isAndroid) return <>{children}</>;
  return (
    <div className="app-frame">
      <TitleBar assets={assets} title="Meridian Shards" />
      <div className="app-frame-body">{children}</div>
    </div>
  );
}
