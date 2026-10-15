// Ours: the Help window (F1, the "help" command, the ☰ menu's Help…, the Classic toolbar's Help
// button). The original's help went to a web page; ours is three tabs:
//   Controls   the keyboard and the mouse as the player has them bound now (keyboardLayout.ts),
//              and the phone's gestures on a phone
//   HUD        a picture of the player's own screen (gameSnapshot.ts) with each part numbered
//              and said what it does; it follows the interface in use (Modern, Classic, phone)
//   Interface  every menu and window, and what it's for

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { mouseCode, type Settings } from "../settings.ts";
import { Button, Tabs, Window } from "./kit.tsx";
import { MAIN_ROWS, NAV_ROWS, NUMPAD_ROWS, keyUses, numpadNeeded, type KeyCap, type KeyRow, type KeyUse } from "./keyboardLayout.ts";
import { loadBackgrounds, placeOf, snapshotGame, type SnapRect } from "./gameSnapshot.ts";

const HELP_TABS = ["Controls", "HUD", "Interface"] as const;
type HelpTab = (typeof HELP_TABS)[number];
export type HelpLayout = "modern" | "classic" | "touch";

/** The colour of each Bind Editor tab's keys, and the hotkey aliases' */
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
  /** Opens the Bind Editor (and closes Help) */
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
        <span className="help-note">The Bind Editor (☰ → Configuration…)</span>
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
  if (!parts[3].lines.length) parts[3].lines.push("Nothing yet: bind them in the Bind Editor");
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
      <dl className="help-defs">
        <dt>Joystick (bottom left)</dt>
        <dd>Walk; push it far to run. With the map open, it moves the way the map faces.</dd>
        <dt>Drag the view</dt>
        <dd>Look about.</dd>
        <dt>Tap</dt>
        <dd>Target a player or monster, or pick up what's at your feet.</dd>
        <dt>Double tap</dt>
        <dd>Use it: open a door, talk to a shopkeeper, use an item.</dd>
        <dt>Long press</dt>
        <dd>Look at it (the right click). On a hotbar slot, change what's in it.</dd>
        <dt>Buttons (bottom right)</dt>
        <dd>Attack with what you wield (hold to keep attacking), Open a door, Get what's close by, and Target the next one.</dd>
        <dt>Top right</dt>
        <dd>Rest or stand, the map, the chat, and your inventory, spells and the rest.</dd>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------- HUD

interface HudPart {
  /** CSS selectors, the first that shows wins */
  sel: string[];
  title: string;
  text: string;
}

