// Ours: the Help window (F1, the "help" command, the ☰ menu's Help…, the Classic toolbar's Help
// button). The original's help went to a web page; ours is three tabs:
//   Controls   the keyboard and the mouse as the player has them bound now (keyboardLayout.ts),
//              and the phone's gestures on a phone
//   HUD        a picture of the player's own screen (gameSnapshot.ts) with each part numbered
//              and said what it does; it follows the interface in use (Modern, Classic, phone)
//   Interface  every menu and window, and what it's for
// Its words are help.json (apps/client/tables, served with the game's files: clientTables.ts).

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { mouseCode, type Settings } from "../settings.ts";
import { Button, Tabs, Window } from "./kit.tsx";
import { MAIN_ROWS, NAV_ROWS, NUMPAD_ROWS, keyUses, numpadNeeded, type KeyCap, type KeyRow, type KeyUse } from "./keyboardLayout.ts";
import { loadBackgrounds, placeOf, snapshotGame, type SnapRect } from "./gameSnapshot.ts";
import { helpTable, type HelpItem, type HelpLayout } from "../clientTables.ts";

const HELP_TABS = ["Controls", "HUD", "Interface"] as const;
type HelpTab = (typeof HELP_TABS)[number];

/** The colour of each Configuration tab's keys, and the hotkey aliases' */
const GROUPS: { key: KeyUse["group"]; label: string; color: string }[] = [
  { key: "Movement", label: "Movement", color: "#4f9fe8" },
  { key: "Interaction", label: "Interaction", color: "#e0a030" },
  { key: "Targeting", label: "Targeting", color: "#e05050" },
  { key: "Communication", label: "Communication", color: "#5ec46e" },
  { key: "Interface", label: "Interface and quick slots", color: "#b07ae0" },
  { key: "Map", label: "Map", color: "#40c8c0" },
  { key: "alias", label: "Hotkey aliases", color: "#a0a0a0" },
];
const COLOR = new Map(GROUPS.map((g) => [g.key, g.color]));

