import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CF, SAY, UA, UC, type ObjectInfo } from "@shards/protocol";
import {
  isNumberItem, type GuildEvent, type MailNewsEvent, type ChatLine, type ContainerContents, type DamageDealt, type GameSession, type LookResult, type OfferEvent, type SessionPhase,
  type TradeList,
} from "@shards/world";
import type { AssetStore } from "../assets.ts";
import type { AudioPreview, GameAudio } from "./audio.ts";
import { GameScene, type GameSceneStatus } from "./gameScene.ts";
import type { IconRenderer } from "./icons.ts";
import { getSettings, onSettings, updateSettings, type ChatTab, type Settings } from "./settings.ts";
import {
  BAD_COMMAND, defineAlias, filterSayMessage, findSpell, groupAdd, groupDelete, groupNew, interpretLine, resolveTell, type CommandId, type GroupResult,
} from "./commands.ts";
import { gameSocketUrl } from "../host.ts";
import { loadMailbox, newMailMessage, nextMailNumber, replyRecipients, replySubject, saveMailbox, type MailMessage } from "./mailbox.ts";
import { StatChangeDialog } from "./ui/StatChangeDialog.tsx";
import { GuildCreateDialog, GuildHallsDialog, GuildWindow, legalShield, type GuildState } from "./ui/GuildDialogs.tsx";
import { ReadMailDialog, ReadNewsDialog, SendMailDialog, type MailDraft, type Newsgroup } from "./ui/MailNewsDialogs.tsx";
import type { NewsArticle } from "@shards/protocol";
import { AmountDialog, GiveDialog, OfferDialog, PasswordDialog, SuicideDialog, TradeDialog, reduceOffer } from "./ui/Dialogs.tsx";
import { DESC, DescriptionDialog, LookListDialog, type DescAction, type LookListChoice } from "./ui/LookDialogs.tsx";
import { MiniMap } from "./ui/MiniMap.tsx";
import {
  ActionsDialog, CommandAliasesDialog, ConfigurationDialog, GroupsDialog, HotkeyAliasesDialog, PreferencesDialog, WhoDialog,
  type ActionWindow,
} from "./ui/OptionsDialogs.tsx";
import { Sidebar, type Tab } from "./ui/Sidebar.tsx";
import { useWorld } from "./ui/hooks.ts";
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

/** Windows typed commands open (actions.c "who", "group", "alias", "cmdalias", "guild"). */
const COMMAND_WINDOWS: Partial<Record<CommandId, ActionWindow>> = { who: "who", group: "groups", alias: "hotkeys", cmdalias: "commands", guild: "guild" };

/** command.c: the moods and emotes (BP_ACTION) */
const USER_ACTIONS: Partial<Record<CommandId, number>> = {
  wave: UA.WAVE, point: UA.POINT, dance: UA.DANCE, happy: UA.HAPPY, sad: UA.SAD, neutral: UA.NORMAL, wry: UA.WRY,
};

/** command.c: the game options typed commands turn on and off (SendPreferences) */
const OPTION_COMMANDS: Partial<Record<CommandId, [flag: number, on: boolean]>> = {
  safetyOn: [CF.SAFETY_OFF, false], safetyOff: [CF.SAFETY_OFF, true], tempsafeOn: [CF.TEMPSAFE, true], tempsafeOff: [CF.TEMPSAFE, false],
  groupingOn: [CF.GROUPING, true], groupingOff: [CF.GROUPING, false], autolootOn: [CF.AUTOLOOT, true], autolootOff: [CF.AUTOLOOT, false],
  autocombineOn: [CF.AUTOCOMBINE, true], autocombineOff: [CF.AUTOCOMBINE, false], reagentbagOn: [CF.BAGS, true], reagentbagOff: [CF.BAGS, false],
  spellpowerOn: [CF.SPELLPOWER, true], spellpowerOff: [CF.SPELLPOWER, false],
};

