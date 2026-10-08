import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { SAY, UC, type ObjectInfo } from "@shards/protocol";
import { isNumberItem, type ChatLine, type ContainerContents, type GameSession, type LookResult, type OfferEvent, type SessionPhase, type TradeList } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import type { AudioPreview, GameAudio } from "./audio.ts";
import { GameScene, type GameSceneStatus } from "./gameScene.ts";
import type { IconRenderer } from "./icons.ts";
import { expandCommandAlias, getSettings, onSettings, updateSettings, type ChatTab, type Settings } from "./settings.ts";
import { AmountDialog, GiveDialog, OfferDialog, TradeDialog, reduceOffer } from "./ui/Dialogs.tsx";
import { DESC, DescriptionDialog, LookListDialog, type DescAction, type LookListChoice } from "./ui/LookDialogs.tsx";
import { MiniMap } from "./ui/MiniMap.tsx";
import {
  ActionsDialog, CommandAliasesDialog, ConfigurationDialog, GroupsDialog, GuildDialog, HotkeyAliasesDialog, PreferencesDialog, WhoDialog,
  type ActionWindow,
} from "./ui/OptionsDialogs.tsx";
import { Sidebar, type Tab } from "./ui/Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";

const MAX_LINES = 300;

/** The chat window's tabs (ours; the original has one text window). */
const CHAT_TABS: { tab: ChatTab; label: string }[] = [
  { tab: "all", label: "All" },
  { tab: "chat", label: "Chat" },
  { tab: "combat", label: "Combat" },
  { tab: "server", label: "Server" },
];
/** The chat window's height, dragged by its top edge: at least this, and leaving the view this much */
const MIN_CHAT_HEIGHT = 60;
const MIN_VIEW_HEIGHT = 160;

const inTab = (tab: ChatTab, l: ChatLine) => tab === "all" || l.channel === tab;

/**
 * A new chat line, keeping at most `max` of each channel: a long fight can't push the
 * conversation out of the Chat tab.
 */
export function appendChatLine(lines: readonly ChatLine[], line: ChatLine, max: number = MAX_LINES): ChatLine[] {
  let n = 0;
  for (const l of lines) if (l.channel === line.channel) n++;
  if (n < max) return [...lines, line];
  const drop = lines.findIndex((l) => l.channel === line.channel);
  return [...lines.slice(0, drop), ...lines.slice(drop + 1), line];
}

/** object.c CompareObjectNameAndNumber: number items first, then by name. */
export function sortByNameAndNumber(items: ObjectInfo[], name: (res: number) => string): ObjectInfo[] {
  return [...items].sort(
    (a, b) => Number(isNumberItem(b.id)) - Number(isNumberItem(a.id)) || name(a.nameRes).toLowerCase().localeCompare(name(b.nameRes).toLowerCase()),
  );
}
const OF_PLAYER = 0x4;
const OF_GETTABLE = 0x10;
const OF_CONTAINER = 0x20;
const OF_ACTIVATABLE = 0x800;
const OF_APPLYABLE = 0x1000;
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
  | { type: "action"; window: ActionWindow }
  /** lookdlg.c DisplayLookList: choose among objects (to get, look at, attack, put away...) */
  | {
      type: "list";
      title: string;
      items: ObjectInfo[];
      multiple?: boolean;
      /** LD_AMOUNTS: how many of each number item */
      amounts?: boolean;
      initial?: number;
      onDone: (chosen: LookListChoice[]) => void;
    };