export function HelpDialog({
  settings, layout, admin, captureView, getRoot, onConfiguration, onClose,
}: {
  settings: Settings;
  layout: HelpLayout;
  /** An admin character: the admin console is mentioned */
  admin: boolean;
  /** The 3D view's next frame (GameScene.captureView), for the HUD picture */
  captureView: () => Promise<HTMLCanvasElement | null>;
  /** The game's element, for the HUD picture */
  getRoot: () => HTMLElement | null;
  /** Opens the Configuration window (and closes Help) */
  onConfiguration: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<HelpTab>("Controls");
  return (
    <div className="mk-modal options-modal help-modal">
      <Window title="Help" onClose={onClose} className="options-dialog help-dialog">
        <div className="bind-layout">
          <Tabs tabs={HELP_TABS} active={tab} onChange={setTab} />
          <div className="mk-page help-page" key={tab}>
            {tab === "Controls" && <ControlsPage settings={settings} layout={layout} onConfiguration={onConfiguration} />}
            {tab === "HUD" && <HudPage layout={layout} captureView={captureView} getRoot={getRoot} />}
            {tab === "Interface" && <InterfacePage layout={layout} admin={admin} />}
          </div>
          <div className="help-buttons">
            <Button onClick={onClose} isDefault>
              Close
            </Button>
          </div>
        </div>
      </Window>
    </div>
  );
}

// ---------------------------------------------------------------------------- Controls

function ControlsPage({ settings, layout, onConfiguration }: { settings: Settings; layout: HelpLayout; onConfiguration: () => void }) {
  const uses = useMemo(
    () => keyUses(settings.keys, settings.hotkeyAliases, layout === "modern" && settings.secondHotbar),
    [settings.keys, settings.hotkeyAliases, settings.secondHotbar, layout],
  );
  const [focus, setFocus] = useState<KeyUse["group"] | null>(null);
  return (
    <div className="help-controls">
      {layout === "touch" && <TouchGestures />}
      <section className="help-section">
        <h3>Keyboard</h3>
        <p className="help-note">
          Your keys as they're set now ({settings.preset === "original" ? "the original's layout" : "the modern layout"}, with your changes). Point at a
          key to see all it does; point at a colour to pick out its keys.
        </p>
        <Keyboard uses={uses} focus={focus} />
        <ul className="kb-legend">
          {GROUPS.map((g) => (
            <li key={g.key} onMouseEnter={() => setFocus(g.key)} onMouseLeave={() => setFocus(null)} style={{ "--c": g.color } as CSSProperties}>
              <i />
              {g.label}
            </li>
          ))}
        </ul>
        <p className="help-note">
          Some keys work whatever the bindings: Esc closes the top window, Enter in the chat line sends it, and while the chat line has the keyboard,
          keys type into it. {settings.typeToChat ? "With Quick Chat on, typing a letter no key uses starts a chat line." : ""}
        </p>
      </section>
      <section className="help-section">
        <h3>Mouse</h3>
        <MouseDiagram settings={settings} layout={layout} uses={uses} />
      </section>
      <div className="help-row">
        <Button onClick={onConfiguration}>Change keys…</Button>
        <span className="help-note">Configuration (☰ → Configuration…)</span>
      </div>
    </div>
  );
}

function Keyboard({ uses, focus }: { uses: Map<string, KeyUse[]>; focus: KeyUse["group"] | null }) {
  const block = (rows: KeyRow[], cls: string) => (
    <div className={`kb-block ${cls}`}>
      {rows.map((row, i) => (
        <div className="kb-row" key={i}>
          {row.map((k, j) =>
            "gap" in k ? <span key={j} className="kb-gap" style={{ "--kw": k.gap } as CSSProperties} /> : <Key key={k.code} cap={k} uses={uses.get(k.code)} focus={focus} />,
          )}
        </div>
      ))}
    </div>
  );
  const pad = numpadNeeded(uses);
  return (
    <div className="kb">
      <div className={pad ? "kb-board with-pad" : "kb-board"}>
        {block(MAIN_ROWS, "kb-main")}
        {block(NAV_ROWS, "kb-nav")}
        {pad && block(NUMPAD_ROWS, "kb-pad")}
      </div>
    </div>
  );
}

function Key({ cap, uses, focus }: { cap: KeyCap; uses: KeyUse[] | undefined; focus: KeyUse["group"] | null }) {
  const list = uses ?? [];
  const first = list[0];
  const dim = focus !== null && !list.some((u) => u.group === focus);
  const title = list.length ? `${cap.cap}: ${list.map((u) => (u.mods ? `${u.mods}+${cap.cap}: ` : "") + u.label).join("; ")}` : `${cap.cap}: nothing`;
  return (
    <span
      className={`kb-key${list.length ? " bound" : ""}${dim ? " dim" : ""}`}
      style={{ "--kw": cap.w ?? 1, "--c": first ? COLOR.get(first.group) : undefined } as CSSProperties}
      title={title}
    >
      <b>{cap.cap}</b>
      {first && (
        <small style={{ color: COLOR.get(first.group) }}>
          {first.mods ? `${first.mods}: ` : ""}
          {first.short}
        </small>
      )}
      {list.length > 1 && <i className="kb-more">+{list.length - 1}</i>}
    </span>
  );
}

/** The mouse: each button with what it does (its bindings, and what the game does with it anyway) */
function MouseDiagram({ settings, layout, uses }: { settings: Settings; layout: HelpLayout; uses: Map<string, KeyUse[]> }) {
  const bound = (button: number) => (uses.get(mouseCode(button)) ?? []).map((u) => (u.mods ? `${u.mods}+click: ${u.label}` : u.label));
  const modern = layout === "modern";
  const parts: { n: number; name: string; lines: string[] }[] = [
    {
      n: 1,
      name: "Left button",
      lines: [
        ...bound(0).map((l) => (l === "Select Target" ? "Click a player or monster: target it" : `Click: ${l}`)),
        "Double click: use it (open a door, talk to a shopkeeper, use an item)",
        "Drag an item from the world to the inventory: pick it up",
        "Drag spells and items to the hotbar",
      ],
    },
    {
      n: 2,
      name: "Right button",
      lines: [
        "Hold and drag: turn the view (and the camera, outside first person)",
        ...bound(2).map((l) => (l === "Examine" ? "Click: look at what's under the cursor" : `Click: ${l}`)),
        "Click the inventory, a spell or your face: look at it",
        "Click the map: write a note there",
      ],
    },
    {
      n: 3,
      name: "Wheel",
      lines: modern
        ? ["Roll back: out of your eyes to the chase camera, then farther", "Roll forward: nearer, then back to your eyes", ...bound(1).map((l) => `Middle click: ${l}`)]
        : ["Scrolls lists and the chat", "The camera views are the Modern interface's", ...bound(1).map((l) => `Middle click: ${l}`)],
    },
    { n: 4, name: "Side buttons", lines: [...bound(3).map((l) => `Back: ${l}`), ...bound(4).map((l) => `Forward: ${l}`)] },
  ];
  if (!parts[3].lines.length) parts[3].lines.push("Nothing yet: bind them in Configuration");
  const tag = (n: number) => <span className="mouse-tag">{n}</span>;
  return (
    <div className="mouse-help">
      <svg viewBox="0 0 120 180" className="mouse-svg" aria-hidden>
        <path className="mouse-body" d="M60 6 C28 6 12 30 12 64 V118 C12 152 34 174 60 174 C86 174 108 152 108 118 V64 C108 30 92 6 60 6 Z" />
        <path className="mouse-button" d="M58 8 C31 9 15 30 14 62 V70 H58 Z" />
        <path className="mouse-button" d="M62 8 C89 9 105 30 106 62 V70 H62 Z" />
        <rect className="mouse-wheel" x="53" y="22" width="14" height="30" rx="7" />
        <rect className="mouse-side" x="8" y="84" width="7" height="14" rx="2" />
        <rect className="mouse-side" x="8" y="102" width="7" height="14" rx="2" />
        {[
          [36, 42, 1],
          [84, 42, 2],
          [60, 37, 3],
          [26, 100, 4],
        ].map(([x, y, n]) => (
          <g key={n} className="mouse-marker">
            <circle cx={x} cy={y} r="8" />
            <text x={x} y={y + 0.5}>
              {n}
            </text>
          </g>
        ))}
      </svg>
      <dl className="mouse-list">
        {parts.map((p) => (
          <div key={p.n}>
            <dt>
              {tag(p.n)} {p.name}
            </dt>
            {p.lines.map((l, i) => (
              <dd key={i}>{l}</dd>
            ))}
          </div>
        ))}
      </dl>
      {settings.attackOnTarget && <p className="help-note">Attack On Target is on: targeting a monster also attacks it.</p>}
    </div>
  );
}

/** On a phone: the touches the view and the buttons take */
function TouchGestures() {
  return (
    <section className="help-section">
      <h3>Touch</h3>
      <HelpDefs items={helpTable().touch} />
    </section>
  );
}

/** Terms and what they mean */
function HelpDefs({ items }: { items: HelpItem[] }) {
  return (
    <dl className="help-defs">
      {items.map((i) => (
        <Fragment key={i.term}>
          <dt>{i.term}</dt>
          <dd>{i.text}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------- HUD

interface Placed {
  n: number;
  title: string;
  text: string;
  rects: SnapRect[];
  /** Each rect's number, picture pixels (nudged apart where they'd overlap) */
  badges?: { x: number; y: number }[];
}

/** A number badge's size on the picture, in the picture's pixels, given how wide it's shown */
const BADGE_PX = 22;

/** Puts each box's number at its top left corner, moved right (then down) off any placed before */
function placeBadges(parts: Placed[], scale: number): void {
  const step = BADGE_PX / scale;
  const placed: { x: number; y: number }[] = [];
  for (const p of parts)
    p.badges = p.rects.map((r) => {
      let x = r.x,
        y = r.y;
      for (let tries = 0; tries < 12 && placed.some((b) => Math.abs(b.x - x) < step && Math.abs(b.y - y) < step); tries++) {
        x += step;
        if (x > r.x + r.w) {
          x = r.x;
          y += step;
        }
      }
      placed.push({ x, y });
      return { x, y };
    });
}

function HudPage({
  layout, captureView, getRoot,
}: {
  layout: HelpLayout;
  captureView: () => Promise<HTMLCanvasElement | null>;
  getRoot: () => HTMLElement | null;
}) {
  const [shot, setShot] = useState<{ url: string; w: number; h: number; parts: Placed[] } | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const take = useCallback(async () => {
    const root = getRoot();
    if (!root) return;
    // The next frame's view; a second at most (a hidden page may draw none)
    const [view, backgrounds] = await Promise.all([
      Promise.race([captureView(), new Promise<null>((r) => setTimeout(() => r(null), 1000))]),
      loadBackgrounds(root),
    ]);
    // The Modern chat shown as if pointed at, while the picture's taken (it fades when idle)
    const chat = root.querySelector(".chat");
    chat?.classList.add("help-shown");
    const canvas = snapshotGame(root, view, (el) => el.classList.contains("help-modal"), backgrounds);
    const parts: Placed[] = [];
    // The hands are in the picture but not numbered: players know them
    const { view: viewPart, parts: hudParts } = helpTable().hud;
    for (const p of hudParts) {
      let rect: SnapRect | null = null;
      for (const s of p.sel) if ((rect = placeOf(root, root.querySelector(s)))) break;
      if (rect) parts.push({ n: 0, title: p.title, text: p.text, rects: [rect] });
    }
    // The view itself, under everything
    const view3d = placeOf(root, root.querySelector("canvas.viewport"));
    if (view3d) parts.unshift({ n: 0, title: viewPart.title, text: viewPart.text, rects: [{ ...view3d, x: view3d.x + view3d.w * 0.42, y: view3d.y + view3d.h * 0.3, w: view3d.w * 0.16, h: view3d.h * 0.12 }] });
    chat?.classList.remove("help-shown");
    parts.forEach((p, i) => (p.n = i + 1));
    // As wide as the page shows it
    placeBadges(parts, (root.ownerDocument.querySelector(".help-page")?.clientWidth ?? canvas.width) / canvas.width);
    setShot({ url: canvas.toDataURL(), w: canvas.width, h: canvas.height, parts });
  }, [getRoot, captureView]);
  // Once the window is drawn (it's left out of the picture)
  useEffect(() => {
    const t = setTimeout(() => void take(), 0);
    return () => clearTimeout(t);
  }, [take]);
  if (!shot) return <p className="help-note">Taking a picture of your screen…</p>;
  const pct = (r: SnapRect) => ({ left: `${(r.x / shot.w) * 100}%`, top: `${(r.y / shot.h) * 100}%`, width: `${(r.w / shot.w) * 100}%`, height: `${(r.h / shot.h) * 100}%` });
  return (
    <div className="help-hud">
      <p className="help-note">
        Your screen as it is now ({layout === "modern" ? "the Modern interface" : layout === "classic" ? "the Classic interface" : "the phone's"}). Point at a number
        or a line below to find it.{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), void take())}>
          Take it again
        </a>
      </p>
      <div className="hud-shot" style={{ aspectRatio: `${shot.w} / ${shot.h}` }}>
        <img src={shot.url} alt="Your screen" />
        {shot.parts.map((p) =>
          p.rects.map((r, i) => {
            const b = p.badges?.[i] ?? r;
            const enter = () => setHot(p.n);
            const leave = () => setHot(null);
            return (
              <span key={`${p.n}.${i}`}>
                <span className={`hud-box${hot === p.n ? " hot" : ""}`} style={pct(r)} onMouseEnter={enter} onMouseLeave={leave} />
                <span
                  className={`hud-num on-shot${hot === p.n ? " hot" : ""}`}
                  style={{ left: `${(b.x / shot.w) * 100}%`, top: `${(b.y / shot.h) * 100}%` }}
                  onMouseEnter={enter}
                  onMouseLeave={leave}
                >
                  {p.n}
                </span>
              </span>
            );
          }),
        )}
      </div>
      <ol className="hud-legend">
        {shot.parts.map((p) => (
          <li key={p.n} className={hot === p.n ? "hot" : undefined} onMouseEnter={() => setHot(p.n)} onMouseLeave={() => setHot(null)}>
            <span className="hud-num">{p.n}</span>
            <span>
              <b>{p.title}.</b> {p.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------- Interface

function InterfacePage({ layout, admin }: { layout: HelpLayout; admin: boolean }) {
  const shows = (i: HelpItem) => (!i.admin || admin) && (!i.layouts || i.layouts.includes(layout));
  return (
    <div className="help-interface">
      {helpTable().interface.map((section) => (
        <section className="help-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.note && <p className="help-note">{section.note[layout]}</p>}
          <HelpDefs items={section.items.filter(shows)} />
        </section>
      ))}
    </div>
  );
}
