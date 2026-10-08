import { useEffect, useRef, useState, type FormEvent } from "react";
import { SAY, UC, type ObjectInfo } from "@shards/protocol";
import { isNumberItem, type ChatLine, type GameSession, type LookResult, type OfferEvent, type SessionPhase, type TradeList } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import type { GameAudio } from "./audio.ts";
import { GameScene, type GameSceneStatus, type ObjectAction } from "./gameScene.ts";
import type { IconRenderer } from "./icons.ts";
import { expandCommandAlias, getSettings, onSettings, updateSettings, type Settings } from "./settings.ts";
import { AmountDialog, GiveDialog, OfferDialog, TradeDialog, reduceOffer } from "./ui/Dialogs.tsx";
import { MiniMap } from "./ui/MiniMap.tsx";
import {
  ActionsDialog, CommandAliasesDialog, ConfigurationDialog, GroupsDialog, GuildDialog, HotkeyAliasesDialog, PreferencesDialog, WhoDialog,
  type ActionWindow,
} from "./ui/OptionsDialogs.tsx";
import { Sidebar, type ItemMenu, type Tab } from "./ui/Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";

const MAX_LINES = 300;
const OF_PLAYER = 0x4;
const OF_ATTACKABLE = 0x8;
/** include/proto.h: objects you can offer to (sell to, deposit with) and buy from */
const OF_OFFERABLE = 0x200;
const OF_BUYABLE = 0x400;
/** gameuser.h CLOSE_DISTANCE: traders must be this close */
const CLOSE_DISTANCE = 5 * 1024;

/**
 * Typed commands that aren't speech (module/merintr/command.c): money in and out of
 * the bank ("deposit 100", "withdraw 50", "balance"), the vault dialogs ("deposit",
 * "withdraw" with no amount), "rest" and "stand".
 */
export interface ActionCommand {
  action: "deposit" | "withdraw" | "balance" | "rest" | "stand";
  /** 0 when none was given */
  amount: number;
}

export function parseActionCommand(input: string): ActionCommand | null {
  const m = /^\/?(deposit|withdraw|balance|rest|stand)(?:\s+(\d+))?\s*$/i.exec(input.trim());
  if (!m) return null;
  return { action: m[1].toLowerCase() as ActionCommand["action"], amount: Number(m[2] ?? 0) };
}

/**
 * Typed commands (module/merintr/command.c): "say", "emote", "yell", "broadcast",
 * optionally with a leading "/"; ":" starts an emote; anything else is said.
 */
export function parseChatCommand(input: string): { kind: number; text: string } | null {
  const t = input.trim();
  if (!t) return null;
  if (t.startsWith(":")) return { kind: SAY.EMOTE, text: t.slice(1).trim() };
  const m = /^\/?(say|emote|em|yell|broadcast|bc)\s+(.*)$/i.exec(t);
  if (m) {
    const verb = m[1].toLowerCase();
    const kind =
      verb === "emote" || verb === "em" ? SAY.EMOTE : verb === "yell" ? SAY.YELL : verb === "say" ? SAY.NORMAL : SAY.EVERYONE;
    return { kind, text: m[2] };
  }
  return { kind: SAY.NORMAL, text: t };
}

/**
 * "tell <player> <message>" (command.c CommandTell, GetPlayerName): the player is a logged-on
 * name, quoted or not, matched whole first and then by a unique prefix.
 */