/** The parts of the screen, as GameView, ModernHud, Sidebar, Toolbar and TouchControls draw them */
const HUD_PARTS: HudPart[] = [
  { sel: [".game-title .menu-button"], title: "The ☰ menu", text: "Preferences, Configuration (keys), Actions, Help and logging off." },
  { sel: [".game-title .title-text"], title: "Where you are", text: "The room's name." },
  { sel: [".game-title .latency", ".classic-toolbar .latency"], title: "Connection", text: "Green is quick, yellow slow, red very slow. The FPS beside it is frames a second." },
  { sel: [".unit-portrait", ".user-area .portrait"], title: "You", text: "Your face. Click it for the emotes, or to cast a spell on yourself; right click to look at yourself." },
  { sel: [".unit-side .hud-bars", ".user-area .main-stats"], title: "Health, mana, vigor and experience", text: "Vigor runs down as you run and fight; rest to get it back. The last bar is your experience." },
  { sel: [".modern-enchantments.player", ".touch-hud .hud-enchantments.player", ".user-area .enchantments.player"], title: "Your enchantments", text: "Spells on you. Right click (long press) one to read about it." },
  { sel: [".target-frame"], title: "Your target", text: "Who you've targeted: red if you can attack them. E attacks; Esc lets go." },
  { sel: [".map-ring .minimap", ".map-frame .minimap", ".touch-controls ~ .minimap"], title: "The map", text: "You're the arrow; dots are players (blue), monsters (red) and the like. Click it for the full map; + and - zoom; right click to write a note." },
  { sel: [".map-tool.top-left", ".classic-toolbar .toolbar-buttons"], title: "Toolbar", text: "Rest or stand (resting brings back health, mana and vigor faster), and your mail. Classic also has Help, Drop and Get." },
  { sel: [".map-room-name"], title: "Room name", text: "Where you are." },
  { sel: [".modern-enchantments.room", ".classic-room-enchantments", ".hud-enchantments.room"], title: "Room enchantments", text: "Spells on the room you're in." },
  { sel: [".action-bar", ".touch-hotbar", ".view .hotbar"], title: "Hotbar", text: "Quick slots: 1 to 0 use them. Drag spells or items onto them; right click (long press) one to change it." },
  { sel: [".chat-tabs"], title: "Chat tabs", text: "All, Chat (what people say), Combat and Server. A mark shows on a tab with new lines." },
  { sel: [".chat-log"], title: "Chat", text: "What's said and what happens. In Modern it fades until you point at it; drag its edge to resize it." },
  { sel: [".chat-input"], title: "Chat line", text: "Enter starts it; type to talk, or a command (tell, yell, emote, who, help…)." },
  { sel: [".sidebar .stat-tabs"], title: "Tabs", text: "Inventory, Statistics, Spells, Skills, Quests, Friends and Pets." },
  { sel: [".sidebar .stat-frame"], title: "Inventory and lists", text: "What the tab shows. Double click to use, right click to look, drag to the view to drop." },
  { sel: [".touch-stick"], title: "Joystick", text: "Walk; push it far to run." },
  { sel: [".touch-actions"], title: "Buttons", text: "Attack (hold to keep at it), Open, Get and Target." },
  { sel: [".touch-top-buttons"], title: "Top buttons", text: "Rest or stand, the map, the chat, and the drawer with your inventory, spells and the rest." },
];

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
    for (const p of HUD_PARTS) {
      let rect: SnapRect | null = null;
      for (const s of p.sel) if ((rect = placeOf(root, root.querySelector(s)))) break;
      if (rect) parts.push({ n: 0, title: p.title, text: p.text, rects: [rect] });
    }
    // The view itself, under everything
    const view3d = placeOf(root, root.querySelector("canvas.viewport"));
    if (view3d) parts.unshift({ n: 0, title: "The view", text: "The world. Left click targets, right click looks, double click uses; hold the right button and drag to turn.", rects: [{ ...view3d, x: view3d.x + view3d.w * 0.42, y: view3d.y + view3d.h * 0.3, w: view3d.w * 0.16, h: view3d.h * 0.12 }] });
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
  const tabsHow =
    layout === "modern"
      ? "I opens the character window (your paper doll beside them); its title drags it."
      : layout === "classic"
        ? "They're the column at the right of the screen."
        : "The top right button opens the drawer with them.";
  return (
    <div className="help-interface">
      <section className="help-section">
        <h3>The ☰ menu</h3>
        <dl className="help-defs">
          <dt>Preferences… (O, F10)</dt>
          <dd>The game's options: sound and music, the halo round your target, tooltips, the profanity filter, the server's game options (safety, what others can do to you), and more.</dd>
          <dt>Configuration…</dt>
          <dd>The Bind Editor: your keys and mouse buttons, and options of ours (the interface, lighting, ambient life, pets, HUD size).</dd>
          {admin && (
            <>
              <dt>Admin console… (Shift+4)</dt>
              <dd>For admins: travel, players, and commands on the live world. Take care.</dd>
            </>
          )}
          <dt>Actions</dt>
          <dd>Who is logged on (and ignoring players), groups to talk to, hotkey aliases (what F1 to F12 type), command aliases and your guild.</dd>
          <dt>Language</dt>
          <dd>The language of the game's text, where the server has it.</dd>
          <dt>Change password…</dt>
          <dd>Your account's password.</dd>
          {layout !== "touch" && (
            <>
              <dt>Logout timer…</dt>
              <dd>Log off by yourself after some minutes away.</dd>
            </>
          )}
          <dt>Help… (F1)</dt>
          <dd>This window.</dd>
          <dt>About Meridian…</dt>
          <dd>Who made it.</dd>
          <dt>Switch character</dt>
          <dd>Back to your characters, still logged in.</dd>
          <dt>Log off</dt>
          <dd>Leave the game.</dd>
        </dl>
      </section>
      <section className="help-section">
        <h3>Your character</h3>
        <p className="help-note">{tabsHow}</p>
        <dl className="help-defs">
          <dt>Inventory (I)</dt>
          <dd>What you carry. Double click to use or wear, right click to look, drag to the view to drop, Sort to tidy.</dd>
          <dt>Statistics</dt>
          <dd>Your stats, karma, weight and bulk carried, and more.</dd>
          <dt>Spells and Skills</dt>
          <dd>What you know and how well. Double click a spell to cast it; drag it to the hotbar. Search spells by name; Study practises one while you're away (it rests when your mana's low, and can log off when done).</dd>
          <dt>Friends (P)</dt>
          <dd>Find players of Meridian Shards and ask them to be friends; see where they are, mark them on the map, follow them.</dd>
          <dt>Pets (N)</dt>
          <dd>A pet that follows you, seen by other Meridian Shards players. More open up as your maximum health grows.</dd>
        </dl>
      </section>
      <section className="help-section">
        <h3>Other windows</h3>
        <dl className="help-defs">
          <dt>Descriptions</dt>
          <dd>Right click anything (R for your target): what it is, with buttons to get, use, buy or add a friend.</dd>
          <dt>Shops, banks and vaults</dt>
          <dd>Double click a shopkeeper to buy; a banker to deposit; a vault keeper to withdraw. Typed: buy, offer, deposit, withdraw.</dd>
          <dt>Trading</dt>
          <dd>Offer items to another player; they answer with their own; then both accept.</dd>
          <dt>Containers</dt>
          <dd>Double click a box to see inside and take things out; put stores things in one.</dd>
          <dt>The full map</dt>
          <dd>Click the map. Notes you write on it stay.</dd>
          <dt>Quick Emotes (Q, or click your face)</dt>
          <dd>Wave, point, dance and your mood in one click.</dd>
          <dt>Hotbar slots</dt>
          <dd>Right click (long press) a slot to choose a spell or item for it.</dd>
          <dt>The chat</dt>
          <dd>Enter starts a line; T tells, Y yells, B broadcasts, ; emotes. Tabs keep chat, fights and the server's messages apart.</dd>
          {layout === "modern" && (
            <>
              <dt>Camera View (V) and Hide Interface (H)</dt>
              <dd>See yourself from behind, in front or a chase camera; and put the interface away for a screenshot.</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
