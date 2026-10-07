import { useEffect, useRef, useState, type FormEvent } from "react";
import { SAY, UC, type ObjectInfo } from "@shards/protocol";
import { isNumberItem, type ChatLine, type GameSession, type LookResult, type OfferEvent, type SessionPhase, type TradeList } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import type { GameAudio } from "./audio.ts";
import { GameScene, type GameSceneStatus, type ObjectAction } from "./gameScene.ts";
import type { IconRenderer } from "./icons.ts";
import { getSettings, onSettings, updateSettings, type Settings } from "./settings.ts";
import { AmountDialog, GiveDialog, OfferDialog, SettingsDialog, TradeDialog, reduceOffer } from "./ui/Dialogs.tsx";
import { Sidebar, type ItemMenu, type Tab } from "./ui/Sidebar.tsx";

const MAX_LINES = 300;
const OF_PLAYER = 0x4;
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

type Modal =
  | { type: "trade"; list: TradeList }
  | { type: "give"; kind: "offer" | "deposit"; target: { id: number; name: string } }
  | { type: "amount"; object: ObjectInfo }
  | { type: "settings" };

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
  session, assets, audio, icons, phase, chat, look, onCloseLook, onLogout, trades, offers,
}: {
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

  useEffect(() => onSettings(setSettings), []);

  useEffect(() => {
    const scene = new GameScene(canvasRef.current!, labelsRef.current!, session, assets, audio);
    sceneRef.current = scene;
    scene.onStatus = setStatus;
    scene.onChatKey = () => inputRef.current?.focus();
    scene.onTypeChat = (t) => {
      setText((v) => v + t);
      inputRef.current?.focus();
    };
    scene.onObjectMenu = (a: ObjectAction) => setMenu({ ...a, inventory: false, object: session.world.objects.get(a.id)?.info ?? null });
    scene.onAction = (a) => {
      if (a === "inventory") setTab("inventory");
      else if (a === "settings") setModal((m) => (m?.type === "settings" ? null : { type: "settings" }));
      else if (a === "mapZoomIn" || a === "mapZoomOut") {
        // map.c MapZoom: 0.1 per step between 0.5 and 8
        const z = getSettings().mapZoom + (a === "mapZoomIn" ? 0.1 : -0.1);
        updateSettings({ mapZoom: Math.round(Math.max(0.5, Math.min(8, z)) * 10) / 10 });
      }
    };
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [session, assets, audio]);

  useEffect(() => trades((list) => setModal({ type: "trade", list })), [trades]);
  useEffect(() => offers((e) => setOffer((prev) => reduceOffer(prev, e))), [offers]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

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

  const send = (e: FormEvent) => {
    e.preventDefault();
    const action = parseActionCommand(text);
    if (action) {
      const a = action.action;
      if (a === "balance") session.userCommand(UC.BALANCE);
      else if (a === "rest") session.userCommand(UC.REST);
      else if (a === "stand") session.userCommand(UC.STAND);
      else if (action.amount > 0) session.userCommand(a === "deposit" ? UC.DEPOSIT : UC.WITHDRAW, action.amount);
      else if (a === "withdraw") {
        const banker = nearest(OF_BUYABLE);
        if (banker) session.requestWithdrawal(banker.id);
      } else {
        const banker = nearest(OF_OFFERABLE);
        if (banker)
          setModal({ type: "give", kind: "deposit", target: { id: banker.id, name: session.resource(banker.info.nameRes) ?? "" } });
      }
      setText("");
      inputRef.current?.blur();
      return;
    }
    const cmd = parseChatCommand(text);
    if (cmd?.text) session.say(cmd.text, cmd.kind);
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

  const f = menu?.object?.flags ?? 0;
  const inUse = menu ? session.world.inUse.has(menu.id) : false;

  return (
    <div className="game" onClick={() => menu && setMenu(null)}>
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
        <div className="room-name">{status?.roomName}</div>
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
        {modal?.type === "settings" && <SettingsDialog settings={settings} onClose={() => setModal(null)} />}
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
        <div ref={logRef} className="chat-log">
          {chat.map((l, i) => (
            <div key={i} className="chat-line">
              {l.spans.map((s, j) => (
                <span
                  key={j}
                  style={{
                    color: s.color,
                    fontWeight: s.bold ? "bold" : undefined,
                    fontStyle: s.italic ? "italic" : undefined,
                    textDecoration: s.underline ? "underline" : undefined,
                  }}
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
        mapZoom={settings.mapZoom}
        onItemMenu={itemMenu}
        onDropItem={drop}
      />
      <div className="hud" style={{ backgroundImage: `url(${assets.url("ui/bkgnd.bmp")})` }}>
        <span className="muted">
          {settings.preset === "original"
            ? "Arrows move · Alt+arrows strafe · Space door · double click use · right click actions · F10 settings"
            : "Click to look around · WASD move · Shift run · Space door · F/double click use · right click actions · F10 settings"}
        </span>
        <button className="link" onClick={() => setModal({ type: "settings" })}>
          Settings
        </button>
        <button className="link" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}

export const MAX_CHAT_LINES = MAX_LINES;