/** actions.c `actions`: the Actions menu, null for a separator */
const ACTIONS_MENU: ([command: string, label: string] | null)[] = [
  ["who", "Who is logged on"], ["group", "Modify groups"], ["alias", "Hotkey aliases"], ["cmdalias", "Command aliases"], ["guild", "Guild configuration"],
  null, ["wave", "Wave"], ["point", "Point"], ["dance", "Dance"],
  null, ["happy", "Happy"], ["sad", "Sad"], ["neutral", "Neutral"], ["wry", "Wry"],
];

/** textin.c EDITBOX_HISTORY: lines the chat box remembers */
const CHAT_HISTORY = 20;

type Modal =
  | { type: "trade"; list: TradeList }
  | { type: "give"; kind: "offer" | "deposit"; target: { id: number; name: string } }
  | { type: "amount"; object: ObjectInfo }
  | { type: "suicide" }
  | { type: "password" }
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
  session, assets, audio, icons, phase, chat, looks, contents, damage, mailNews, statChange, guild, onLogout, trades, offers, serverPrefs, latency,
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
  /** BP_REQ_STAT_CHANGE (module/stats): an elder offers to rearrange our stats */
  statChange: (fn: (e: { stats: number[]; levels: number[] }) => void) => () => void;
  /** The guild messages (merintr guild*.c: UC_GUILDINFO, UC_GUILD_ASK, ...) */
  guild: (fn: (e: GuildEvent) => void) => () => void;
  /** Mail and the news globes (module/mailnews) */
  mailNews: (fn: (e: MailNewsEvent) => void) => () => void;
  /** Subscribe to container contents (BP_OBJECT_CONTENTS) */
  contents: (fn: (c: ContainerContents) => void) => () => void;
  /** Subscribe to the damage we deal (for the numbers over what we hit) */
  damage: (fn: (d: DamageDealt) => void) => () => void;
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
  /** Read Mail (mailread.c), open or not; the kept messages; its info line */
  const [mailOpen, setMailOpen] = useState(false);
  const [mailbox, setMailbox] = useState<MailMessage[]>([]);
  const [mailInfo, setMailInfo] = useState("");
  /** Send Mail windows' drafts (one at a time, as the original allows) */
  const [mailDraft, setMailDraft] = useState<MailDraft | null>(null);
  /** The Send Mail window waiting for BP_LOOKUP_NAMES */
  const lookupRef = useRef<((ids: number[]) => void) | null>(null);
  /** The newsgroup a globe opened, its index and the chosen article's text */
  const [news, setNews] = useState<{ group: Newsgroup; articles: NewsArticle[] | null; article: { num: number; text: string } | null } | null>(null);
  const requestedArticle = useRef(-1);
  /** The stat change sheet (module/stats), with what the server says we have */
  const [statChangeAt, setStatChangeAt] = useState<{ stats: number[]; levels: number[] } | null>(null);
  /** The guild window (guild.c), Create New Guild (UC_GUILD_ASK) and Rent Guild Hall (UC_GUILD_HALLS) */
  const [guildState, setGuildState] = useState<GuildState | null>(null);
  const [guildAsk, setGuildAsk] = useState<{ cost: number; secretCost: number } | null>(null);
  const [guildHalls, setGuildHalls] = useState<Extract<GuildEvent, { type: "halls" }>["halls"] | null>(null);
  /** command.c pinfo.resting: after "rest", until "stand" */
  const restingRef = useRef(false);
  useWorld(session.world, ["spells"]);
  const spells = session.world.spells;
  const spellSchools = session.world.spellSchools;
  /** textin.c: the lines typed, newest first, and where Up/Down has got to (-1 = the line being typed) */
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(-1);
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
  useEffect(() => damage((d) => sceneRef.current?.showDamage(d)), [damage]);
  useEffect(() => statChange(setStatChangeAt), [statChange]);
  useEffect(
    () =>
      guild((e) => {
        switch (e.type) {
          case "info":
            // guild.c GuildConfigInit: (re)open the sheet with what the server says
            return setGuildState((g) => ({ info: e.info, list: g?.list ?? null, shield: g?.shield ?? null, patterns: g?.patterns ?? [], ownShield: g?.ownShield ?? false }));
          case "list":
            return setGuildState((g) => (g ? { ...g, list: e.list } : g));
          case "shield":
            return setGuildState((g) =>
              g ? { ...g, shield: e.shield, ownShield: g.ownShield || (e.shield.id === g.info.guildId && legalShield(e.shield.color1, e.shield.color2)) } : g,
            );
          case "shields":
            return setGuildState((g) => (g ? { ...g, patterns: e.patterns } : g));
          case "ask":
            return setGuildAsk({ cost: e.cost, secretCost: e.secretCost });
          case "halls":
            return setGuildHalls(e.halls);
        }
      }),
    [guild],
  );
  // module/mailnews: keep each new message (then tell the server), the globes' news
  useEffect(
    () =>
      mailNews((e) => {
        switch (e.type) {
          case "newsgroup":
            requestedArticle.current = -1;
            return setNews({ group: e, articles: null, article: null });
          case "articles":
            return setNews((n) => (n && n.group.newsgroup === e.newsgroup ? { ...n, articles: e.articles } : n));
          case "article":
            return setNews((n) => (n ? { ...n, article: { num: requestedArticle.current, text: e.text } } : n));
          case "mail": {
            // mailfile.c MailNewMessage: keep it; only then may the server forget it
            const self = session.world.self;
            const name = self ? (session.resource(self.info.nameRes) ?? "") : "";
            const list = loadMailbox(localStorage, gameSocketUrl(), name);
            const next = [...list, newMailMessage(nextMailNumber(list), e.sender, e.recipients, e.text, e.time)];
            if (saveMailbox(localStorage, gameSocketUrl(), name, next)) session.deleteMail(e.index);
            setMailbox(next);
            return setMailInfo("");
          }
          case "noMoreMail":
            return setMailInfo("You have no new mail.");
          case "lookupNames": {
            const waiting = lookupRef.current;
            lookupRef.current = null;
            return waiting?.(e.ids);
          }
        }
      }),
    [mailNews, session],
  );

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
        runCommand(a);
        return;
      // intrface.c MainTab / mermain.c InterfaceTab: the view, the interface, the chat line, round
      case "tabForward":
        return focusInterface();
      case "tabBackward":
        inputRef.current?.focus();
        return;
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

  /** mermain.c InterfaceTab: keyboard focus to the inventory (or the stat list showing) */
  const focusInterface = () => {
    setTab("inventory");
    setTimeout(() => (document.querySelector<HTMLElement>(".inventory-grid .inv-item.selected, .inventory-grid .inv-item") ?? null)?.focus());
  };

  /** Back to the view: nothing focused, so the game's keys work (SetFocus(hMain)) */
  const focusView = () => (document.activeElement as HTMLElement | null)?.blur();

  /** Our character's name (the mailbox is kept per character) */
  const ownName = () => {
    const self = session.world.self;
    return self ? (session.resource(self.info.nameRes) ?? "") : "";
  };

  /** mailread.c UserReadMail: the kept messages, and ask the server for new ones */
  const openMail = () => {
    setMailbox(loadMailbox(localStorage, gameSocketUrl(), ownName()));
    setMailOpen(true);
    setMailInfo("Looking for new messages...");
    session.requestMail();
  };

  const deleteMail = (m: MailMessage) => {
    const next = loadMailbox(localStorage, gameSocketUrl(), ownName()).filter((x) => x.num !== m.num);
    saveMailbox(localStorage, gameSocketUrl(), ownName(), next);
    setMailbox(next);
  };

  /** Speech, filtered as say.c FilterSayMessage does */
  const say = (text: string, kind: number) => {
    const t = filterSayMessage(text);
    if (t) session.say(t, kind);
  };

  /** gameuser.c: inventory items to choose from (LD_SINGLEAUTO: just one is taken at once) */
  const chooseInventory = (title: string, onDone: (c: LookListChoice[]) => void) => {
    const items = [...session.world.inventory.values()];
    if (!items.length) return;
    if (items.length === 1) return onDone([{ id: items[0].id, amount: isNumberItem(items[0].id) ? items[0].amount : undefined }]);
    setModal({ type: "list", title, items, multiple: true, amounts: true, onDone });
  };

  /** mermain.c A_CASTSPELL: not while paralyzed or resting */
  const castSpell = (spell: number, numTargets: number) => {
    if (session.world.effects.paralyzed) return session.localMessage("You can't lift your hands to cast the spell!");
    if (restingRef.current) return session.localMessage("You can't cast spells while you're resting.");
    sceneRef.current?.castSpell(spell, numTargets);
  };

  /** command.c CommandRest / CommandStand: the server's resting, and ours (no moving or fighting) */
  const setResting = (on: boolean) => {
    if (on === restingRef.current) return session.localMessage(on ? "You're already resting." : "You're not resting.");
    session.userCommand(on ? UC.REST : UC.STAND);
    session.localMessage(on ? "You rest." : "You stop resting.");
    restingRef.current = on;
    if (sceneRef.current) sceneRef.current.resting = on;
  };

  /** groups.c results: save the groups, tell the player */
  const applyGroups = (r: GroupResult) => {
    if (r.groups) updateSettings({ groups: r.groups });
    r.messages.forEach((m) => session.localMessage(m));
  };

  /**
   * A typed line, a hotkey alias or a menu item (merintr.c EventTextCommand): a command
   * (commands.ts), then a command alias, then (our default) speech. Returns false for a
   * line that meant nothing (parse.c IDS_BADCOMMAND), which the chat history skips.
   */
  const runCommand = (line: string, inAlias = false): boolean => {
    const s = getSettings();
    // alias.c: an alias can't name another alias
    const t = interpretLine(line, inAlias ? {} : s.commandAliases, s.originalCommands);
    if (!t) return false;
    switch (t.kind) {
      case "bad":
        session.localMessage(inAlias ? "Invalid command stored in alias. (Press F1 or '?' for help.)" : BAD_COMMAND);
        return false;
      case "ambiguousAlias":
        session.localMessage("That command is ambiguous.");
        return true;
      case "alias":
        return runCommand(t.line, true);
      case "say":
        say(t.text, SAY.NORMAL);
        return true;
    }
    runParsed(t.id, t.args);
    return true;
  };

  /** The Actions menu's windows; the guild's comes from the server (command.c CommandGuild: UC_REQ_GUILDINFO) */
  const openWindow = (w: ActionWindow) => {
    if (w !== "guild") return setModal({ type: "action", window: w });
    setModal(null);
    session.userCommand(UC.REQ_GUILDINFO);
  };

  /** command.c Command*: one command, with the words after its name */
  const runParsed = (id: CommandId, args: string): void => {
    const world = session.world;
    const players = () => [...world.players.values()].map((p) => ({ id: p.id, name: p.name }));
    const window = COMMAND_WINDOWS[id];
    // "alias word command" defines a command alias; alone it opens the window
    if (window && !((id === "alias" || id === "cmdalias") && args)) return openWindow(window);
    const ua = USER_ACTIONS[id];
    if (ua !== undefined) return session.action(ua);
    const option = OPTION_COMMANDS[id];
    if (option) {
      const [flag, on] = option;
      const base = serverPrefs ?? 0;
      session.sendPreferences(on ? base | flag : base & ~flag);
      // and read them back, so Preferences shows them
      return session.userCommand(UC.REQ_PREFERENCES);
    }
    switch (id) {
      case "say":
        return args ? say(args, SAY.NORMAL) : undefined;
      case "emote":
        return args ? say(args, SAY.EMOTE) : undefined;
      case "yell":
        return args ? say(args, SAY.YELL) : undefined;
      case "broadcast":
        return args ? say(args, SAY.EVERYONE) : undefined;
      case "tellguild":
        return args ? say(args, SAY.GUILD) : undefined;
      case "tell": {
        const r = resolveTell(args, players(), getSettings().groups);
        if (!r) return;
        if ("error" in r) return session.localMessage(r.error);
        const text = filterSayMessage(r.text);
        if (text) session.sayTo(r.ids, text);
        return;
      }
      case "appeal": {
        const text = filterSayMessage(args);
        if (text) session.appeal(text);
        return;
      }
      case "alias":
      case "cmdalias": {
        const r = defineAlias(getSettings().commandAliases, args);
        updateSettings({ commandAliases: r.aliases });
        return session.localMessage(r.message);
      }
      case "quit":
        return onLogout();
      case "hel":
        return session.localMessage('Type the entire word "help" to open help.');
      case "help":
        return session.localMessage("The help pages aren't in Meridian Shards yet.");
      case "mail":
        return openMail();
      case "suicid":
        return session.localMessage('Type the entire word "suicide" to restart your character.');
      case "suicide":
        return setModal({ type: "suicide" });
      case "password":
        return setModal({ type: "password" });
      case "time":
        return session.userCommand(UC.REQ_TIME);
      case "map":
        return setFullMap((v) => !v);
      case "get":
        return sceneRef.current?.pickUpNearby();
      case "look":
        return sceneRef.current?.lookInView();
      case "put":
        return putAway();
      case "buy":
      case "offer":
        return handleAction(id);
      case "use": {
        // gameuser.c UserActivate: something close by to activate, or a container to open
        const self = world.self;
        const near = [...world.objects.values()].filter(
          (o) =>
            self && o.id !== self.id && o.info.flags & (OF_ACTIVATABLE | OF_CONTAINER) && !(o.info.flags & OF_PLAYER) && Math.hypot(o.x - self.x, o.y - self.y) <= CLOSE_DISTANCE,
        );
        const activate = (oid: number) => {
          const o = world.objects.get(oid);
          if (o && o.info.flags & OF_CONTAINER) session.requestContents(oid);
          else session.activate(oid);
        };
        if (near.length === 1) return activate(near[0].id);
        if (near.length) setModal({ type: "list", title: "Activate", items: near.map((o) => o.info), onDone: (c) => c[0] && activate(c[0].id) });
        return;
      }
      case "drop":
        // gameuser.c UserDrop
        return chooseInventory("Drop", (chosen) => chosen.forEach((c) => session.drop(c.id, c.amount)));
      case "cast": {
        const spells = world.spells.map((sp) => ({ ...sp, name: session.resource(sp.object.nameRes) ?? "" }));
        if (!args.trim()) {
          // spells.c UserCastSpell: the spell list
          if (!spells.length) return;
          return setModal({
            type: "list",
            title: "Cast spell",
            items: [...spells].sort((a, b) => a.name.localeCompare(b.name)).map((sp) => sp.object),
            onDone: (c) => {
              const sp = c[0] && spells.find((x) => x.object.id === c[0].id);
              if (sp) castSpell(sp.object.id, sp.numTargets);
            },
          });
        }
        const sp = findSpell(spells, args);
        if (sp === "none") return session.localMessage("There is no spell with that name.");
        if (sp === "ambiguous") return session.localMessage("That spell name is ambiguous.");
        return castSpell(sp.object.id, sp.numTargets);
      }
      case "rest":
        return setResting(true);
      case "stand":
        return setResting(false);
      case "balance":
        return session.userCommand(UC.BALANCE);
      case "deposit":
      case "withdraw": {
        // command.c CommandDeposit / CommandWithdraw: an amount of money, or the vault
        const amount = Number.parseInt(args, 10);
        if (amount > 0) return session.userCommand(id === "deposit" ? UC.DEPOSIT : UC.WITHDRAW, amount);
        if (id === "withdraw") {
          const banker = nearest(OF_BUYABLE);
          if (banker) session.requestWithdrawal(banker.id);
          else session.localMessage("There's no banker here.");
          return;
        }
        const banker = nearest(OF_OFFERABLE);
        if (banker) setModal({ type: "give", kind: "deposit", target: { id: banker.id, name: session.resource(banker.info.nameRes) ?? "" } });
        else session.localMessage("There's no banker here.");
        return;
      }
      case "newgroup":
        return applyGroups(groupNew(getSettings().groups, args));
      case "addgroup":
        return applyGroups(groupAdd(getSettings().groups, args, (n) => players().some((p) => p.name.toLowerCase() === n.toLowerCase())));
      case "delgroup":
        return applyGroups(groupDelete(getSettings().groups, args));
    }
  };

  // The scene calls these through refs, so they see this render's state
  useEffect(() => {
    actionRef.current = handleAction;
    hotkeyRef.current = handleHotkey;
  });

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text) return;
    // textin.c TextInputKey: lines that meant something go in the history, once in a row
    if (runCommand(text)) {
      const h = historyRef.current;
      if (h[0] !== text) historyRef.current = [text, ...h].slice(0, CHAT_HISTORY);
    }
    historyPos.current = -1;
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

  // spells.c MenuAddSpell: a submenu per school (UC_SPELL_SCHOOLS), its spells sorted by name
  const spellsMenu = spellSchools.flatMap((nameRes, school) => {
    const items = spells
      .filter((sp) => sp.school === school)
      .map((sp) => ({ name: session.resource(sp.object.nameRes) ?? "", sp }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map(({ name, sp }) => ({ label: name, onSelect: () => castSpell(sp.object.id, sp.numTargets) }));
    return items.length ? [{ label: session.resource(nameRes) ?? `School ${school + 1}`, items }] : [];
  });

  return (
    <div className="game" ref={gameRef} style={{ "--chat-height": `${dragHeight ?? settings.chatHeight}px` } as CSSProperties}>
      <TitleBar
        className="game-title"
        assets={assets}
        title={roomName ? `Meridian Shards — ${roomName}` : "Meridian Shards"}
        menu={[
          { label: "Preferences…", onSelect: () => setModal({ type: "preferences" }) },
          { label: "Configuration…", onSelect: () => setModal({ type: "configuration" }) },
          // actions.c: each item runs its typed command
          { label: "Actions", items: ACTIONS_MENU.map((a) => (a ? { label: a[1], onSelect: () => runCommand(a[0]) } : { label: "", separator: true })) },
          ...(spellsMenu.length ? [{ label: "Spells", items: spellsMenu }] : []),
          // mailnews.c's toolbar button, until the toolbar
          { label: "Mail…", onSelect: openMail },
          { label: "Change password…", onSelect: () => setModal({ type: "password" }) },
          { label: "Log off", onSelect: onLogout },
        ]}
        latency={settings.latencyMeter ? latency : undefined}
      />
      <div
        className="view"
        onDragOver={(e) => e.dataTransfer.types.includes("application/x-shards-item") && e.preventDefault()}
        onDrop={(e) => {
          // inventry.c: dragging an item onto the view drops it, or puts it in a container there
          const id = Number(e.dataTransfer.getData("application/x-shards-item"));
          const o = session.world.inventory.get(id);
          if (!o) return;
          const box = sceneRef.current?.containerAt(e.clientX, e.clientY) ?? null;
          if (box !== null) session.put(o.id, isNumberItem(o.id) ? o.amount : undefined, box);
          else drop(o);
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
        {mailOpen && (
          <ReadMailDialog
            mailbox={mailbox}
            info={mailInfo}
            onWrite={() => setMailDraft({ to: [], subject: "" })}
            onReply={(m, all) => setMailDraft({ to: replyRecipients(m, all, ownName()), subject: replySubject(m.subject) })}
            onRescan={() => {
              setMailInfo("Looking for new messages...");
              session.requestMail();
            }}
            onDelete={deleteMail}
            onClose={() => setMailOpen(false)}
          />
        )}
        {mailDraft && (
          <SendMailDialog
            session={session}
            draft={mailDraft}
            onLookup={(fn) => (lookupRef.current = fn)}
            onClose={() => {
              lookupRef.current = null;
              setMailDraft(null);
            }}
          />
        )}
        {news && (
          <ReadNewsDialog
            session={session}
            group={news.group}
            articles={news.articles}
            article={news.article}
            ignored={(n) => settings.ignored.includes(n.toLowerCase())}
            onRequestArticle={(num) => {
              requestedArticle.current = num;
              session.requestArticle(news.group.newsgroup, num);
            }}
            onMailAuthor={(a) => setMailDraft({ to: [a.poster], subject: replySubject(a.title) })}
            onClose={() => setNews(null)}
          />
        )}
        {statChangeAt && (
          <StatChangeDialog session={session} stats={statChangeAt.stats} levels={statChangeAt.levels} onClose={() => setStatChangeAt(null)} />
        )}
        {modal?.type === "suicide" && <SuicideDialog session={session} onClose={() => setModal(null)} />}
        {modal?.type === "password" && <PasswordDialog session={session} onClose={() => setModal(null)} />}
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
        {modal?.type === "actions" && (
          <ActionsDialog onOpen={openWindow} onCommand={(c) => runCommand(c)} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "who" && (
          <WhoDialog session={session} settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "groups" && (
          <GroupsDialog session={session} settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "hotkeys" && (
          <HotkeyAliasesDialog settings={settings} onApply={updateSettings} onOpen={openWindow} onClose={() => setModal(null)} />
        )}
        {modal?.type === "action" && modal.window === "commands" && (
          <CommandAliasesDialog settings={settings} onApply={updateSettings} onOpen={openWindow} onClose={() => setModal(null)} />
        )}
        {guildState && <GuildWindow session={session} state={guildState} icons={icons} onClose={() => setGuildState(null)} />}
        {guildAsk && <GuildCreateDialog session={session} cost={guildAsk.cost} secretCost={guildAsk.secretCost} onClose={() => setGuildAsk(null)} />}
        {guildHalls && <GuildHallsDialog session={session} halls={guildHalls} onClose={() => setGuildHalls(null)} />}
        {offer && (
          <OfferDialog key={offer.from?.id ?? 0} state={offer} session={session} icons={icons} onLook={(id) => lookAt(id, DESC.NONE)} onClose={() => setOffer(null)} />
        )}
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
                historyPos.current = -1;
                inputRef.current?.blur();
              } else if (e.key === "Tab") {
                // textin.c: Tab to the view, Shift+Tab to the interface
                e.preventDefault();
                if (e.shiftKey) focusInterface();
                else focusView();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                // textin.c: the chat box is a combo box of the last 20 lines
                const h = historyRef.current;
                const next = Math.max(-1, Math.min(h.length - 1, historyPos.current + (e.key === "ArrowUp" ? 1 : -1)));
                if (next === historyPos.current) return;
                e.preventDefault();
                historyPos.current = next;
                setText(next < 0 ? "" : h[next]);
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
        onApplyItem={(o) => sceneRef.current?.beginSelect((target) => session.apply(o.id, target))}
        onPut={putAway}
        onTabOut={(forward) => (forward ? inputRef.current?.focus() : focusView())}
        target={target}
        selecting={selecting}
        onSelectObject={selectObject}
        onCast={castSpell}
      />
    </div>
  );
}

