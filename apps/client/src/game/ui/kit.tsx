// The Meridian dialog kit: the original client's dialogs (Win32 templates in MS Sans Serif 8,
// laid out in dialog units) drawn with the game's own interface art instead of grey Windows
// chrome:
//   the backdrop: bkgnd.bmp tiled, as DrawWindowBackground paints it (clientd3d/drawbmp.c)
//   window frames: the stone edge treatment around the game window (merintr/drawint.c
//     ELEMENT_E*: L-shaped corners of two bitmaps each, repeat strips between them)
//   text fields and lists: the chat box's edit treatment (drawint.c ELEMENT_B*)
//   titles: the Heidelberg face (font.c FONT_TITLES); body text Times (FONT_LIST, FONT_INPUT)
//   stat bars: the BlakGraph control (clientd3d/graphctl.c)
// Layout is in dialog units straight from the .rc templates, scaled by --s per window.

import {
  useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import type { AssetStore } from "../../assets.ts";
import { fixCmapLanguages } from "./font.ts";
import { GRAPH_SIDE_BORDER, GRAPH_SLIDER_HEIGHT, graphFraction, graphValueAt } from "./graph.ts";
import { keyOut } from "./keyed.ts";
import "./kit.css";

/** A rectangle in dialog units: x, y, width, height (from a DIALOG template). */
export type Rect = readonly [number, number, number, number];

/** MS Sans Serif 8 at 96 dpi: a dialog unit is 1.5 px across and 1.625 px down. */
const DLU_X = 1.5;
const DLU_Y = 1.625;
const MAX_SCALE = 1.5;
const MIN_SCALE = 0.6;
const FLOW_SCALE = 1.3;
/**
 * Pixels around a window body: its padding inside the edge treatment (intrface.h
 * EDGETREAT_WIDTH/HEIGHT 16), the title strip and the backdrop's margin.
 */
const CHROME_X = 20 + 20 + 2 * 12;
const CHROME_Y = 16 + 20 + 34 + 2 * 12;

/** CSS for a control placed at `r` (dialog units) inside a dialog body. */
export function at(r: Rect): CSSProperties {
  const [x, y, w, h] = r;
  return {
    position: "absolute",
    left: `calc(var(--dx) * ${x})`,
    top: `calc(var(--dy) * ${y})`,
    width: `calc(var(--dx) * ${w})`,
    height: `calc(var(--dy) * ${h})`,
  };
}

// ---- theme: the bitmaps and the font, as CSS variables ----

/** drawint.c ELEMENT_E*: the edge treatment's corner halves and repeat strips (merintr.rc IDB_E*) */
const EDGE_PIECES = ["ultop", "ulleft", "urtop", "urright", "llbottom", "llleft", "lrbottom", "lrright", "urepeat", "brepeat", "lrepeat", "rrepeat"];
/** merintr.rc IDB_B*: the edit box treatment (the top corners reuse the top repeat; the bottom is stripped off) */
const EDIT_PIECES = ["ulleft", "urright", "llleft", "lrright", "urepeat", "lrepeat", "rrepeat"];

let installed = false;

/** Points the kit's CSS variables at the asset build's bitmaps and loads the title font. Call once. */
export function installUiTheme(assets: AssetStore): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement.style;
  const url = (name: string) => `url("${assets.url(`ui/${name}`)}")`;
  root.setProperty("--ui-bkgnd", url("bkgnd.bmp"));
  root.setProperty("--ui-invbkgnd", url("invbkgnd.bmp"));
  for (const p of EDIT_PIECES) root.setProperty(`--ui-b-${p}`, url(`edittreat_${p}.bmp`));
  // The edge treatment is drawn transparently: its cyan shows what's behind
  for (const p of EDGE_PIECES) {
    void keyOut(assets.url(`ui/edgetreat_${p}.bmp`)).then((u) => root.setProperty(`--ui-e-${p}`, `url("${u}")`));
  }
  if (assets.has("ui/heidelb1.ttf")) {
    assets
      .fetchBytes("ui/heidelb1.ttf")
      .then((b) => new FontFace("Heidelberg", fixCmapLanguages(b)).load())
      .then((f) => document.fonts.add(f))
      .catch(() => {
        // Georgia stands in
      });
  }
}

// ---- Escape closes the topmost window only ----

const escapeStack: { current: () => void }[] = [];

function useEscape(fn: (() => void) | undefined) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  const enabled = !!fn;
  useEffect(() => {
    if (!enabled) return;
    const entry = { current: () => ref.current?.() };
    escapeStack.push(entry);
    return () => {
      escapeStack.splice(escapeStack.indexOf(entry), 1);
    };
  }, [enabled]);
}