export function parseTell(input: string, players: readonly { id: number; name: string }[]): { id: number; name: string; text: string } | { error: string } | null {
  const m = /^\/?(?:tell|t)\s+(.*)$/i.exec(input.trim());
  if (!m) return null;
  let rest = m[1];
  let name: string;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return { error: "Tell whom? Close the quotes around their name." };
    name = rest.slice(1, end);
    rest = rest.slice(end + 1);
  } else {
    // The longest logged-on name the line starts with (names can have spaces)
    const lower = rest.toLowerCase();
    const whole = players
      .filter((p) => lower.startsWith(p.name.toLowerCase()) && /^(\s|$)/.test(rest.slice(p.name.length)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    name = whole ? whole.name : rest.split(/\s+/)[0];
    rest = rest.slice(name.length);
  }
  const text = rest.trim();
  const exact = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const prefixed = players.filter((p) => p.name.toLowerCase().startsWith(name.toLowerCase()));
  const target = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
  if (!target) return { error: prefixed.length > 1 ? `More than one player's name starts with "${name}".` : `${name} isn't logged on.` };
  if (!text) return { error: `Tell ${target.name} what?` };
  return { id: target.id, name: target.name, text };
}

/** Commands the original client knows that we don't have yet: we say so instead of saying them aloud. */
const EMOTES_NOT_YET = "Emotes aren't in Meridian Shards yet.";
const MOODS_NOT_YET = "Moods aren't in Meridian Shards yet.";
const NOT_YET_COMMANDS: Record<string, string> = {
  wave: EMOTES_NOT_YET, point: EMOTES_NOT_YET, dance: EMOTES_NOT_YET,
  happy: MOODS_NOT_YET, sad: MOODS_NOT_YET, neutral: MOODS_NOT_YET, wry: MOODS_NOT_YET,
  help: "The help pages aren't in Meridian Shards yet.",
  mail: "Mail isn't in Meridian Shards yet.",
  addgroup: "Adding your target to a group isn't in Meridian Shards yet; use Actions → Modify groups.",
};

/** Windows the Actions menu and typed commands open (actions.c "who", "group", "alias", "cmdalias", "guild"). */
const ACTION_COMMANDS: Record<string, ActionWindow> = { who: "who", group: "groups", groups: "groups", alias: "hotkeys", cmdalias: "commands", guild: "guild" };

type Modal =
  | { type: "trade"; list: TradeList }
  | { type: "give"; kind: "offer" | "deposit"; target: { id: number; name: string } }
  | { type: "amount"; object: ObjectInfo }
  | { type: "preferences" }
  | { type: "configuration" }
  | { type: "actions" }
  | { type: "action"; window: ActionWindow };

/** Menu for an object in the room or in the inventory. */
interface Menu {
  id: number;
  name: string;
  x: number;
  y: number;
  inventory: boolean;
  object: ObjectInfo | null;
  canGet: boolean;
  canActivate: boolean;
}

export function GameView({
  session, assets, audio, icons, phase, chat, look, onCloseLook, onLogout, trades, offers, serverPrefs, latency,
}: {
  /** The last ping's round trip in ms (lagbox.c), null before the first echo */
  latency: number | null;
  /** The game options the server keeps for us (CF_* flags), null until it has said */
  serverPrefs: number | null;
  session: GameSession;
  assets: AssetStore;
  audio: GameAudio;
  icons: IconRenderer;
  phase: SessionPhase;
  chat: ChatLine[];
  look: LookResult | null;
  onCloseLook: () => void;
  onLogout: () => void;
  /** Subscribe to shop and offer events from the session */
  trades: (fn: (t: TradeList) => void) => () => void;
  offers: (fn: (e: OfferEvent) => void) => () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const [status, setStatus] = useState<GameSceneStatus | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<Tab>("inventory");
  const [modal, setModal] = useState<Modal | null>(null);
  const [offer, setOffer] = useState<ReturnType<typeof reduceOffer>>(null);
  const [settings, setSettings] = useState<Settings>(getSettings);
  const [target, setTarget] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  /** The Map key: the map over the whole view (intrface.c A_MAP GraphicsToggleMap) */
  const [fullMap, setFullMap] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  /** For the scene's callbacks, which outlive renders */
  const actionRef = useRef<(a: string) => void>(() => {});
  const hotkeyRef = useRef<(n: number) => void>(() => {});

  useEffect(() => onSettings(setSettings), []);

  // The window title, like the original's "Meridian 59 --- The Inn of Raza"
  const roomName = status?.roomName ?? "";
  useEffect(() => {
    document.title = roomName ? `Meridian Shards — ${roomName}` : "Meridian Shards";
    return () => {
      document.title = "Meridian Shards";
    };
  }, [roomName]);

  useEffect(() => {
    const scene = new GameScene(canvasRef.current!, labelsRef.current!, session, assets, audio);
    sceneRef.current = scene;
    scene.onStatus = setStatus;
    scene.onChatKey = () => inputRef.current?.focus();
    scene.onTypeChat = (t) => {
      setText((v) => v + t);
      inputRef.current?.focus();
    };
    scene.onTarget = setTarget;
    scene.onSelecting = setSelecting;
    scene.onMessage = (t) => session.localMessage(t);
    scene.onObjectMenu = (a: ObjectAction) => setMenu({ ...a, inventory: false, object: session.world.objects.get(a.id)?.info ?? null });
    scene.onAction = (a) => actionRef.current(a);
    scene.onChatPrefix = (prefix) => {
      setText(prefix);
      inputRef.current?.focus();
    };
    scene.onHotkey = (n) => hotkeyRef.current(n);
    scene.onFps = setFps;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [session, assets, audio]);

  useEffect(() => trades((list) => setModal({ type: "trade", list })), [trades]);
  useEffect(() => offers((e) => setOffer((prev) => reduceOffer(prev, e))), [offers]);

  // New lines scroll the chat to the bottom, unless "Lock text window in place when
  // scrolling back" is on and you've scrolled up to read (config.scroll_lock)
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && (!settings.scrollLock || atBottomRef.current)) el.scrollTop = el.scrollHeight;
  }, [chat, settings.scrollLock]);

  /** gameuser.c GetObjects3D(CLOSE_DISTANCE, flag): the nearest object with the flag. */
  const nearest = (flag: number) => {
    const self = session.world.self;
    let best: { id: number; d: number } | null = null;
    for (const o of session.world.objects.values()) {
      if (!self || o.id === self.id || !(o.info.flags & flag)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d <= CLOSE_DISTANCE && (!best || d < best.d)) best = { id: o.id, d };
    }
    return best ? session.world.objects.get(best.id)! : null;
  };

  /** Keys and typed commands that open panels and dialogs or talk to traders. */
  const handleAction = (a: string) => {
    const toggle = (type: "preferences" | "configuration" | "actions") => setModal((m) => (m?.type === type ? null : { type }));
    switch (a) {
      case "inventory":
        return setTab("inventory");
      case "settings":
        return toggle("preferences");
      case "configuration":
        return toggle("configuration");
      case "actions":
        return toggle("actions");
      case "who":
        return setModal({ type: "action", window: "who" });
      case "map":
        return setFullMap((v) => !v);
      case "mapZoomIn":
      case "mapZoomOut": {
        // map.c MapZoom: 0.1 per step between 0.5 and 8
        const z = getSettings().mapZoom + (a === "mapZoomIn" ? 0.1 : -0.1);
        return updateSettings({ mapZoom: Math.round(Math.max(0.5, Math.min(8, z)) * 10) / 10 });
      }
      case "offer": {
        // The target if we can offer to them, else the nearest shopkeeper or banker
        const t = target !== null ? session.world.objects.get(target) : undefined;
        const o = t && t.info.flags & (OF_OFFERABLE | OF_PLAYER) ? t : nearest(OF_OFFERABLE);
        if (!o) return session.localMessage("There's nobody here to offer things to.");
        return setModal({ type: "give", kind: "offer", target: { id: o.id, name: session.resource(o.info.nameRes) ?? "" } });
      }
      case "buy": {
        const t = target !== null ? session.world.objects.get(target) : undefined;
        const o = t && t.info.flags & OF_BUYABLE ? t : nearest(OF_BUYABLE);
        if (!o) return session.localMessage("There's nobody here to buy from.");
        return session.requestBuy(o.id);
      }
      case "deposit":
      case "withdraw":
        return runCommand(a);
    }
  };

  /** alias.c: a function key's alias goes into the chat line, or is sent at once with Automatic Enter. */
  const handleHotkey = (n: number) => {
    const alias = getSettings().hotkeyAliases[n - 1];
    if (!alias?.command.trim()) return;
    if (alias.enter) runCommand(alias.command);
    else {
      setText(alias.command);
      inputRef.current?.focus();
    }
  };

  /** A typed line or alias (command.c): money and resting, our windows, tell, then speech. */
  const runCommand = (line: string) => {
    const input = expandCommandAlias(getSettings().commandAliases, line);
    const word = /^\/?(\S+)/.exec(input.trim())?.[1].toLowerCase() ?? "";
    if (ACTION_COMMANDS[word] && input.trim().split(/\s+/).length === 1) return setModal({ type: "action", window: ACTION_COMMANDS[word] });
    if (word === "map" && input.trim().split(/\s+/).length === 1) return setFullMap((v) => !v);
    if (word === "quit" && input.trim().split(/\s+/).length === 1) return onLogout();
    if (NOT_YET_COMMANDS[word]) return session.localMessage(NOT_YET_COMMANDS[word]);
    const tell = parseTell(input, [...session.world.players.values()].map((p) => ({ id: p.id, name: p.name })));
    if (tell) {
      if ("error" in tell) return session.localMessage(tell.error);
      return session.sayTo([tell.id], tell.text);
    }
    const action = parseActionCommand(input);
    if (action) {
      const a = action.action;
      if (a === "balance") session.userCommand(UC.BALANCE);
      else if (a === "rest") session.userCommand(UC.REST);
      else if (a === "stand") session.userCommand(UC.STAND);
      else if (action.amount > 0) session.userCommand(a === "deposit" ? UC.DEPOSIT : UC.WITHDRAW, action.amount);
      else if (a === "withdraw") {
        const banker = nearest(OF_BUYABLE);
        if (banker) session.requestWithdrawal(banker.id);
        else session.localMessage("There's no banker here.");
      } else {
        const banker = nearest(OF_OFFERABLE);
        if (banker)
          setModal({ type: "give", kind: "deposit", target: { id: banker.id, name: session.resource(banker.info.nameRes) ?? "" } });
        else session.localMessage("There's no banker here.");
      }
      return;
    }
    const cmd = parseChatCommand(input);
    if (cmd?.text) session.say(cmd.text, cmd.kind);
  };

  // The scene calls these through refs, so they see this render's state
  useEffect(() => {
    actionRef.current = handleAction;
    hotkeyRef.current = handleHotkey;
  });

  const send = (e: FormEvent) => {
    e.preventDefault();
    runCommand(text);
    setText("");
    inputRef.current?.blur();
  };

  const act = (fn: () => void) => {
    fn();
    setMenu(null);
  };

  const drop = (o: ObjectInfo) => {
    if (isNumberItem(o.id) && o.amount > 1) setModal({ type: "amount", object: o });
    else session.drop(o.id, isNumberItem(o.id) ? o.amount : undefined);
  };

  const itemMenu = (m: ItemMenu) =>
    setMenu({
      id: m.object.id, name: session.resource(m.object.nameRes) ?? "", x: m.x, y: m.y, inventory: session.world.inventory.has(m.object.id),
      object: m.object, canGet: false, canActivate: false,
    });

  /** Our face, an inventory item or a menu: pick it as the spell target, or make it the target. */
  const selectObject = (id: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.selecting) scene.select(id);
    else scene.setTarget(id);
  };

  const targetName = (() => {
    if (target === null) return null;
    const o = session.world.objects.get(target);
    return o ? (session.resource(o.info.nameRes) ?? null) : null;
  })();

  const f = menu?.object?.flags ?? 0;
  const inUse = menu ? session.world.inUse.has(menu.id) : false;

  return (
    <div className="game" onClick={() => menu && setMenu(null)}>
      <TitleBar
        className="game-title"
        assets={assets}
        title={roomName ? `Meridian Shards — ${roomName}` : "Meridian Shards"}
        menu={[
          { label: "Preferences…", onSelect: () => setModal({ type: "preferences" }) },
          { label: "Configuration…", onSelect: () => setModal({ type: "configuration" }) },
          { label: "Actions…", onSelect: () => setModal({ type: "actions" }) },
          { label: "Log off", onSelect: onLogout },
        ]}
        latency={settings.latencyMeter ? latency : undefined}
      />
      <div
        className="view"
        onDragOver={(e) => e.dataTransfer.types.includes("application/x-shards-item") && e.preventDefault()}
        onDrop={(e) => {
          // inventry.c: dragging an item onto the view drops it
          const id = Number(e.dataTransfer.getData("application/x-shards-item"));
          const o = session.world.inventory.get(id);
          if (o) drop(o);
        }}
      >
        <canvas ref={canvasRef} className="viewport" />
        <div ref={labelsRef} className="labels" />
        <div className="crosshair" />
        {fullMap && (
          <div className="full-map" title="Map (press the Map key again to close)">
            <MiniMap world={session.world} getRoom={() => sceneRef.current?.currentRoom ?? null} zoom={settings.mapZoom} paper={assets.url("ui/mapbkgnd.bmp")} />
          </div>
        )}
        {settings.showFps && fps !== null && <div className="fps">{fps} fps</div>}
        {targetName && <div className="target-name">Target: {targetName}</div>}
        {selecting && <div className="select-hint">Choose a target (Esc or right click cancels)</div>}
        {(phase === "entering" || status?.loading) && <div className="loading">Entering…</div>}
        {look && (
          <div className="look-panel" onClick={(e) => e.stopPropagation()}>
            <h3>{look.name}</h3>
            <p>{look.description}</p>
            {look.inscription && <p className="inscription">{look.inscription}</p>}
            <button onClick={onCloseLook}>Close</button>
          </div>
        )}
        {modal?.type === "trade" && (
          <TradeDialog list={modal.list} session={session} icons={icons} onClose={() => setModal(null)} />
        )}
        {modal?.type === "give" && (
          <GiveDialog kind={modal.kind} target={modal.target} session={session} icons={icons} onClose={() => setModal(null)} />
        )}
        {modal?.type === "amount" && (
          <AmountDialog
            object={modal.object}
            verb="Drop"
            session={session}
            onDone={(n) => {
              session.drop(modal.object.id, n);
              setModal(null);
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "preferences" && (
          <PreferencesDialog
            settings={settings}
            serverFlags={serverPrefs}
            onApply={(patch, flags) => {
              updateSettings(patch);
              // maindlg.c IDOK -> InterfaceConfigChanged: SendPreferences
              if (flags !== null) session.sendPreferences(flags);
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "configuration" && <ConfigurationDialog settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />}
        {modal?.type === "actions" && <ActionsDialog onOpen={(w) => setModal({ type: "action", window: w })} onClose={() => setModal(null)} />}
        {modal?.type === "action" && modal.window === "who" && (
          <WhoDialog session={session} settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "groups" && (
          <GroupsDialog session={session} settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "hotkeys" && (
          <HotkeyAliasesDialog settings={settings} onApply={updateSettings} onOpen={(w) => setModal({ type: "action", window: w })} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "commands" && (
          <CommandAliasesDialog settings={settings} onApply={updateSettings} onOpen={(w) => setModal({ type: "action", window: w })} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "guild" && <GuildDialog onClose={() => setModal(null)} />}
        {offer && <OfferDialog state={offer} session={session} icons={icons} onClose={() => setOffer(null)} />}
      </div>
      {menu && (
        <ul className="object-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <li className="title">{menu.name}</li>
          <li><button onClick={() => act(() => session.look(menu.id))}>Look</button></li>
          {menu.inventory ? (
            <>
              <li>
                <button onClick={() => act(() => (inUse ? session.unuse(menu.id) : session.use(menu.id)))}>{inUse ? "Unuse" : "Use"}</button>
              </li>
              <li><button onClick={() => act(() => menu.object && drop(menu.object))}>Drop</button></li>
            </>
          ) : (
            <>
              {f & OF_ATTACKABLE ? (
                <li>
                  <button
                    onClick={() =>
                      act(() => {
                        sceneRef.current?.setTarget(menu.id);
                        sceneRef.current?.attack();
                      })
                    }
                  >
                    Attack
                  </button>
                </li>
              ) : null}
              <li><button onClick={() => act(() => selectObject(menu.id))}>{selecting ? "Choose as target" : "Target"}</button></li>
              {menu.canGet && <li><button onClick={() => act(() => session.pickUp(menu.id))}>Pick up</button></li>}
              {menu.canActivate && <li><button onClick={() => act(() => session.activate(menu.id))}>Activate</button></li>}
              {f & OF_BUYABLE ? (
                <li><button onClick={() => act(() => session.requestBuy(menu.id))}>Buy</button></li>
              ) : null}
              {f & (OF_OFFERABLE | OF_PLAYER) && menu.object ? (
                <li>
                  <button onClick={() => act(() => setModal({ type: "give", kind: "offer", target: { id: menu.id, name: menu.name } }))}>
                    {f & OF_PLAYER ? "Offer…" : "Sell / offer…"}
                  </button>
                </li>
              ) : null}
            </>
          )}
        </ul>
      )}
      <div className="chat">
        <div
          ref={logRef}
          className="chat-log"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          }}
        >
          {chat.map((l, i) => (
            <div key={i} className="chat-line">
              {/* Add chat timestamps (config.chat_time_stamps) */}
              {settings.chatTimestamps && <span className="chat-time">[{new Date(l.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] </span>}
              {l.spans.map((s, j) => (
                <span
                  key={j}
                  style={
                    // Show colored text off (config.colorcodes): plain text, no colour codes
                    settings.coloredText
                      ? {
                          color: s.color,
                          fontWeight: s.bold ? "bold" : undefined,
                          fontStyle: s.italic ? "italic" : undefined,
                          textDecoration: s.underline ? "underline" : undefined,
                        }
                      : undefined
                  }
                >
                  {s.text}
                </span>
              ))}
            </div>
          ))}
        </div>
        <form onSubmit={send} className="chat-input">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText("");
                inputRef.current?.blur();
              }
            }}
            placeholder="Enter to chat — say, emote, yell, broadcast"
            maxLength={500}
          />
        </form>
      </div>
      <Sidebar
        session={session}
        icons={icons}
        assets={assets}
        getRoom={() => sceneRef.current?.currentRoom ?? null}
        tab={tab}
        onTab={setTab}
        settings={settings}
        onItemMenu={itemMenu}
        onDropItem={drop}
        target={target}
        selecting={selecting}
        onSelectObject={selectObject}
        onCast={(spell, n) => sceneRef.current?.castSpell(spell, n)}
      />
    </div>
  );
}

export const MAX_CHAT_LINES = MAX_LINES;