export function GameView({
  session, assets, audio, icons, phase, chat, looks, contents, onLogout, trades, offers, serverPrefs, latency,
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
  /** Subscribe to descriptions from the session (BP_LOOK, UC_LOOK_PLAYER) */
  looks: (fn: (l: LookResult) => void) => () => void;
  /** Subscribe to container contents (BP_OBJECT_CONTENTS) */
  contents: (fn: (c: ContainerContents) => void) => () => void;
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
  /** The description dialog (dialog.c DisplayDescription) and its DESC_* buttons */
  const [desc, setDesc] = useState<{ look: LookResult; buttons: number } | null>(null);
  /** dialog.c SetDescParams: the buttons for the next description, set when we ask for it */
  const descParams = useRef<number>(DESC.NONE);
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
  /** The chat window's height while its edge is being dragged (saved on letting go) */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  /** When each chat tab was last looked at, for the new-lines mark on the others */
  const [seenAt, setSeenAt] = useState<Record<ChatTab, number>>(() => {
    const now = Date.now();
    return { all: now, chat: now, combat: now, server: now };
  });
  /** For the scene's callbacks, which outlive renders */
  const actionRef = useRef<(a: string) => void>(() => {});
  const hotkeyRef = useRef<(n: number) => void>(() => {});
  const lookRef = useRef<(id: number) => void>(() => {});
  /** The Preferences window's audio choices, heard before OK */
  const previewAudio = useCallback((p: AudioPreview | null) => audio.preview(p), [audio]);

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
    scene.onLook = (id) => lookRef.current(id);
    const roomObjects = (ids: number[]) => ids.flatMap((id) => session.world.objects.get(id)?.info ?? []);
    // gameuser.c UserPickup: LD_MULTIPLESEL | LD_SINGLEAUTO
    scene.onPickup = (ids) =>
      ids.length === 1
        ? session.pickUp(ids[0])
        : setModal({ type: "list", title: "Get", items: roomObjects(ids), multiple: true, onDone: (c) => c.forEach((x) => session.pickUp(x.id)) });
    scene.onChoose = (title, ids, then, initial) =>
      setModal({ type: "list", title, items: roomObjects(ids), initial, onDone: (c) => c[0] && then(c[0].id) });
    scene.onContents = (id) => session.requestContents(id);
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
  // game.c ResetUserData: AbortLookList; the description and pick lists hold stale ids
  useEffect(
    () =>
      session.world.on((e) => {
        if (e.type !== "idsStale") return;
        setDesc(null);
        setModal((m) => (m?.type === "list" ? null : m));
      }),
    [session],
  );
  // gameuser.c GotObjectContents: "The box is empty.", or choose what to take out and how many
  useEffect(
    () =>
      contents(({ container, items }) => {
        const box = session.world.objects.get(container);
        if (!items.length) {
          if (box) session.localMessage(`The ${session.resource(box.info.nameRes) ?? ""} is empty.`);
          return;
        }
        setModal({
          type: "list",
          title: "Get",
          items: sortByNameAndNumber(items, (id) => session.resource(id) ?? ""),
          multiple: true,
          amounts: true,
          onDone: (c) => c.forEach((x) => session.getFromContainer(x.id, x.amount)),
        });
      }),
    [contents, session],
  );
  // dialog.c DisplayDescription: one description at a time, with the buttons asked for
  useEffect(
    () =>
      looks((look) => {
        const buttons = descParams.current;
        descParams.current = DESC.NONE;
        setDesc((cur) => cur ?? { look, buttons });
      }),
    [looks],
  );
  useEffect(() => offers((e) => setOffer((prev) => reduceOffer(prev, e))), [offers]);

  // New lines scroll the chat to the bottom, unless "Lock text window in place when
  // scrolling back" is on and you've scrolled up to read (config.scroll_lock)
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && (!settings.scrollLock || atBottomRef.current)) el.scrollTop = el.scrollHeight;
  }, [chat, settings.scrollLock, settings.chatTab]);

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
  const handleAction = (a: string): void => {
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
  const runCommand = (line: string): void => {
    const input = expandCommandAlias(getSettings().commandAliases, line);
    const word = /^\/?(\S+)/.exec(input.trim())?.[1].toLowerCase() ?? "";
    if (ACTION_COMMANDS[word] && input.trim().split(/\s+/).length === 1) return setModal({ type: "action", window: ACTION_COMMANDS[word] });
    if (word === "map" && input.trim().split(/\s+/).length === 1) return setFullMap((v) => !v);
    if (word === "quit" && input.trim().split(/\s+/).length === 1) return onLogout();
    // command.c CommandGet: A_PICKUP
    if ((word === "get" || word === "pickup") && input.trim().split(/\s+/).length === 1) return sceneRef.current?.pickUpNearby();
    // command.c CommandLook (A_LOOK) and CommandPut (A_PUT)
    if (word === "look" && input.trim().split(/\s+/).length === 1) return sceneRef.current?.lookInView();
    if (word === "put" && input.trim().split(/\s+/).length === 1) return putAway();
    // command.c CommandBuy, CommandOffer: A_BUY, A_OFFER
    if ((word === "buy" || word === "offer") && input.trim().split(/s+/).length === 1) return handleAction(word);
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

  const drop = (o: ObjectInfo) => {
    if (isNumberItem(o.id) && o.amount > 1) setModal({ type: "amount", object: o });
    else session.drop(o.id, isNumberItem(o.id) ? o.amount : undefined);
  };

  /** dialog.c SetDescParams, then RequestLook: the description comes back as BP_LOOK. */
  const lookAt = (id: number, buttons: number) => {
    descParams.current = buttons;
    session.look(id);
  };

  /** gameuser.c SetDescParamsByRoomObject: close by, a room object can be got, used or activated. */
  const lookRoomObject = (id: number) => {
    const o = session.world.objects.get(id);
    const self = session.world.self;
    let buttons: number = DESC.NONE;
    if (o && self && Math.hypot(o.x - self.x, o.y - self.y) <= CLOSE_DISTANCE) {
      const f = o.info.flags;
      if (f & OF_CONTAINER) buttons |= DESC.INSIDE;
      if (f & OF_ACTIVATABLE && !(f & OF_PLAYER)) buttons |= DESC.ACTIVATE;
      if (f & OF_GETTABLE) {
        buttons |= DESC.GET;
        if (!(f & OF_ACTIVATABLE)) buttons |= DESC.USE;
      }
    }
    lookAt(id, buttons);
  };

  /** inventry.c A_LOOKINVENTORY: Drop, and Unuse, Use (apply) or Use. */
  const lookInventoryItem = (o: ObjectInfo) => {
    let buttons: number = DESC.DROP;
    if (session.world.inUse.has(o.id)) buttons |= DESC.UNUSE;
    else if (o.flags & OF_APPLYABLE) buttons |= DESC.APPLY;
    else buttons |= DESC.USE;
    lookAt(o.id, buttons);
  };

  /**
   * gameuser.c UserPut: with a container close by, choose inventory items (and how many), then
   * the container if there's more than one.
   */
  const putAway = () => {
    const boxes = [...session.world.objects.values()].filter(
      (o) => o.info.flags & OF_CONTAINER && session.world.self && Math.hypot(o.x - session.world.self.x, o.y - session.world.self.y) <= CLOSE_DISTANCE,
    );
    if (!boxes.length) return session.localMessage("There's nothing here to put things in.");
    const putInto = (chosen: LookListChoice[], box: number) => chosen.forEach((c) => session.put(c.id, c.amount, box));
    setModal({
      type: "list",
      title: "Put: Select object",
      items: [...session.world.inventory.values()].filter((o) => !session.world.inUse.has(o.id)),
      multiple: true,
      amounts: true,
      onDone: (chosen) => {
        if (boxes.length === 1) return putInto(chosen, boxes[0].id);
        // The list closes first; open the next one after it
        setTimeout(() =>
          setModal({ type: "list", title: "Put: Select container", items: boxes.map((b) => b.info), onDone: (c) => c[0] && putInto(chosen, c[0].id) }),
        );
      },
    });
  };

  /** Our face or an inventory item while choosing a spell target (GAME_SELECT). */
  const selectObject = (id: number) => sceneRef.current?.select(id);

  useEffect(() => {
    lookRef.current = lookRoomObject;
  });

  /** dialog.c DescDialogProc's buttons, on the object the dialog shows. */
  const descAction = (a: DescAction, id: number, buttons: number) => {
    switch (a) {
      case "get":
        return session.pickUp(id);
      case "inside":
        return session.requestContents(id);
      case "drop": {
        // IDC_DROP: all of a number item
        const o = session.world.inventory.get(id);
        if (o) session.drop(o.id, isNumberItem(o.id) ? o.amount : undefined);
        return;
      }
      case "use":
        // IDC_USE: pick it up first when it's on the ground (there's a Get button)
        if (buttons & DESC.GET) session.pickUp(id);
        return session.use(id);
      case "unuse":
        return session.unuse(id);
      case "activate":
        return session.activate(id);
      case "apply":
        // gameuser.c StartApply: choose what to use it on
        return sceneRef.current?.beginSelect((target) => session.apply(id, target));
    }
  };

  /** IDOK: a changed description (RequestChangeDescription) or web page (RequestChangeURL(player.id, url)). */
  const descSave = (id: number, description: string | null, url: string | null) => {
    if (description !== null) session.changeDescription(id, description);
    const self = session.world.player?.id;
    if (url !== null && self !== undefined) session.changeUrl(self, url);
  };

  const chatTab = settings.chatTab;
  const shown = chat.filter((l) => inTab(chatTab, l));
  /** `at`: the click's time, in the chat lines' clock (ms since 1970) */
  const pickTab = (tab: ChatTab, at: number) => {
    const now = at;
    // Leaving All, everything in it has been seen
    setSeenAt((s) => (chatTab === "all" ? { all: now, chat: now, combat: now, server: now } : { ...s, [chatTab]: now, [tab]: now }));
    atBottomRef.current = true;
    updateSettings({ chatTab: tab });
  };
  /** Drag the chat window's top edge to make it taller or shorter */
  const resizeChat = (e: ReactPointerEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const bottom = game.getBoundingClientRect().bottom;
    const max = game.clientHeight - MIN_VIEW_HEIGHT;
    const heightAt = (y: number) => Math.round(Math.max(MIN_CHAT_HEIGHT, Math.min(max, bottom - y)));
    let h = heightAt(e.clientY);
    const move = (ev: PointerEvent) => {
      h = heightAt(ev.clientY);
      setDragHeight(h);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragHeight(null);
      updateSettings({ chatHeight: h });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <div className="game" ref={gameRef} style={{ "--chat-height": `${dragHeight ?? settings.chatHeight}px` } as CSSProperties}>
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
        {selecting && <div className="select-hint">Choose a target (Esc or right click cancels)</div>}
        {(phase === "entering" || status?.loading) && <div className="loading">Entering…</div>}
        {desc && (
          <DescriptionDialog
            key={desc.look.object.id}
            look={desc.look}
            buttons={desc.buttons}
            icons={icons}
            onAction={(a) => descAction(a, desc.look.object.id, desc.buttons)}
            onSave={(d, u) => descSave(desc.look.object.id, d, u)}
            onClose={() => setDesc(null)}
          />
        )}
        {modal?.type === "list" && (
          <LookListDialog
            key={modal.title}
            title={modal.title}
            multiple={!!modal.multiple}
            amounts={modal.amounts}
            initial={modal.initial}
            icons={icons}
            items={modal.items.map((o) => ({ object: o, name: (isNumberItem(o.id) ? `${o.amount} ` : "") + (session.resource(o.nameRes) ?? "") }))}
            onDone={modal.onDone}
            onLook={(id) => lookAt(id, DESC.NONE)}
            onClose={() => setModal(null)}
          />
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
            onPreview={previewAudio}
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
      <div className="chat">
        <div className="chat-resize" onPointerDown={resizeChat} title="Drag to resize the chat window" aria-hidden />
        <div className="chat-tabs" role="tablist" aria-label="Chat">
          {CHAT_TABS.map(({ tab, label }) => {
            // On All every line is on screen, so no tab has unseen ones
            const unread = chatTab !== "all" && tab !== "all" && tab !== chatTab && chat.some((l) => inTab(tab, l) && l.time > seenAt[tab]);
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={tab === chatTab}
                className={`${tab === chatTab ? "active" : ""}${unread ? " unread" : ""}`}
                onClick={(e) => pickTab(tab, performance.timeOrigin + e.timeStamp)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div
          ref={logRef}
          className="chat-log"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          }}
        >
          {shown.map((l, i) => (
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
        onLookItem={lookInventoryItem}
        onLook={(id) => lookAt(id, DESC.NONE)}
        onDropItem={drop}
        target={target}
        selecting={selecting}
        onSelectObject={selectObject}
        onCast={(spell, n) => sceneRef.current?.castSpell(spell, n)}
      />
    </div>
  );
}