// (no window in tests)
globalThis.window?.addEventListener("keydown", (e) => {
  // The game's own Escape handling (clearing the target) may have seen it first; close anyway
  if (e.key !== "Escape" || !escapeStack.length) return;
  e.preventDefault();
  escapeStack[escapeStack.length - 1].current();
});

// ---- frames and windows ----

/** The full page behind the pre-game dialogs: bkgnd.bmp tiled on black (color.c COLOR_BGD). */
export function Backdrop({ children }: { children: ReactNode }) {
  return <div className="mk-backdrop">{children}</div>;
}

/** drawint.c's edge treatment around a box: four L-shaped corners and four repeat strips. */
export function EdgeFrame() {
  return (
    <div className="mk-edge" aria-hidden>
      {EDGE_PIECES.map((p) => (
        <i key={p} className={`mk-e-${p}`} />
      ))}
    </div>
  );
}

/** The scale that fits a body of w x h dialog units in the browser window, up to MAX_SCALE. */
function useDluScale(dlu: readonly [number, number] | undefined): number {
  const fit = () => {
    // Windows laid out by the page (not a template) get text the size of the in-game panels
    if (!dlu) return FLOW_SCALE;
    const s = Math.min((innerWidth - CHROME_X) / (dlu[0] * DLU_X), (innerHeight - CHROME_Y) / (dlu[1] * DLU_Y), MAX_SCALE);
    return Math.max(MIN_SCALE, Math.floor(s * 20) / 20);
  };
  const [s, setS] = useState(fit);
  useEffect(() => {
    const onResize = () => setS(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlu?.[0], dlu?.[1]]);
  return s;
}

/**
 * A dialog: the edge treatment around a dark stone body with a Heidelberg title strip.
 * With `dlu` the body is that many dialog units and children are placed with `at()`.
 */
export function Window({
  title, onClose, dlu, className, style, children,
}: {
  title: string;
  /** The X button and Escape */
  onClose?: () => void;
  dlu?: readonly [number, number];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const s = useDluScale(dlu);
  useEscape(onClose);
  const vars = { "--s": s, ...style } as CSSProperties;
  return (
    <div className={`mk-window ${className ?? ""}`} style={vars} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <EdgeFrame />
      <div className="mk-title">
        <span>{title}</span>
        {onClose && (
          <button type="button" className="mk-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div className={dlu ? "mk-body dlu" : "mk-body"} style={dlu ? { width: `calc(var(--dx) * ${dlu[0]})`, height: `calc(var(--dy) * ${dlu[1]})` } : undefined}>
        {children}
      </div>
    </div>
  );
}

// ---- controls ----

/** LTEXT: one line by default; `wrap` for a multi-line static. */
export function Text({ at: r, wrap, className, children }: { at?: Rect; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`mk-text${wrap ? " wrap" : ""} ${className ?? ""}`} style={r ? at(r) : undefined}>
      {children}
    </div>
  );
}

/** PUSHBUTTON / DEFPUSHBUTTON: a stone bevel. */
export function Button({
  at: r, isDefault, disabled, onClick, type = "button", className, title, children,
}: {
  at?: Rect;
  isDefault?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={`mk-btn${isDefault ? " default" : ""} ${className ?? ""}`}
      style={r ? at(r) : undefined}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

/** EDITTEXT: Times (font.c FONT_INPUT) in the edit treatment. */
export function TextField({
  at: r, value, onChange, password, autoFocus, maxLength, autoComplete, className, type = "text", min, max,
}: {
  at?: Rect;
  value: string | number;
  onChange: (v: string) => void;
  password?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  autoComplete?: string;
  className?: string;
  type?: "text" | "number" | "password";
  min?: number;
  max?: number;
}) {
  return (
    <span className={`mk-edit ${className ?? ""}`} style={r ? at(r) : undefined}>
      <input
        type={password ? "password" : type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        maxLength={maxLength}
        autoComplete={autoComplete}
        min={min}
        max={max}
        spellCheck={false}
      />
    </span>
  );
}

/** EDITTEXT with ES_MULTILINE (read-only for the message of the day). */
export function TextArea({
  at: r, value, onChange, readOnly, maxLength,
}: {
  at?: Rect;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  maxLength?: number;
}) {
  return (
    <span className={`mk-edit area${readOnly ? " readonly" : ""}`} style={r ? at(r) : undefined}>
      <textarea value={value} readOnly={readOnly} maxLength={maxLength} onChange={(e) => onChange?.(e.target.value)} spellCheck={false} />
    </span>
  );
}

/** COMBOBOX with CBS_DROPDOWNLIST: a native drop-down in the edit treatment. */
export function Select<K extends string>({
  at: r, value, options, onChange,
}: {
  at?: Rect;
  value: K;
  options: readonly { key: K; label: string }[];
  onChange: (v: K) => void;
}) {
  return (
    <span className="mk-edit" style={r ? at(r) : undefined}>
      <select value={value} onChange={(e) => onChange(e.target.value as K)}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export interface ListItem<K> {
  key: K;
  label: ReactNode;
  className?: string;
}

/**
 * LISTBOX, owner-drawn like the client's lists (ownerdrw.c): Times on black, the selection
 * black on white (color.c COLOR_LISTFGD/BGD, COLOR_LISTSELFGD/BGD). Enter or a double click
 * activates the selected row.
 */
export function ListBox<K extends string | number>({
  at: r, items, selected, onSelect, onActivate, autoFocus, className, label,
}: {
  at?: Rect;
  items: ListItem<K>[];
  selected: K | null;
  onSelect: (k: K) => void;
  onActivate?: (k: K) => void;
  autoFocus?: boolean;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const index = items.findIndex((i) => i.key === selected);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    ref.current?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const onKey = (e: ReactKeyboardEvent) => {
    const go = (i: number) => {
      e.preventDefault();
      if (items.length) onSelect(items[Math.max(0, Math.min(items.length - 1, i))].key);
    };
    if (e.key === "ArrowDown") go(index + 1);
    else if (e.key === "ArrowUp") go(index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Enter" && selected !== null && index >= 0 && onActivate) {
      e.preventDefault();
      onActivate(selected);
    }
  };
  return (
    <span className={`mk-edit list ${className ?? ""}`} style={r ? at(r) : undefined}>
      <ul ref={ref} className="mk-list" tabIndex={0} role="listbox" aria-label={label} onKeyDown={onKey}>
        {items.map((i) => (
          <li
            key={i.key}
            role="option"
            aria-selected={i.key === selected}
            className={`${i.key === selected ? "selected" : ""} ${i.className ?? ""}`}
            onMouseDown={() => onSelect(i.key)}
            onDoubleClick={() => onActivate?.(i.key)}
          >
            {i.label}
          </li>
        ))}
      </ul>
    </span>
  );
}

/** GROUPBOX: an etched frame with its caption. */
export function GroupBox({ at: r, label, className, children }: { at?: Rect; label: string; className?: string; children?: ReactNode }) {
  return (
    <fieldset className={`mk-group ${className ?? ""}`} style={r ? at(r) : undefined}>
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

/** BS_AUTORADIOBUTTON / BS_AUTOCHECKBOX */
export function Check({
  at: r, label, checked, onChange, radio, name, disabled, title, className,
}: {
  at?: Rect;
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  radio?: boolean;
  name?: string;
  /** WS_DISABLED: greyed out */
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <label className={`mk-check${disabled ? " disabled" : ""} ${className ?? ""}`} style={r ? at(r) : undefined} title={title}>
      <input type={radio ? "radio" : "checkbox"} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** msctls_trackbar32 with TBS_AUTOTICKS: a tick under every position. */
export function Trackbar({
  at: r, min, max, step = 1, value, onChange, label, ticks = true,
}: {
  at?: Rect;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  label?: string;
  ticks?: boolean;
}) {
  const n = Math.round((max - min) / step);
  return (
    <span className={ticks ? "mk-track" : "mk-track no-ticks"} style={r ? at(r) : undefined}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      {ticks && n > 0 && n <= 64 && (
        <span className="ticks" aria-hidden>
          {Array.from({ length: n + 1 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 100) / n}%` }} />
          ))}
        </span>
      )}
    </span>
  );
}

/** Property sheet tabs: raised buttons over the page. */
export function Tabs<T extends string>({
  at: r, tabs, active, onChange,
}: {
  at?: Rect;
  tabs: readonly T[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="mk-tabs" role="tablist" style={r ? at(r) : undefined}>
      {tabs.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={t === active} className={t === active ? "active" : ""} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** color.c: COLOR_BAR1 (stat bars), COLOR_BAR2 (points left), COLOR_BAR3 (the empty part) */
const GRAPH_COLORS = { stat: "rgb(0, 128, 0)", points: "rgb(128, 0, 0)" } as const;

/**
 * The BlakGraph control (graphctl.c GraphCtlPaint): a black frame, the bar, the empty part,
 * the value in Arial bold past the bar's end (or inside it when there's no room), and for input
 * bars a slider triangle under it, filled while focused. Click, drag or the arrow keys set it.
 */
export function GraphBar({
  at: r, value, min, max, onChange, kind = "stat", label,
}: {
  at?: Rect;
  value: number;
  min: number;
  max: number;
  /** GCS_INPUT | GCS_SLIDER: the bar takes input and has the slider */
  onChange?: (v: number) => void;
  kind?: keyof typeof GRAPH_COLORS;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = !!onChange;
  const pct = graphFraction(value, min, max) * 100;
  const text = String(value);
  // GraphCtlPaint: past the bar if the text fits there (Arial bold 9 is about 6 px a digit)
  const [room, setRoom] = useState(true);
  useLayoutEffect(() => {
    const w = ref.current?.querySelector(".mk-graph-bar")?.clientWidth ?? 0;
    setRoom(w - (w * pct) / 100 > text.length * 6 + 2);
  }, [pct, text]);
  const setFrom = (clientX: number) => {
    const el = ref.current;
    if (!el || !onChange) return;
    const b = el.getBoundingClientRect();
    onChange(graphValueAt(clientX - b.left, b.width, min, max, true));
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (!onChange) return;
    if (e.key === "ArrowLeft" || e.key === "-") onChange(Math.max(min, value - 1));
    else if (e.key === "ArrowRight" || e.key === "+") onChange(Math.min(max, value + 1));
    else return;
    e.preventDefault();
  };
  const style = { ...(r ? at(r) : {}), "--bar": GRAPH_COLORS[kind] } as CSSProperties;
  return (
    <div
      ref={ref}
      className={input ? "mk-graph input" : "mk-graph"}
      style={style}
      tabIndex={input ? 0 : undefined}
      role={input ? "slider" : "meter"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (!input) return;
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        setFrom(e.clientX);
      }}
      onPointerMove={(e) => input && e.currentTarget.hasPointerCapture(e.pointerId) && setFrom(e.clientX)}
    >
      <div className="mk-graph-bar" style={input ? { left: GRAPH_SIDE_BORDER, right: GRAPH_SIDE_BORDER, bottom: GRAPH_SLIDER_HEIGHT } : undefined}>
        <div className="fill" style={{ width: `${pct}%` }} />
        <span className={room ? "num" : "num inside"} style={room ? { left: `calc(${pct}% + 1px)` } : { right: `calc(${100 - pct}% + 1px)` }}>
          {text}
        </span>
      </div>
      {input && (
        <svg className="slider" style={{ left: `calc(${GRAPH_SIDE_BORDER}px + (100% - ${2 * GRAPH_SIDE_BORDER}px) * ${pct / 100})` }} width={GRAPH_SLIDER_HEIGHT + 1} height={GRAPH_SLIDER_HEIGHT} aria-hidden>
          <polygon points={`${GRAPH_SLIDER_HEIGHT / 2 + 0.5},0.5 ${GRAPH_SLIDER_HEIGHT + 0.5},${GRAPH_SLIDER_HEIGHT - 0.5} 0.5,${GRAPH_SLIDER_HEIGHT - 0.5}`} />
        </svg>
      )}
    </div>
  );
}

/** The client's message boxes (ClientError, AreYouSure): a small window over everything. */
export function MessageBox({
  text, kind = "ok", defaultNo, onResult,
}: {
  text: ReactNode;
  kind?: "ok" | "yesno";
  /** AreYouSure(..., NO_BUTTON, ...): No is the default */
  defaultNo?: boolean;
  onResult: (yes: boolean) => void;
}) {
  const yesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const buttons = yesRef.current?.querySelectorAll("button");
    if (buttons?.length) (kind === "yesno" && defaultNo ? buttons[1] : buttons[0]).focus();
  }, [kind, defaultNo]);
  return (
    <div className="mk-modal">
      <Window title="Meridian Shards" onClose={() => onResult(false)} className="mk-message">
        <p className="mk-message-text">{text}</p>
        <div className="mk-buttons center" ref={yesRef}>
          {kind === "ok" ? (
            <Button isDefault onClick={() => onResult(true)}>
              OK
            </Button>
          ) : (
            <>
              <Button isDefault={!defaultNo} onClick={() => onResult(true)}>
                Yes
              </Button>
              <Button isDefault={defaultNo} onClick={() => onResult(false)}>
                No
              </Button>
            </>
          )}
        </div>
      </Window>
    </div>
  );
}
