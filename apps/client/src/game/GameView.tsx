import { HelpDialog } from "./ui/HelpDialog.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CF, SAY, STAT_GROUP, UA, UC, objId, type ObjectInfo } from "@shards/protocol";
import {
  PROFANITY_WARNING, isNumberItem, type SpellRefusal, OBSERVER, WHITE, BLACK, decodeBoard, type GuildEvent, type MinigameEvent, type MailNewsEvent, type ChatLine, type ContainerContents, type DamageDealt, type GameSession, type LookResult, type OfferEvent, type SessionPhase,
  type SocialEvent, type TradeList, type TravelEvent, type TravelPlace, petForKarma, petKind, type AmbientPersonInfo, type QuestEvent, type QuestOffer, type CosmeticsEvent, type TrainingCost, type Appraisal, type Sellable,
  ARENA_ROOMS, BOUT_STATE, arenaCommand, floorTaken, chatLinkLabel, chatLinkToken, localRes,
} from "@shards/world";
import { MAX_CHAT_BYTES, expandChatLinks, insertAt, utf8Length } from "./chatInput.ts";
import { EmojiPicker } from "./ui/EmojiPicker.tsx";
import type { QuestStore } from "./quests.ts";
import { useCompanion, type CompanionStore } from "./companion.ts";
import { useArena, type ArenaStore } from "./arenaBouts.ts";
import { ArenaDialog } from "./ui/ArenaDialog.tsx";
import type { FactionWarStore } from "./factionWar.ts";
import type { FallenHallsStore } from "./fallenHalls.ts";
import type { AchievementsStore } from "./achievements.ts";
import { AchievementsDialog } from "./ui/AchievementsDialog.tsx";
import { AchievementToast } from "./ui/AchievementToast.tsx";
import { WarDialog } from "./ui/WarDialog.tsx";
import { CompanionPanel } from "./ui/CompanionPanel.tsx";
import { CompanionLooksDialog } from "./ui/CompanionLooksDialog.tsx";
import { TailorDialog } from "./ui/TailorDialog.tsx";
import { BarberDialog } from "./ui/BarberDialog.tsx";
import { ItemServiceDialog } from "./ui/ItemServiceDialog.tsx";
import { NameChangeDialog } from "./ui/NameChangeDialog.tsx";
import { WarButton } from "./ui/WarButton.tsx";
import { QuestWays } from "./questWays.ts";
import { MM_OURS, MM_QUEST_NPC, MM_TALK_NPC } from "./markers.ts";
import { QuestDialog, QuestInfoDialog } from "./ui/QuestDialog.tsx";
import { QuestBox } from "./ui/QuestBox.tsx";
import { WelcomeControls } from "./ui/WelcomeControls.tsx";
import { QuestsPanel } from "./ui/QuestsPanel.tsx";
import type { AssetStore } from "../assets.ts";
import type { AudioPreview, GameAudio } from "./audio.ts";
import { GameScene, type GameSceneStatus, type TouchMove, type ViewMode } from "./gameScene.ts";
import { bareIcon, type IconRenderer } from "./icons.ts";
import { ACTION_TABS, actionsFor, bindingLabel, getSettings, onSettings, touchUi, updateSettings, type Action, type ChatTab, type Settings } from "./settings.ts";
import {
  BAD_COMMAND, defineAlias, filterSayMessage, findSpell, groupAdd, groupDelete, groupNew, interpretLine, resolveTell, type CommandId, type GroupResult,
} from "./commands.ts";
import { devPagesEnabled, exitApp, gameSocketUrl, onBackButton } from "../host.ts";
import { takeStartCity } from "./startCity.ts";
import { editCurrentRoom } from "./devEditor.ts";
import { loadMailbox, newMailMessage, nextMailNumber, replyRecipients, replySubject, saveMailbox, type MailMessage } from "./mailbox.ts";
import { StatChangeDialog } from "./ui/StatChangeDialog.tsx";
import { GuildCreateDialog, GuildHallsDialog, GuildWindow, legalShield, type GuildState } from "./ui/GuildDialogs.tsx";
import { ReadMailDialog, ReadNewsDialog, SendMailDialog, type MailDraft, type Newsgroup } from "./ui/MailNewsDialogs.tsx";
import type { NewsArticle } from "@shards/protocol";
import { PvpLockout } from "./ui/PvpLockout.tsx";
import { AmountDialog, AppraiseDialog, AppraiseIcon, GiveDialog, OfferDialog, PasswordDialog, SuicideDialog, TradeDialog, TravelDialog, reduceOffer } from "./ui/Dialogs.tsx";
import { AmbientPersonDialog, DESC, DescriptionDialog, LookListDialog, type DescAction, type DescButton, type LookListChoice } from "./ui/LookDialogs.tsx";
import { MiniMap } from "./ui/MiniMap.tsx";
import {
  ActionsDialog, CommandAliasesDialog, ConfigurationDialog, GroupsDialog, HotkeyAliasesDialog, LogoutTimerDialog, PreferencesDialog, StudyDialog, TouchConfigDialog, TrainDialog,
  WhoDialog,
  type ActionWindow, type StudySpell,
} from "./ui/OptionsDialogs.tsx";
import { EnchantmentRow, ObjIcon, STAT_HP, STAT_MP, Sidebar, cancelEnchantment, type Tab } from "./ui/Sidebar.tsx";
import { ClassicToolbar } from "./ui/Toolbar.tsx";
import { ActionBar, MapCluster, TargetFrame, UnitFrame } from "./ui/ModernHud.tsx";
import { CharacterWindow } from "./ui/CharacterWindow.tsx";
import { sortByNameAndNumber } from "./inventoryOrder.ts";
import { CastCooldown, type Cooldown } from "./cooldowns.ts";
import { TouchControls, tickerColor } from "./ui/TouchControls.tsx";
import { EdgeFrame, MessageBox, closeTopWindow } from "./ui/kit.tsx";
import { isProfane } from "./profanity.ts";
import { AnnotateDialog } from "./ui/AnnotateDialog.tsx";
import { AboutDialog } from "./ui/AboutDialog.tsx";
import { ChessWindow, type ChessState } from "./ui/ChessWindow.tsx";
import { AdminConsole, appendAdminText, type AdminRoom } from "./ui/AdminConsole.tsx";
import { SocialLink } from "./social.ts";
import { FriendsMapHint, FriendsNotices, FriendsPanel } from "./ui/FriendsPanel.tsx";
import { PetsPanel } from "./ui/PetsPanel.tsx";
import { loadPet, savePet } from "./pet.ts";
import { languageName } from "./languages.ts";
import { MAX_ANNOTATIONS, annotationAt, loadAnnotations, saveAnnotations, type MapAnnotation } from "./annotations.ts";
import { useWorld } from "./ui/hooks.ts";
import { TitleBar } from "./TitleBar.tsx";
import { QUICK_SLOTS, emptySlots, loadQuickSlots, saveQuickSlots, slotItem, slotSpell, type QuickSlot, type QuickSlots } from "./quickSlots.ts";
import { Hotbar, QuickSlotPicker } from "./ui/QuickSlots.tsx";
import {
  DEFAULT_REST_REGEN, StudySession, carriedCounts, castsFromReagents, formatDuration, loadStudyMemory, saveStudyMemory, studyEstimate, type StudyAction,
  type StudyConfig, type StudyMemory, type StudyPhase, type StudySnapshot, type StudySpellInfo,
} from "./study.ts";

const MAX_LINES = 300;

/** The chat window's tabs (ours; the original has one text window). */
const CHAT_TABS: { tab: ChatTab; label: string }[] = [
  { tab: "all", label: "All" },
  { tab: "chat", label: "Chat" },
  { tab: "combat", label: "Combat" },
  { tab: "server", label: "Server" },
  { tab: "debug", label: "Debug" },
];
/** The Debug tab (admins only) keeps this many lines */
const MAX_DEBUG_LINES = 300;
/** The camera views' names (gameScene.ts ViewMode), shown for VIEW_NOTE_MS when one is chosen */
const VIEW_NAMES: Record<ViewMode, string> = { first: "First person", chase: "Chase camera", behind: "Behind", front: "Front" };
const VIEW_NOTE_MS = 1500;

/** The Modern interface's chat: lines show this long after they come, then fade (until hovered), ms */
const CHAT_FRESH_MS = 10000;
/** The admin console: the server's messages this long after a DM command are its answers, ms */
const DM_ANSWER_MS = 3000;
/** The first controls (ui/WelcomeControls.tsx) show this long after entering the game, ms */
const WELCOME_DELAY_MS = 1500;
/** Its width, dragged by its right edge: at least this */
const MIN_CHAT_WIDTH = 220;
/** The Modern chat moved by its tab strip: this much of it stays in the window across, and its strip down, px */
const CHAT_KEEP_X = 120;
const CHAT_KEEP_Y = 40;
/** The Modern chat's height, dragged by its bottom edge: at least this, px; and where it starts unmoved */
const MIN_CHAT_TALL = 100;
const CHAT_TOP = 190;
/** A second press on the Modern chat's tab strip this soon after the first puts it back, ms */
const CHAT_DOUBLE_MS = 400;
/** The chat window's height, dragged by its top edge: at least this, and leaving the view this much */
const MIN_CHAT_HEIGHT = 60;
const MIN_VIEW_HEIGHT = 160;

// All leaves out the admins' Debug lines
const inTab = (tab: ChatTab, l: ChatLine) => (tab === "all" ? l.channel !== "debug" : l.channel === tab);

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

const OF_PLAYER = 0x4;
const OF_GETTABLE = 0x10;
const OF_CONTAINER = 0x20;
const OF_ACTIVATABLE = 0x800;
const OF_APPLYABLE = 0x1000;
/** include/blakston.khd OF_NPC: a town's or a faction's people */
const OF_NPC = 0x2000;
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
  groupingOn: [CF.GROUPING, true], groupingOff: [CF.GROUPING, false], autolootOn: [CF.AUTOLOOT, true], autolootOff: [CF.AUTOLOOT, false],
  autocombineOn: [CF.AUTOCOMBINE, true], autocombineOff: [CF.AUTOCOMBINE, false], reagentbagOn: [CF.BAGS, true], reagentbagOff: [CF.BAGS, false],
  spellpowerOn: [CF.SPELLPOWER, true], spellpowerOff: [CF.SPELLPOWER, false],
};

/** actions.c `actions`: the Actions menu, null for a separator */
const ACTIONS_MENU: ([command: string, label: string] | null)[] = [
  ["who", "Who is logged on"], ["group", "Modify groups"], ["alias", "Hotkey aliases"], ["cmdalias", "Command aliases"], ["guild", "Guild configuration"],
  // (Ours: the emotes and moods aren't here: a click on our face shows them, as Q does)
];

/** Ours: the Quick Emotes menu (Q): the emotes and the moods, each its typed command, null between them */
const QUICK_EMOTES: ([command: string, label: string] | null)[] = [
  ["wave", "Wave"], ["point", "Point"], ["dance", "Dance"], null, ["happy", "Happy"], ["sad", "Sad"], ["neutral", "Neutral"], ["wry", "Wry"],
];

/** Study mode: keys for these stop it (the player is back), as do Esc and a click in the view */
const STUDY_STOP_ACTIONS: ReadonlySet<Action> = new Set<Action>([...ACTION_TABS.Movement, "attack", "go", "interact"]);
/** Study mode's tick while the page is shown, ms (a worker ticks it every 5 s when hidden) */
const STUDY_TICK_MS = 500;

/** textin.c EDITBOX_HISTORY: lines the chat box remembers */
const CHAT_HISTORY = 20;

/** The quest window's button for an NPC's service window (cosmetics.ts, itemservice.ts) */
const SERVICE_LABELS: Record<CosmeticsEvent["type"], string> = {
  tailor: "Tailor…",
  barber: "Barber…",
  reveal: "Reveal…",
  repair: "Repair…",
  rename: "Change name…",
};

type Modal =
  | { type: "trade"; list: TradeList }
  | { type: "travel"; here: number; places: TravelPlace[] }
  | { type: "quest"; npc: number; offers: QuestOffer[]; service?: CosmeticsEvent }
  /** Ours: a quest's details, from a double click in the quest box or the Quests tab */
  | { type: "questInfo"; id: number }
  // Ours (docs/adr/0012-cosmetics.md): a tailor's or barber's window
  | { type: "cosmetics"; menu: CosmeticsEvent }
  | { type: "give"; kind: "offer" | "deposit"; target: { id: number; name: string } }
  // Ours (docs/adr/0010-followers.md 9.3): our companion's looks
  | { type: "companionLooks" }
  // Ours (docs/adr/0019-arena-bouts.md): the Arena window
  | { type: "arena" }
  // Ours (docs/adr/0021-factions-and-the-faction-war.md): the War window
  | { type: "war" }
  // Ours (docs/adr/0025-achievements.md): the Achievements window
  | { type: "achievements" }
  | { type: "amount"; object: ObjectInfo }
  | { type: "suicide" }
  | { type: "quickSlot"; index: number }
  | { type: "password" }
  | { type: "preferences" }
  | { type: "configuration" }
  | { type: "logoutTimer" }
  /** Ours: the Help window (F1, help) */
  | { type: "help" }
  /** Study mode's window, with what we know as it opens (study.ts) */
  | { type: "study"; spells: StudySpell[]; carried: Map<string, number>; mana: number; maxMana: number; memory: StudyMemory }
  /** Ours: spending training points (docs/adr/0016-abilities.md), with what was typed after "train" */
  | { type: "train"; search: string }
  | { type: "about" }
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
  session, assets, audio, icons, phase, chat, looks, contents, damage, mailNews, statChange, guild, minigame, modules, admin, languages, onLogout, trades, travel, socialEvents, quests, questOffers, cosmetics, training, appraisal, sellable, companion, arena, factionWar, fallenHalls, achievements, offers, serverPrefs, latency,
}: {
  /** Ours: the arenas' mock bouts (docs/adr/0019-arena-bouts.md) */
  arena: ArenaStore;
  /** Ours: the Faction War, for the War window and the War button (docs/adr/0021) */
  factionWar: FactionWarStore;
  /** Ours: the Fallen Halls and the guild window's quests (docs/adr/0022) */
  fallenHalls: FallenHallsStore;
  /** Ours: the achievements earned, for the Achievements window and its toast (docs/adr/0025) */
  achievements: AchievementsStore;
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
  /** The languages the .rsb has (language.c GetAvailableLanguages) */
  languages: number[];
  /** Mini-game messages (chess) */
  minigame: (fn: (e: MinigameEvent) => void) => () => void;
  /** The server loading and unloading client modules (chess.dll, admin.dll) */
  modules: (fn: (e: { name: string; loaded: boolean }) => void) => () => void;
  /** BP_ADMIN: the server's answers to admin commands */
  admin: (fn: (text: string) => void) => () => void;
  /** The guild messages (merintr guild*.c: UC_GUILDINFO, UC_GUILD_ASK, ...) */
  guild: (fn: (e: GuildEvent) => void) => () => void;
  /** Mail and the news globes (module/mailnews) */
  mailNews: (fn: (e: MailNewsEvent) => void) => () => void;
  /** Subscribe to container contents (BP_OBJECT_CONTENTS) */
  contents: (fn: (c: ContainerContents) => void) => () => void;
  /** Subscribe to the damage we deal (for the numbers over what we hit) */
  damage: (fn: (d: DamageDealt) => void) => () => void;
  /** Log off; `why`, when given, is shown on the login screen */
  onLogout: (why?: string) => void;
  /** Subscribe to shop and offer events from the session */
  trades: (fn: (t: TradeList) => void) => () => void;
  offers: (fn: (e: OfferEvent) => void) => () => void;
  /** Ours: fast travel's lists and the PvP lockout (docs/adr/0011-fast-travel.md) */
  travel: (fn: (e: TravelEvent) => void) => () => void;
  /** Ours: friends, pets and the shared crowd from our server (docs/adr/0015-social-on-our-server.md) */
  socialEvents: (fn: (e: SocialEvent) => void) => () => void;
  /** Ours: our quests, and what an NPC we talked to has for us (docs/adr/0009-quests.md) */
  quests: QuestStore;
  questOffers: (fn: (e: Extract<QuestEvent, { type: "offers" }>) => void) => () => void;
  /** Ours: a tailor's or barber's menu (docs/adr/0012-cosmetics.md) */
  cosmetics: (fn: (e: CosmeticsEvent) => void) => () => void;
  /** Ours: the abilities we can train, and what 1% of each costs (docs/adr/0016-abilities.md) */
  training: (fn: (list: TrainingCost[]) => void) => () => void;
  /** Ours: whether an item of ours can be appraised, and its price (docs/adr/0016-abilities.md) */
  appraisal: (fn: (a: Appraisal) => void) => () => void;
  /** Ours: what a buyer would take from our inventory (UC_SELLABLE) */
  sellable: (fn: (s: Sellable) => void) => () => void;
  /** Ours: our companion (docs/adr/0010-followers.md) */
  companion: CompanionStore;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const [status, setStatus] = useState<GameSceneStatus | null>(null);
  /** The description dialog (dialog.c DisplayDescription) and its DESC_* buttons */
  const [desc, setDesc] = useState<{ look: LookResult; buttons: number } | null>(null);
  /** Ours: one of the townsfolk examined (the inspect window) */
  const [ambientLook, setAmbientLook] = useState<AmbientPersonInfo | null>(null);
  /** rooms.json: rooms' names by file, for where townsfolk come and go (the likeliest of a file's) */
  const [roomNames, setRoomNames] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    assets
      .roomList()
      .then((list) => {
        if (!live) return;
        const m = new Map<string, string>();
        for (const r of list) {
          const file = r.roo.toLowerCase();
          // A file's first room with a real name (not "Room", nor a Death Realm copy)
          if (!m.has(file) || /^(new )?room$|^death realm$/i.test(m.get(file)!)) m.set(file, r.name);
        }
        setRoomNames(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assets]);
  /** dialog.c SetDescParams: the buttons for the next description, set when we ask for it */
  const descParams = useRef<number>(DESC.NONE);
  const [text, setText] = useState("");
  /** Ours (ADR 0024): item links in the chat input, "[name]" to its token, swapped in on send */
  const chatLinks = useRef(new Map<string, string>());
  const [tab, setTab] = useState<Tab>("inventory");
  const [modal, setModal] = useState<Modal | null>(null);
  /** askTrader: the trader asked for a withdrawal list, until a list comes back or we ask to buy */
  const traderAsked = useRef<{ id: number; timer: number } | null>(null);
  const askTraderRef = useRef<(id: number) => void>(() => {});
  const [offer, setOffer] = useState<ReturnType<typeof reduceOffer>>(null);
  const [settings, setSettings] = useState<Settings>(getSettings);
  const [target, setTarget] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  /** The Map key: the map over the whole view (intrface.c A_MAP GraphicsToggleMap) */
  const [fullMap, setFullMap] = useState(false);
  /** Ours: the first controls (WelcomeControls.tsx, until seenControls) wait a moment after entering, for the room to show first */
  const [welcomeReady, setWelcomeReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setWelcomeReady(true), WELCOME_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);
  /** The phone layout (Touch Controls): the chat and the interface slide out over the view */
  const touch = touchUi(settings);
  /** The Modern interface (ours, desktop only): the view fills the window, the HUD over it (ui/ModernHud.tsx) */
  const modern = !touch && settings.interfaceStyle === "modern";
  /**
   * The Classic interface: the original's layout (graphics.c, intrface.h). The window's stone edge,
   * the toolbar row over the view, the view's border and corners, the chat box under it.
   */
  const classic = !touch && !modern;
  /**
   * The chat line has the keyboard: the original's main window doesn't (GetFocus() != hMain), so the
   * view's border and corners lose their highlight (graphics.c DrawGridBorder, draw3d.c)
   */
  const [chatFocused, setChatFocused] = useState(false);
  /**
   * Hide Interface (ours, the Modern interface): the HUD, chat and character window put away, for
   * screenshots. The chat line still comes out to type in. Back with the same key.
   */
  const [hudHidden, setHudHidden] = useState(false);
  if (hudHidden && !modern) setHudHidden(false);
  /** The Modern interface's character window (ui/CharacterWindow.tsx), on the `tab` shown */
  const [characterOpen, setCharacterOpen] = useState(false);
  /**
   * The spell cooldown (cooldowns.ts) on the Modern hotbar and the phone's Cast button: each cast
   * we send starts it for the spell's post-cast delay (spelltimes.json), taken back if our mana
   * doesn't drop (the server refused the cast)
   */
  const castCooldown = useRef(new CastCooldown());
  /** spelltimes.json: each spell's post-cast delay, mana and reagents, by English name */
  const spellTimes = useRef<Record<string, StudySpellInfo>>({});
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  useEffect(() => {
    let live = true;
    let times: Record<string, StudySpellInfo> = {};
    assets
      .spellTimes()
      .then((t) => {
        if (!live) return;
        times = t;
        spellTimes.current = t;
      })
      .catch(() => {
        // Without it, no cooldowns
      });
    const world = session.world;
    const manaNow = () => world.stats.get(STAT_GROUP.MAIN)?.find((s) => s.num === STAT_MP)?.numeric?.value ?? null;
    const offCast = session.onCastSent((spell) => {
      const sp = world.spells.find((s) => s.object.id === spell);
      // By the English name, whatever language is shown
      const t = sp ? times[(session.englishResource(sp.object.nameRes) ?? "").toLowerCase()] : undefined;
      if (t && castCooldown.current.cast(t.postCast * 1000, t.mana, manaNow(), performance.now())) setCooldown(castCooldown.current.active);
    });
    const offWorld = world.on((e) => {
      if (e.type !== "stats") return;
      const mana = manaNow();
      if (mana !== null) castCooldown.current.mana(mana);
    });
    return () => {
      live = false;
      offCast();
      offWorld();
    };
  }, [session, assets]);
  // Expire it (or take it back) as time goes
  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => {
      if (castCooldown.current.tick(performance.now())) setCooldown(castCooldown.current.active);
    }, 100);
    return () => clearInterval(t);
  }, [cooldown]);
  /** itemslots.json: where worn items go on its paper doll */
  const [itemSlots, setItemSlots] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    assets
      .itemSlots()
      .then((t) => live && setItemSlots(t))
      .catch(() => {
        // Without it, everything in use stays in the bag
      });
    return () => {
      live = false;
    };
  }, [assets]);
  /** A clock for the Modern chat's fading lines, ticking once a second while it's shown */
  const [chatNow, setChatNow] = useState(() => Date.now());
  useEffect(() => {
    if (!modern) return;
    const t = setInterval(() => setChatNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [modern]);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** When the phone layout's chat was last open, for the mark on its button */
  const [chatSeenAt, setChatSeenAt] = useState(() => Date.now());
  const touchMove = useCallback((m: TouchMove) => sceneRef.current?.setTouchMove(m), []);
  const touchPress = useCallback((a: Action) => sceneRef.current?.press(a), []);
  // The full map: the joystick and the movement keys move by its directions while it's open
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.mapMode = fullMap;
  }, [fullMap]);
  const [fps, setFps] = useState<number | null>(null);
  /** Hide Interface just pressed: what it did and how to undo it, for a moment */
  const [hideNote, setHideNote] = useState<{ hidden: boolean; at: number } | null>(null);
  useEffect(() => {
    if (!hideNote) return;
    const t = setTimeout(() => setHideNote(null), VIEW_NOTE_MS);
    return () => clearTimeout(t);
  }, [hideNote]);
  /** The camera view just chosen (Camera View, the wheel), named over the view for a moment */
  const [viewNote, setViewNote] = useState<{ mode: ViewMode; at: number } | null>(null);
  useEffect(() => {
    if (!viewNote) return;
    const t = setTimeout(() => setViewNote(null), VIEW_NOTE_MS);
    return () => clearTimeout(t);
  }, [viewNote]);
  /** The chat window's height while its edge is being dragged (saved on letting go) */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  /** The Modern chat's width while its edge is being dragged */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  /** The Modern chat's place and height while it's being moved or its bottom edge dragged */
  const [dragChatAt, setDragChatAt] = useState<[number, number] | null>(null);
  const [dragTall, setDragTall] = useState<number | null>(null);
  /** When the Modern chat's tab strip was last pressed: a second press soon after puts the chat back */
  const chatStripPress = useRef(0);
  const gameRef = useRef<HTMLDivElement>(null);
  const getGameRoot = useCallback(() => gameRef.current, []);
  /** The 3D view's next frame, for Help's picture of the screen */
  const captureView = useCallback(() => sceneRef.current?.captureView() ?? Promise.resolve(null), []);
  /** When each chat tab was last looked at, for the new-lines mark on the others */
  const [seenAt, setSeenAt] = useState<Record<ChatTab, number>>(() => {
    const now = Date.now();
    return { all: now, chat: now, combat: now, server: now, debug: now };
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
  /** Study mode (study.ts): the study under way, and the banner's line about it */
  const studyRef = useRef<StudySession | null>(null);
  const [studying, setStudying] = useState<string | null>(null);
  /** Mana a second while resting, this character's (study.ts), for the estimates */
  const studyRegen = useRef<number | null>(null);
  /** The study's tick, which reads this render's functions */
  const studyTickRef = useRef<(refusal?: SpellRefusal) => void>(() => {});
  const stopStudyRef = useRef<() => void>(() => {});
  /** The room's map annotations (annotate.c), by its security checksum, and the one being edited */
  const [annotations, setAnnotations] = useState<{ security: number; list: MapAnnotation[] } | null>(() => {
    const p = session.world.player;
    return p ? { security: p.roomSecurity, list: loadAnnotations(localStorage, gameSocketUrl(), p.roomSecurity) } : null;
  });
  const [annotating, setAnnotating] = useState<{ index: number; x: number; y: number; text: string; existed: boolean } | null>(null);
  /** A message box over the game (MessageBox with MB_OK) */
  const [alert, setAlert] = useState<string | null>(null);
  /** The timer that says an offer wasn't taken (GiveDialog onOffered) */
  const offerWait = useRef<number | undefined>(undefined);
  /** Android's back button with nothing left to close: log off and quit? */
  const [quitAsk, setQuitAsk] = useState(false);
  // Android's back button (host.ts): a window first, then the phone layout's panels, then ask
  // before logging off, as closing the desktop app's window does mid-game
  useEffect(
    () =>
      onBackButton(() => {
        if (closeTopWindow()) return true;
        if (chatOpen || drawerOpen || fullMap) {
          (document.activeElement as HTMLElement | null)?.blur();
          setChatOpen(false);
          setDrawerOpen(false);
          setFullMap(false);
          return true;
        }
        setQuitAsk(true);
        return true;
      }),
    [chatOpen, drawerOpen, fullMap],
  );
  /**
   * The admin module (module/admin): loaded for admin characters; its window opened with
   * Shift+4, hidden rather than closed; its text and command history
   */
  const [adminConsole, setAdminConsole] = useState<{ open: boolean; text: string; command: string; history: string[] } | null>(null);
  /** The Quick Emotes menu (Q), over the top of the view */
  const [emoteMenu, setEmoteMenu] = useState(false);
  useEffect(() => {
    if (!emoteMenu) return;
    const esc = (e: KeyboardEvent) => {
      if (e.code === "Escape") setEmoteMenu(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [emoteMenu]);
  /** The Debug tab's lines (admins only) */
  const [debugLines, setDebugLines] = useState<ChatLine[]>([]);
  /** The chess module's window (module/chess), while the server has it loaded */
  const [chess, setChess] = useState<ChessState | null>(null);
  /** The same, for the toolbar's Rest/Stand toggle */
  const [resting, setRestingShown] = useState(false);
  useWorld(session.world, ["spells", "player", "roomContents"]);
  // The quick slots (quickSlots.ts), kept per character: loaded once we know who we are
  const selfInfo = session.world.self;
  const charName = selfInfo ? (session.resource(selfInfo.info.nameRes) ?? "") : "";
  const [quick, setQuick] = useState<{ name: string; slots: QuickSlots }>({ name: "", slots: emptySlots() });
  if (charName && quick.name !== charName) setQuick({ name: charName, slots: loadQuickSlots(localStorage, gameSocketUrl(), charName) });
  // Ours: the creator's Skip the tutorial (startCity.ts), sent once as the new character first enters
  useEffect(() => {
    const city = charName ? takeStartCity(localStorage, gameSocketUrl(), charName) : null;
    if (city) session.shardsCommand(`start ${city}`);
  }, [charName, session]);
  const changeSlots = (change: (slots: QuickSlots) => QuickSlots) =>
    setQuick((q) => {
      const slots = change([...q.slots]);
      if (q.name) saveQuickSlots(localStorage, gameSocketUrl(), q.name, slots);
      return { ...q, slots };
    });
  const setSlot = (i: number, slot: QuickSlot | null) =>
    changeSlots((slots) => {
      slots[i] = slot;
      return slots;
    });
  const swapSlots = (a: number, b: number) =>
    changeSlots((slots) => {
      [slots[a], slots[b]] = [slots[b], slots[a]];
      return slots;
    });
  /**
   * Ours (docs/adr/0005-friends.md, docs/adr/0015-social-on-our-server.md): this character's
   * friends, kept by our server, once we know who we are
   */
  const [social, setSocial] = useState<SocialLink | null>(null);
  // Our object is gone for a moment at every save (BP_INVALIDATE_DATA): keep the name we had, so the
  // link (and following) carries on
  const [socialName, setSocialName] = useState("");
  if (charName && charName !== socialName) setSocialName(charName);
  useEffect(() => {
    if (!socialName) return;
    let link: SocialLink | null = null;
    let live = true;
    SocialLink.start(session, assets, socialName, socialEvents).then(
      (l) => {
        if (!live) return l.dispose();
        link = l;
        setSocial(l);
      },
      (e: unknown) => console.warn("friends:", e),
    );
    return () => {
      live = false;
      link?.dispose();
      setSocial(null);
    };
  }, [session, assets, socialName, socialEvents]);
  // The scene draws friends' health bars and walks after the friend we follow (4, 5)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !social) return;
    scene.social = social;
    social.setRoomSize(() => {
      const r = scene.currentRoom;
      return r ? { width: r.width, height: r.height } : null;
    });
    // The scene stopped following of itself (we moved, the way was lost): the friend hears, the chat says why
    scene.onFollowStop = (why) => social.friends.stopFollowing(why);
    // The server starts and ends following (its list says whom we follow); the scene walks
    const offEvents = social.friends.onEvent((e) => {
      if (e.type === "startFollowing") scene.startFollowing(e.key, e.name);
      else if (e.type === "exit") scene.followExit(e.exit);
      else if (e.type === "stopFollowing") scene.stopFollowing(null);
    });
    if (social.friends.following) {
      const f = social.friends.friendByKey(social.friends.following);
      if (f) scene.startFollowing(f.key, f.name);
    }
    // 4.5: the follower casting, attacking or being hit stops it
    const offCast = session.onCastSent(() => social.friends.following && social.friends.stopFollowing("you cast a spell"));
    let hp = session.world.stats.get(STAT_GROUP.MAIN)?.find((x) => x.num === STAT_HP)?.numeric?.value ?? null;
    const offHit = session.world.on((e) => {
      if (e.type !== "stats" || e.group !== STAT_GROUP.MAIN) return;
      const now = session.world.stats.get(STAT_GROUP.MAIN)?.find((x) => x.num === STAT_HP)?.numeric?.value ?? null;
      if (now !== null && hp !== null && now < hp && social.friends.following) social.friends.stopFollowing("you were hit");
      hp = now;
    });
    return () => {
      offEvents();
      offCast();
      offHit();
      scene.stopFollowing(null);
      scene.social = null;
      scene.onFollowStop = undefined;
    };
  }, [social, session]);
  /** Ours (docs/adr/0016-abilities.md): Appraise's price prompt, for an item we carry */
  const [appraising, setAppraising] = useState<{ id: number; name: string; price: number } | null>(null);
  /**
   * Ours (docs/adr/0016-abilities.md): Appraise, as a small scales button, on a valuable item we
   * carry (magical, or worth 5,000: the server says, UC_APPRAISAL). Send to vault and Send to guild
   * ("vault", "guild" on a stack) still work on the server but have no buttons for now: fast
   * travel makes them less needed.
   */
  /**
   * Ours: one of our enchantments ends with "End <it>" beside OK (shardsabilities.kod Uncast; a
   * double click on it does too). It was "Cancel", alone in the corner, and read as closing the
   * window (2026-10-27).
   */
  const endEnchantmentButton = (look: LookResult): DescButton | undefined => {
    if (!session.world.enchantments.player.has(look.object.id)) return undefined;
    const name = look.name ? look.name.charAt(0).toUpperCase() + look.name.slice(1) : "it";
    return {
      label: `End ${name}`,
      title: "End it (curses and poisons can't be shaken off)",
      onClick: () => {
        cancelEnchantment(session, look.object.id);
        setDesc(null);
      },
    };
  };
  const itemAbilities = (look: LookResult): DescButton[] | undefined => {
    const item = session.world.inventory.get(look.object.id);
    const info = item ? appraisals.get(objId(item.id)) : undefined;
    if (!item || !info?.appraisable) return undefined;
    return [
      {
        label: "Appraise",
        title: info.price ? `Appraised for ${info.price.toLocaleString()} shillings: change or clear the price` : "Appraise it: set the price it sells for in the citizen's market",
        icon: <AppraiseIcon />,
        onClick: () => {
          setDesc(null);
          setAppraising({ id: item.id, name: session.resource(item.nameRes) ?? look.name, price: info.price });
        },
      },
    ];
  };
  /** Ours: Add or Remove friend on another player's description (our server asks them) */
  const friendButton = (look: LookResult) => {
    if (!social || !look.player || look.object.id === session.world.player?.id || !look.name) return undefined;
    const fs = social.friends;
    const f = fs.friendByName(look.name);
    if (f)
      return {
        label: "Remove friend",
        onClick: () => {
          fs.remove(f.key);
          setDesc(null);
        },
      };
    if (fs.outgoing.some((r) => r.name.toLowerCase() === look.name.toLowerCase())) return { label: "Asked", disabled: true, onClick: () => {} };
    return {
      label: "Add friend",
      title: "Ask them to be your friend",
      onClick: () => {
        const err = fs.add(look.name, socialName);
        if (err) session.localMessage(err);
        setDesc(null);
      },
    };
  };
  /** Follow a friend whose character is in our room (4.1) */
  const followFriend = (key: string) => {
    if (!social) return;
    const f = social.friends.friendByKey(key);
    if (!f) return;
    if (social.objectOf(key) === null) return session.localMessage(`${f.name} isn't here: you can only start following someone in your room.`);
    // The server checks and answers with its list, which starts the walking (startFollowing)
    const err = social.friends.startFollow(key);
    if (err) return session.localMessage(err);
    setModal(null);
  };
  /**
   * Ours (docs/adr/0006-pets.md): this character's pet. Our server keeps it (docs/adr/0015); this
   * browser's copy (pet.ts) shows it until the server says.
   */
  const [pet, setPetState] = useState<{ name: string; pet: ReturnType<typeof loadPet> }>({ name: "", pet: null });
  if (socialName && pet.name !== socialName) setPetState({ name: socialName, pet: loadPet(localStorage, gameSocketUrl(), socialName) });
  const choosePet = (p: ReturnType<typeof loadPet>) => {
    savePet(localStorage, gameSocketUrl(), pet.name, p);
    setPetState({ name: pet.name, pet: p });
  };
  useEffect(() => {
    if (!social) return;
    return social.onOwnPet((p) => {
      savePet(localStorage, gameSocketUrl(), social.character, p);
      setPetState({ name: social.character, pet: p });
    });
  }, [social]);
  /**
   * Our maximum health (piMax_health: STAT_HP's currentMax, its max always 100) and karma (the
   * Stats group's, -100 to 100), for the Pets tab; kept as they change, not on every regen tick
   */
  const [petStats, setPetStats] = useState<{ maxHealth: number | null; karma: number | null }>({ maxHealth: null, karma: null });
  useEffect(() => {
    const world = session.world;
    const read = () => {
      const maxHealth = world.stats.get(STAT_GROUP.MAIN)?.find((x) => x.num === STAT_HP)?.numeric?.currentMax ?? null;
      const karmaStat = world.stats.get(STAT_GROUP.STATS)?.find((x) => x.numeric && session.englishResource(x.nameRes)?.toLowerCase() === "karma");
      // Our server no longer sends Karma (always 0: docs/adr/0016-abilities.md): read as 0, the good fey
      const karma = karmaStat?.numeric?.value ?? 0;
      setPetStats((p) => (p.maxHealth === maxHealth && p.karma === karma ? p : { maxHealth, karma }));
    };
    read();
    return world.on((e) => e.type === "stats" && read());
  }, [session]);
  // The fey: good or dark as our karma goes (docs/adr/0006-pets.md), whichever was saved
  const ourPet = useMemo(() => {
    const group = pet.pet ? petKind(pet.pet.kind)?.group : undefined;
    const kind = group && petStats.karma !== null ? petForKarma(group.name, petStats.karma) : undefined;
    return pet.pet && kind && kind !== pet.pet.kind ? { ...pet.pet, kind } : pet.pet;
  }, [pet, petStats.karma]);
  // The Pets tab shows our karma's fey: the server sends the Stats group when asked
  useEffect(() => {
    if (tab === "pets") session.requestStats(STAT_GROUP.STATS);
  }, [tab, session]);
  // The scene walks it; our server keeps it and tells everyone in the room (3.1)
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) {
      scene.ownPet = ourPet;
      scene.ownName = pet.name;
    }
    social?.setPet(ourPet);
    // (status: the scene is made after this effect first runs; its first status means it's there)
  }, [ourPet, pet.name, social, status]);
  // Ours: the Friends and Pets tabs' pages, for the character window and the interface column
  const friendsPanel = (
    <FriendsPanel
      link={social}
      self={socialName}
      onFollow={followFriend}
    />
  );
  // Ours (docs/adr/0009-quests.md 5): our tracked quests' areas and the way to them, for the maps
  const questWays = useMemo(() => new QuestWays(assets, quests), [assets, quests]);
  const getWay = useCallback(() => questWays.get(sceneRef.current?.roomFile ?? ""), [questWays]);
  const openQuestInfo = useCallback((id: number) => setModal({ type: "questInfo", id }), []);
  const questsPanel = (
    <QuestsPanel
      store={quests}
      session={session}
      maxHealth={petStats.maxHealth}
      onOpen={openQuestInfo}
      showSuggested={settings.questSuggestions}
      onShowSuggested={(on) => updateSettings({ questSuggestions: on })}
    />
  );
  // Ours (docs/adr/0010-followers.md 9.2): the Companion tab
  const companionVersion = useCompanion(companion);
  // ...and its health under its name (gameScene.ts drawLabels)
  useEffect(() => {
    const scene = sceneRef.current;
    const s = companion.status;
    if (scene) scene.companion = s && s.id ? { id: s.id, hpPct: s.maxHp ? Math.round((100 * s.hp) / s.maxHp) : 0 } : null;
  }, [companion, companionVersion, status]);
  // Ours (docs/adr/0019-arena-bouts.md): the arenas' mock bouts. In an arena we ask where we stand
  // (the server tells everyone there as the floor changes), show the crossed swords, and draw the
  // bout's fighters' health under their names
  const arenaVersion = useArena(arena);
  const roomFile = status?.roomFile ?? "";
  const inArena = ARENA_ROOMS[roomFile] !== undefined;
  useEffect(() => {
    if (inArena) session.shardsCommand(arenaCommand("status"));
  }, [inArena, roomFile, session]);
  const arenaActive = inArena && !!arena.status && arena.status.state !== BOUT_STATE.IDLE;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const s = inArena ? arena.status : null;
    scene.arenaHp.clear();
    if (s && floorTaken(s)) for (const o of s.opponents) if (o.id) scene.arenaHp.set(o.id, o.maxHp ? Math.round((100 * o.hp) / o.maxHp) : 0);
    scene.arenaFloorBusy = floorTaken(s);
  }, [arena, arenaVersion, inArena, status]);
  const openArena = () => setModal({ type: "arena" });
  // Ours (docs/adr/0021): where we stand in the Faction War, once at logon (the War button
  // needs our liege); the server sends the battle to everyone as it changes
  useEffect(() => {
    session.shardsCommand("war");
  }, [session]);
  const openWar = () => setModal({ type: "war" });
  // Ours (docs/adr/0025): the server sends our achievements at logon; ask again in case that came
  // before we were listening
  useEffect(() => {
    session.shardsCommand("achievements");
  }, [session]);
  const openAchievements = () => setModal({ type: "achievements" });
  const comp = companion.status;
  const compObject = comp?.id ? (session.world.objects.get(comp.id)?.info ?? null) : null;
  const companionPanel = (
    <CompanionPanel
      status={comp}
      icons={icons}
      object={compObject}
      onCommand={(line) => session.shardsCommand(line)}
      onGive={() => comp?.id && setModal({ type: "give", kind: "deposit", target: { id: comp.id, name: comp.name } })}
      onTake={() => comp?.id && session.requestWithdrawal(comp.id)}
      onLooks={() => {
        if (!companion.charInfo) session.requestCharInfo();
        setModal({ type: "companionLooks" });
      }}
    />
  );
  const petsPanel = (
    <PetsPanel
      key={pet.name}
      icons={icons}
      current={ourPet}
      // 2.1: our maximum health, piMax_health: STAT_HP's currentMax (its max is always 100: user.kod sends
      // health as 4,GetHealth, 4,0, 4,100, 4,piMax_health)
      maxHealth={petStats.maxHealth}
      karma={petStats.karma}
      onChoose={choosePet}
    />
  );
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
    scene.onViewMode = (mode) => setViewNote({ mode, at: performance.now() });
    scene.onTypeChat = (t) => {
      setText((v) => v + t);
      inputRef.current?.focus();
    };
    scene.onTarget = setTarget;
    scene.onSelecting = setSelecting;
    scene.onMessage = (t) => session.localMessage(t);
    scene.onLook = (id) => lookRef.current(id);
    scene.onLookAmbient = (id) => setAmbientLook(scene.describeAmbient(id));
    const roomObjects = (ids: number[]) => ids.flatMap((id) => session.world.objects.get(id)?.info ?? []);
    // gameuser.c UserPickup: LD_MULTIPLESEL | LD_SINGLEAUTO
    scene.onPickup = (ids) =>
      ids.length === 1
        ? session.pickUp(ids[0])
        : setModal({ type: "list", title: "Get", items: roomObjects(ids), multiple: true, onDone: (c) => c.forEach((x) => session.pickUp(x.id)) });
    scene.onChoose = (title, ids, then, initial) =>
      setModal({ type: "list", title, items: roomObjects(ids), initial, onDone: (c) => c[0] && then(c[0].id) });
    scene.onContents = (id) => session.requestContents(id);
    scene.onBuy = (id) => askTraderRef.current(id);
    // command.c CommandDeposit with no amount, on this banker
    scene.onDeposit = (id) => {
      const o = session.world.objects.get(id);
      if (o) setModal({ type: "give", kind: "deposit", target: { id, name: session.resource(o.info.nameRes) ?? "" } });
    };
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

  useEffect(
    () =>
      trades((list) => {
        traderAsked.current = null; // answered: no need to ask the other way (askTrader)
        setModal({ type: "trade", list });
      }),
    [trades],
  );
  // Ours: a travel portal's places, and the PvP lockout (UC_PVP_UNTIL), shown as crossed swords
  const [pvpUntil, setPvpUntil] = useState(0);
  useEffect(
    () =>
      travel((e) => {
        if (e.type === "pvp") return setPvpUntil(Date.now() + e.seconds * 1000);
        setPvpUntil(Date.now() + e.pvpSeconds * 1000);
        setModal({ type: "travel", here: e.here, places: e.places });
      }),
    [travel],
  );
  // Ours (docs/adr/0009-quests.md 3.3): an NPC we talked to has quests for us (none: the server says so)
  useEffect(
    () =>
      questOffers((e) => {
        if (e.offers.length) setModal({ type: "quest", npc: e.npc, offers: e.offers });
      }),
    [questOffers],
  );
  // Ours (docs/adr/0012-cosmetics.md): a tailor's or barber's menu. Their quests come first: the
  // quest window gains a button for it. A new menu from the same NPC (after dyeing) refreshes it.
  useEffect(
    () =>
      cosmetics((e) => {
        if (e.type === "barber" && !companion.charInfo) session.requestCharInfo();
        setModal((m) => (m?.type === "quest" && m.npc === e.npc ? { ...m, service: e } : { type: "cosmetics", menu: e }));
      }),
    [cosmetics, companion, session],
  );
  // Ours (docs/adr/0016-abilities.md): what we can train, and the prices, as the server last said
  const [trainCosts, setTrainCosts] = useState<Map<number, number> | null>(null);
  useEffect(() => training((list) => setTrainCosts(new Map(list.map((t) => [t.id, t.cost])))), [training]);
  // Ours (docs/adr/0016-abilities.md): which of our items can be appraised, as the server last said
  const [appraisals, setAppraisals] = useState<ReadonlyMap<number, Appraisal>>(() => new Map());
  useEffect(() => appraisal((a) => setAppraisals((m) => new Map(m).set(a.id, a))), [appraisal]);
  /**
   * Ours: what the buyer our Offer window is for would take and pay (UC_SELLABLE), asked for when
   * it opens (openOffer). `sellWait` ends the wait for a server that doesn't answer: the window
   * then lists everything we carry.
   */
  const [sold, setSold] = useState<{ npc: number; prices: ReadonlyMap<number, number> } | null>(null);
  const [sellWaitOver, setSellWaitOver] = useState(false);
  const sellWait = useRef<number | undefined>(undefined);
  useEffect(
    () =>
      sellable((s) => {
        window.clearTimeout(sellWait.current);
        setSold({ npc: s.npc, prices: new Map(s.items.map((i) => [i.id, i.price])) });
      }),
    [sellable],
  );
  /**
   * Ours: the Offer window for someone. A buyer (MM_BUYS) is asked what it would take, and the
   * window lists only that, with prices; anyone else (a quest NPC, a banker, a player) gets
   * everything we carry.
   */
  const openOffer = (id: number) => {
    const o = session.world.objects.get(id);
    setSold(null);
    setSellWaitOver(false);
    window.clearTimeout(sellWait.current);
    if (o && o.info.minimapFlags & MM_OURS.BUYS && !(o.info.flags & OF_PLAYER)) {
      session.shardsObject(id, "sell list");
      sellWait.current = window.setTimeout(() => setSellWaitOver(true), Math.max(1500, 2 * (latency ?? 150) + 1000));
    } else {
      setSellWaitOver(true);
    }
    setModal({ type: "give", kind: "offer", target: { id, name: (o && session.resource(o.info.nameRes)) ?? "" } });
  };
  // Development: the admin dashboard changed the quests (tools/dev/questApi.ts); read them again
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const onQuests = () => {
      void quests.loadCatalog(true);
      session.shardsCommand("quest log");
    };
    hot.on("shards:quests", onQuests);
    return () => hot.off("shards:quests", onQuests);
  }, [quests, session]);
  // game.c ResetUserData: AbortLookList; the description and pick lists hold stale ids
  useEffect(
    () =>
      session.world.on((e) => {
        if (e.type !== "idsStale") return;
        setDesc(null);
        // chess.c EventResetData: the game's id is stale, so the module goes
        setChess(null);
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
  useEffect(
    () =>
      offers((e) => {
        window.clearTimeout(offerWait.current); // answered: nothing to explain (GiveDialog onOffered)
        setOffer((prev) => reduceOffer(prev, e));
      }),
    [offers],
  );
  useEffect(() => damage((d) => sceneRef.current?.showDamage(d)), [damage]);
  useEffect(() => statChange(setStatChangeAt), [statChange]);
  // modules.c: BP_LOAD_MODULE "chess.dll" opens the chess window; BP_UNLOAD_MODULE closes it
  useEffect(
    () =>
      modules(({ name, loaded }) => {
        if (/^admin/i.test(name)) return setAdminConsole((a) => (loaded ? (a ?? { open: false, text: "", command: "", history: [] }) : null));
        if (!/^chess/i.test(name)) return;
        setChess((c) => (loaded ? (c ?? { game: 0, color: OBSERVER, board: null, names: ["", ""] }) : null));
      }),
    [modules],
  );
  useEffect(() => admin((text) => setAdminConsole((a) => (a ? { ...a, text: appendAdminText(a.text, text) } : a))), [admin]);
  // admin.c admin_key_table: Shift+4 opens the console (in the game, not while typing)
  const adminLoaded = adminConsole !== null;
  // Ours: the Debug tab, the admins' console.log: every sound played (to find one), and the like
  useEffect(() => {
    if (!adminLoaded) return;
    return audio.onLog((text) =>
      setDebugLines((d) => [...d.slice(-(MAX_DEBUG_LINES - 1)), { kind: "system", channel: "debug", spans: [{ text }], time: Date.now() }]),
    );
  }, [adminLoaded, audio]);
  useEffect(() => {
    if (!adminLoaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "$" || (e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      e.preventDefault();
      setAdminConsole((a) => (a ? { ...a, open: true } : a));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminLoaded]);
  /** Ours: every room (rooms.json), for the console's Travel tab, loaded when the module is */
  const [adminRooms, setAdminRooms] = useState<AdminRoom[]>([]);
  useEffect(() => {
    if (!adminLoaded) return;
    let live = true;
    assets
      .roomList()
      .then((r) => live && setAdminRooms(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [adminLoaded, assets]);
  /** BK_SENDCMD: to the server, and to the top of the history unless it's there already */
  const rememberAdmin = (command: string) =>
    setAdminConsole((a) =>
      a ? { ...a, command, history: a.history[0]?.toLowerCase() === command.toLowerCase() ? a.history : [command, ...a.history] } : a,
    );
  const adminCommand = (command: string) => {
    session.adminCommand(command);
    rememberAdmin(command);
  };
  /**
   * Ours (the remaster's console): a DM command (SAY_DM, module/dm's "dm"), echoed in the
   * console; the server's messages in the next few seconds are its answers, copied there too
   */
  const dmAnswersUntil = useRef(0);
  const dmSeen = useRef(new WeakSet<ChatLine>());
  const adminDm = (text: string) => {
    if (!text) return;
    session.say(text, SAY.DM);
    dmAnswersUntil.current = Date.now() + DM_ANSWER_MS;
    rememberAdmin(`dm ${text}`);
    setAdminConsole((a) => (a ? { ...a, text: appendAdminText(a.text, `> dm ${text}\n`) } : a));
  };
  useEffect(() => {
    const until = dmAnswersUntil.current;
    if (Date.now() > until) return;
    const answers = chat
      .slice(-20)
      .filter((l) => l.kind === "system" && l.time >= until - DM_ANSWER_MS && !dmSeen.current.has(l))
      .map((l) => (dmSeen.current.add(l), l.spans.map((s) => s.text).join("")));
    if (answers.length) setAdminConsole((a) => (a ? { ...a, text: appendAdminText(a.text, answers.join("\n") + "\n") } : a));
  }, [chat]);
  useEffect(
    () =>
      minigame((e) => {
        setChess((c) => {
          if (!c) return c;
          switch (e.type) {
            case "start": {
              // HandleGameStart: once; player 1 is white, 2 red, the rest watch. Our own name goes up
              if (c.game) return c;
              const color = e.player === 1 ? WHITE : e.player === 2 ? BLACK : OBSERVER;
              const self = session.world.self;
              const names: [string, string] = [...c.names];
              if (color !== OBSERVER && self) names[color] = session.resource(self.info.nameRes) ?? "";
              return { ...c, game: e.game, color, names };
            }
            case "state":
              // HandleGameState: only our game's
              return e.game === c.game ? { ...c, board: decodeBoard(e.state) } : c;
            case "player": {
              if (!c.game || (e.player !== 1 && e.player !== 2)) return c;
              const names: [string, string] = [...c.names];
              names[e.player - 1] = e.name;
              return { ...c, names };
            }
          }
          return c;
        });
      }),
    [minigame, session],
  );
  // logoff.c: log off after the Logout timer's minutes without a key or a click (UserDidSomething).
  // onLogout is new on every render, so the timer reads it through a ref.
  const logoutRef = useRef(onLogout);
  useEffect(() => {
    logoutRef.current = onLogout;
  }, [onLogout]);
  useEffect(() => {
    let last = Date.now();
    const alive = () => (last = Date.now());
    const opts = { capture: true, passive: true };
    window.addEventListener("keydown", alive, opts);
    window.addEventListener("pointerdown", alive, opts);
    const timer = setInterval(() => {
      const s = getSettings();
      // Study mode is the player's choice to be away: it ends with its own log off
      if (studyRef.current) last = Date.now();
      if (s.logoutTimer && s.logoutMinutes > 0 && Date.now() - last >= s.logoutMinutes * 60_000) logoutRef.current();
    }, 10_000);
    return () => {
      window.removeEventListener("keydown", alive, opts);
      window.removeEventListener("pointerdown", alive, opts);
      clearInterval(timer);
    };
  }, []);

  // Study mode's clock: a tick twice a second while shown, and every 5 s from a worker (timers in
  // hidden tabs are throttled), on every change to our stats, and on the server's refusals
  const studyActive = studying !== null;
  useEffect(() => {
    if (!studyActive) return;
    const tick = () => studyTickRef.current();
    const timer = setInterval(tick, STUDY_TICK_MS);
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./pingWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = tick;
    } catch {
      // No workers: the interval alone
    }
    const offStats = session.world.on((e) => e.type === "stats" && tick());
    const offRefused = session.onSpellRefused((r) => studyTickRef.current(r));
    // Esc, a movement key, attacking or a click in the view: the player is back
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.code === "Escape" || actionsFor(getSettings().keys, e.code, { alt: e.altKey, ctrl: e.ctrlKey }).some((a) => STUDY_STOP_ACTIONS.has(a)))
        stopStudyRef.current();
    };
    const canvas = canvasRef.current;
    const onPointer = () => stopStudyRef.current();
    window.addEventListener("keydown", onKey, true);
    canvas?.addEventListener("pointerdown", onPointer);
    // Keep a phone's screen on: Android freezes the app soon after it's put away
    let lock: WakeLockSentinel | null = null;
    let live = true;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => {
        if (live) lock = l;
        else void l.release();
      })
      .catch(() => {
        // Not allowed (no user gesture, a desktop without it): fine
      });
    return () => {
      live = false;
      clearInterval(timer);
      worker?.terminate();
      offStats();
      offRefused();
      window.removeEventListener("keydown", onKey, true);
      canvas?.removeEventListener("pointerdown", onPointer);
      void lock?.release();
    };
  }, [studyActive, session]);
  // map.c MapEnterRoom: the new room's annotations
  useEffect(
    () =>
      session.world.on((e) => {
        if (e.type !== "player") return;
        const security = e.player.roomSecurity;
        setAnnotations((a) => (a?.security === security ? a : { security, list: loadAnnotations(localStorage, gameSocketUrl(), security) }));
      }),
    [session],
  );
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
  }, [chat, debugLines, settings.scrollLock, settings.chatTab]);

  /** gameuser.c GetObjects3D(CLOSE_DISTANCE, flag): the nearest object with the flag. */
  const nearest = (flag: number) => {
    const self = session.world.self;
    // Ours: our companion answers Deposit and Withdraw too (docs/adr/0010-followers.md 9.4); a
    // banker or trader near us comes first, and the companion only when there's nobody else
    const compId = companion.status?.id ?? 0;
    let best: { id: number; d: number } | null = null;
    let comp: { id: number; d: number } | null = null;
    for (const o of session.world.objects.values()) {
      if (!self || o.id === self.id || !(o.info.flags & flag)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d > CLOSE_DISTANCE) continue;
      if (o.id === compId) comp = { id: o.id, d };
      else if (!best || d < best.d) best = { id: o.id, d };
    }
    const pick = best ?? comp;
    return pick ? session.world.objects.get(pick.id)! : null;
  };

  /** Keys and typed commands that open panels and dialogs or talk to traders. */
  const handleAction = (a: string): void => {
    if (a.startsWith("quickSlot")) {
      const i = Number(a.slice("quickSlot".length)) - 1;
      // The second row (11-20) shows only in the Modern interface with Second Hotbar on: elsewhere its keys do nothing
      if (i >= QUICK_SLOTS && !(modern && settings.secondHotbar)) return;
      return activateSlot(i);
    }
    const toggle = (type: "preferences" | "configuration" | "actions" | "war" | "achievements") => setModal((m) => (m?.type === type ? null : { type }));
    switch (a) {
      case "hideInterface":
        if (!modern) return;
        setHudHidden(!hudHidden);
        // `at` only keys the note, so a second press restarts its fade
        return setHideNote((n) => ({ hidden: !hudHidden, at: (n?.at ?? 0) + 1 }));
      case "inventory":
        // The Modern interface: the key opens and closes the character window, on its bag
        if (modern) setCharacterOpen((open) => !open || tab !== "inventory");
        return setTab("inventory");
      case "settings":
        return toggle("preferences");
      case "configuration":
        return toggle("configuration");
      case "actions":
        return toggle("actions");
      case "war":
        // Ours: the War window (docs/adr/0021)
        return toggle("war");
      case "achievements":
        // Ours: the Achievements window (docs/adr/0025)
        return toggle("achievements");
      case "quickEmotes":
        return setEmoteMenu((v) => !v);
      case "friends":
      case "pets":
      case "companion":
        // Ours: tabs beside the inventory's; the key opens and closes the character window on its tab
        return openTab(a, true);
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
        return openOffer(o.id);
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

  /**
   * A tab of the character window (Modern) or the interface column (Classic, the phone's drawer):
   * shown, or with `toggle` (its key) put away again when it's showing
   */
  const openTab = (t: Tab, toggle = false) => {
    if (modern) setCharacterOpen((open) => !toggle || !open || tab !== t);
    else if (touch) setDrawerOpen((open) => !toggle || !open || tab !== t);
    setTab(t);
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
    if (modern) setCharacterOpen(true);
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

  /** say.c FilterSayMessage: speech with profanity is blocked (IDS_PROFANITYWARNING), then tidied */
  const sayFilter = (text: string): string | null => {
    if (isProfane(text)) {
      setAlert(PROFANITY_WARNING);
      return null;
    }
    const t = filterSayMessage(text);
    if (t === null) return null;
    // Ours: the server drops a line over MAX_CHAT_LEN bytes without a word; emoji and item
    // links take several bytes each (ADR 0024)
    const bytes = utf8Length(t);
    if (bytes > MAX_CHAT_BYTES) {
      session.localMessage(`That's too long to say (${bytes} of ${MAX_CHAT_BYTES} bytes; emoji and item links take more than letters).`);
      return null;
    }
    return t;
  };

  /** Ours (ADR 0024): put text at the chat input's caret, and bring the chat up */
  const insertIntoChat = (insert: string) => {
    const el = inputRef.current;
    // At the caret while the line has the focus; from the inventory (which takes it), at the end
    const focused = !!el && document.activeElement === el;
    const at = insertAt(el?.value ?? text, insert, focused ? el.selectionStart : null, focused ? el.selectionEnd : null);
    setText(at.text);
    if (touch) setChatOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at.caret, at.caret);
    });
  };

  /** Ours (ADR 0024): an inventory item linked in chat, as "[name]" in the input */
  const linkItem = (o: ObjectInfo) => {
    const name = session.itemName(o);
    const token = chatLinkToken(session.resource(o.iconRes) ?? "", o.translation, o.flags, name);
    if (!token) return;
    const label = chatLinkLabel(name);
    chatLinks.current.set(label, token);
    insertIntoChat(label);
  };

  /** Speech, filtered as say.c FilterSayMessage does */
  const say = (text: string, kind: number) => {
    const t = sayFilter(text);
    if (t) session.say(t, kind);
  };

  /** gameuser.c: inventory items to choose from (LD_SINGLEAUTO: just one is taken at once) */
  const chooseInventory = (title: string, onDone: (c: LookListChoice[]) => void) => {
    const items = [...session.world.inventory.values()];
    if (!items.length) return;
    if (items.length === 1) return onDone([{ id: items[0].id, amount: isNumberItem(items[0].id) ? items[0].amount : undefined }]);
    setModal({ type: "list", title, items, multiple: true, amounts: true, onDone });
  };

  /**
   * Ours: a double click or tap on a shopkeeper or banker (OF_BUYABLE). Vault keepers and
   * shopkeepers look the same here, and user.kod answers BP_REQ_WITHDRAWAL only for a vault
   * keeper (MobIsVaultman), while BP_REQ_BUY to one would list our stored things for sale. So
   * ask to withdraw first, and to buy if no list has come back in about a round trip.
   */
  const askTrader = (id: number) => {
    window.clearTimeout(traderAsked.current?.timer);
    session.requestWithdrawal(id);
    const timer = window.setTimeout(() => {
      if (traderAsked.current?.id !== id) return;
      traderAsked.current = null;
      session.requestBuy(id);
    }, Math.max(500, 2 * (latency ?? 150) + 300));
    traderAsked.current = { id, timer };
  };
  useEffect(() => {
    askTraderRef.current = askTrader;
  });

  /** mermain.c A_CASTSPELL: not while paralyzed or resting */
  const castSpell = (spell: number, numTargets: number) => {
    stopStudy();
    if (session.world.effects.paralyzed) return session.localMessage("You can't lift your hands to cast the spell!");
    if (restingRef.current) return session.localMessage("You can't cast spells while you're resting.");
    sceneRef.current?.castSpell(spell, numTargets);
  };

  /**
   * A quick slot's key, click or tap: cast its spell, or use its item as a double click in the
   * inventory would (inventry.c A_TOGGLEUSE). An empty slot opens the picker.
   */
  const activateSlot = (i: number) => {
    const slot = quick.slots[i];
    if (!slot) return setModal({ type: "quickSlot", index: i });
    const rs = (id: number) => session.resource(id) ?? "";
    if (slot.kind === "spell") {
      const s = slotSpell(slot, session.world.spells, rs);
      if (!s) return session.localMessage(`You don't know the spell ${slot.name}.`);
      return castSpell(s.object.id, s.numTargets);
    }
    const o = slotItem(slot, session.world.inventory.values(), session.world.inUse, rs);
    if (!o) return session.localMessage(`You aren't carrying ${slot.name}.`);
    if (o.flags & OF_APPLYABLE) return sceneRef.current?.beginSelect((t) => session.apply(o.id, t));
    if (session.world.inUse.has(o.id)) session.unuse(o.id);
    else session.use(o.id);
  };

  /** command.c CommandRest / CommandStand: the server's resting, and ours (no moving or fighting) */
  const setResting = (on: boolean) => {
    stopStudy();
    if (on === restingRef.current) return session.localMessage(on ? "You're already resting." : "You're not resting.");
    restNow(on);
  };
  const restNow = (on: boolean) => {
    if (on === restingRef.current) return;
    session.userCommand(on ? UC.REST : UC.STAND);
    session.localMessage(on ? "You rest." : "You stop resting.");
    restingRef.current = on;
    setRestingShown(on);
    if (sceneRef.current) sceneRef.current.resting = on;
  };

  // ---- Study mode (ours; study.ts): practise a spell while away, so players needn't run bots ----
  const englishName = (res: number) => (session.englishResource(res) ?? "").toLowerCase();
  const studySnapshot = (): StudySnapshot => {
    const main = session.world.stats.get(STAT_GROUP.MAIN);
    const mp = main?.find((st) => st.num === STAT_MP)?.numeric;
    const hp = main?.find((st) => st.num === STAT_HP)?.numeric;
    return { mana: mp?.value ?? null, maxMana: mp?.currentMax ?? null, hp: hp?.value ?? null, resting: restingRef.current };
  };
  /** What we carry, by English name: number items (reagents) by their amount */
  const carried = () =>
    carriedCounts([...session.world.inventory.values()].map((o) => ({ name: englishName(o.nameRes), amount: isNumberItem(o.id) ? o.amount : 1 })));
  const studyMemory = () => loadStudyMemory(localStorage, gameSocketUrl(), charName);
  const studySpells = (): StudySpell[] =>
    session.world.spells
      .map((sp) => {
        const key = englishName(sp.object.nameRes);
        return { key, label: session.resource(sp.object.nameRes) ?? key, info: spellTimes.current[key] };
      })
      .filter((sp) => sp.key)
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  const studySpell = (key: string) => session.world.spells.find((sp) => englishName(sp.object.nameRes) === key);

  /** The Study window, on `spell` (an English name) or the last one studied */
  /** Ours: the Train window (the Stats tab's Train button, typed train), with the prices asked for afresh */
  const openTrain = (search = "") => {
    session.shardsCommand("train list");
    setModal({ type: "train", search });
  };

  const openStudy = (spell?: string) => {
    if (studyRef.current) return session.localMessage("You're already studying. Stop first (Esc).");
    const memory = spell ? { ...studyMemory(), spell } : studyMemory();
    const snap = studySnapshot();
    setModal({ type: "study", spells: studySpells(), carried: carried(), mana: snap.mana ?? 0, maxMana: snap.maxMana ?? 0, memory });
  };

  /** The banner's line: the spell, the casts, what we're doing and the time left */
  const studyLine = (st: StudySession) => {
    const sp = studySpell(st.config.spell);
    const name = sp ? (session.resource(sp.object.nameRes) ?? st.config.spell) : st.config.spell;
    const snap = studySnapshot();
    const left = st.config.count === null ? null : Math.max(st.config.count - st.casts, 0);
    const est = studyEstimate(
      st.info, left, castsFromReagents(st.info, (n) => carried().get(n) ?? 0), snap.mana ?? 0, snap.maxMana ?? 0, st.regen ?? studyRegen.current ?? DEFAULT_REST_REGEN,
    );
    const doing: Record<StudyPhase, string> = {
      cast: "Casting", confirm: "Casting", cooldown: "Casting", done: "Done",
      rest: `Resting (mana ${snap.mana ?? "?"}/${snap.maxMana ?? "?"})`,
    };
    const count = st.config.count === null ? "" : ` / ${st.config.count}`;
    const time = est.seconds === null ? "" : ` · ${formatDuration(est.seconds)} left`;
    return `Studying ${name}: ${st.casts}${count} · ${doing[st.phase]}${time}`;
  };

  const endStudy = (st: StudySession, reason: string, logOff: boolean) => {
    studyRef.current = null;
    setStudying(null);
    // Keep this character's resting rate for the next estimate
    if (st.regen !== null) {
      studyRegen.current = st.regen;
      saveStudyMemory(localStorage, gameSocketUrl(), charName, { ...studyMemory(), regen: st.regen });
    }
    session.localMessage(`${reason} (${st.casts} cast${st.casts === 1 ? "" : "s"})`);
    if (logOff) onLogout(`${reason} You studied ${st.casts} cast${st.casts === 1 ? "" : "s"} and were logged off.`);
  };

  /** Do what the study says: cast (on ourselves, for a spell that wants a target), rest, stand, end */
  const runStudy = (actions: StudyAction[]) => {
    const st = studyRef.current;
    if (!st) return;
    for (const a of actions) {
      switch (a.type) {
        case "cast": {
          const sp = studySpell(st.config.spell);
          if (!sp) return runStudy(st.cancel(`You don't know ${st.config.spell} any more.`));
          const self = session.world.player?.id;
          // Paralyzed: the cast goes unconfirmed, and enough of those end the study
          if (!session.world.effects.paralyzed) session.cast(sp.object.id, sp.numTargets && self !== undefined ? [{ id: self, amount: 1 }] : []);
          break;
        }
        case "rest":
          restNow(true);
          break;
        case "stand":
          restNow(false);
          break;
        case "finish":
          return endStudy(st, a.reason, a.logOff);
      }
    }
    setStudying(studyLine(st));
  };

  const startStudy = (config: StudyConfig) => {
    setModal(null);
    const info = spellTimes.current[config.spell];
    const sp = studySpell(config.spell);
    if (!info || !sp) return;
    const memory = studyMemory();
    studyRegen.current = memory.regen;
    saveStudyMemory(localStorage, gameSocketUrl(), charName, { ...memory, spell: config.spell, count: config.count, logOff: config.logOff });
    const st = new StudySession(config, info);
    studyRef.current = st;
    session.localMessage(`You begin studying ${session.resource(sp.object.nameRes) ?? config.spell}. Esc, a movement key or a click in the view stops it.`);
    setStudying(studyLine(st));
    studyTickRef.current();
  };

  /** The player is back (or chose to stop): no log off */
  const stopStudy = () => {
    const st = studyRef.current;
    if (st) runStudy(st.cancel());
  };

  useEffect(() => {
    stopStudyRef.current = stopStudy;
    studyTickRef.current = (refusal?: SpellRefusal) => {
      const st = studyRef.current;
      if (!st) return;
      const now = performance.now();
      const snap = studySnapshot();
      runStudy(refusal ? st.refused(refusal.reason, refusal.spell, now, snap) : st.step(now, snap));
    };
  });

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

  /** annotate.c MapAnnotationClick: edit the annotation there, or start one in a free slot */
  const annotateAt = (x: number, y: number) => {
    if (!annotations) return;
    const i = annotationAt(annotations.list, x, y);
    if (i >= 0) return setAnnotating({ index: i, x, y, text: annotations.list[i].text, existed: true });
    if (annotations.list.length >= MAX_ANNOTATIONS) return session.localMessage(`You may only have ${MAX_ANNOTATIONS} map annotations per room.`);
    setAnnotating({ index: annotations.list.length, x, y, text: "", existed: false });
  };
  /** IDOK or IDC_DELETE: keep the room's annotations (an empty one is gone) */
  const finishAnnotation = (text: string) => {
    if (!annotations || !annotating) return;
    const list = [...annotations.list];
    if (annotating.existed) list[annotating.index] = { ...list[annotating.index], text };
    else list.push({ x: annotating.x, y: annotating.y, text });
    const kept = list.filter((a) => a.text);
    saveAnnotations(localStorage, gameSocketUrl(), annotations.security, kept);
    setAnnotations({ security: annotations.security, list: kept });
    setAnnotating(null);
  };

  /** language.c MenuLanguageChosen: strings in the new language from now on, the spells' names too */
  const chooseLanguage = (id: number) => {
    updateSettings({ language: id });
    session.setLanguage(id);
  };

  /** command.c Command*: one command, with the words after its name */
  const runParsed = (id: CommandId, args: string): void => {
    const world = session.world;
    const players = () => [...world.players.values()].map((p) => ({ id: p.id, name: p.name }));
    const window = COMMAND_WINDOWS[id];
    // "alias word command" defines a command alias; alone it opens the window
    if (window && !((id === "alias" || id === "cmdalias") && args)) return openWindow(window);
    const ua = USER_ACTIONS[id];
    if (ua !== undefined) {
      // Ours: townsfolk close by wave back
      if (ua === UA.WAVE) sceneRef.current?.waveAtAmbient();
      return session.action(ua);
    }
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
        const text = sayFilter(r.text);
        if (text) session.sayTo(r.ids, text);
        return;
      }
      case "appeal": {
        const text = sayFilter(args);
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
      case "study": {
        if (!args.trim()) return openStudy();
        const sp = findSpell(world.spells.map((x) => ({ ...x, name: session.resource(x.object.nameRes) ?? "" })), args);
        if (sp === "none") return session.localMessage("There is no spell with that name.");
        if (sp === "ambiguous") return session.localMessage("That spell name is ambiguous.");
        return openStudy(englishName(sp.object.nameRes));
      }
      case "train":
        return openTrain(args.trim());
      case "hel":
        return session.localMessage('Type the entire word "help" to open help.');
      case "help":
        return setModal({ type: "help" });
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
      case "companion":
        // Ours: our companion's commands (companionbook.kod CompanionCommand); alone, its status
        return session.shardsCommand(`companion ${args || "status"}`);
      case "arena":
        // Ours: "arena join", "arena leave"...; alone, the Arena window (docs/adr/0019-arena-bouts.md)
        return args ? session.shardsCommand(`arena ${args}`) : setModal({ type: "arena" });
      case "war":
        // Ours: the War window (docs/adr/0021-factions-and-the-faction-war.md)
        return openWar();
      case "achievements":
        // Ours: the Achievements window (docs/adr/0025-achievements.md)
        return openAchievements();
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
            self &&
            o.id !== self.id &&
            (o.info.flags & (OF_ACTIVATABLE | OF_CONTAINER) || o.info.minimapFlags & MM_TALK_NPC) &&
            !(o.info.flags & OF_PLAYER) &&
            Math.hypot(o.x - self.x, o.y - self.y) <= CLOSE_DISTANCE,
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
    // textin.c TextInputKey: lines that meant something go in the history, once in a row (with
    // item links as their names, which still expand while the session remembers them)
    if (runCommand(expandChatLinks(text, chatLinks.current))) {
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
    // Ours: a shopkeeper's or vault keeper's description has Buy, as a double click on them does
    const o = session.world.objects.get(id);
    if (o && o.info.flags & OF_BUYABLE && !(o.info.flags & OF_PLAYER)) buttons |= DESC.BUY;
    // Sell: someone who pays for what we offer (the server's MM_BUYS), not one who only receives quest items
    if (o && o.info.flags & OF_BUYABLE && o.info.minimapFlags & MM_OURS.BUYS && !(o.info.flags & OF_PLAYER)) buttons |= DESC.SELL;
    descParams.current = buttons;
    session.look(id);
  };

  /** gameuser.c SetDescParamsByRoomObject: close by, a room object can be got, used or activated. */
  const lookRoomObject = (id: number) => {
    // admin.c A_LOOKMOUSE: with the admin console showing, show the object there instead
    if (adminConsole?.open) return adminCommand(`show object ${objId(id)}`);
    const o = session.world.objects.get(id);
    const self = session.world.self;
    let buttons: number = DESC.NONE;
    if (o && self && Math.hypot(o.x - self.x, o.y - self.y) <= CLOSE_DISTANCE) {
      const f = o.info.flags;
      if (f & OF_CONTAINER) buttons |= DESC.INSIDE;
      // Ours: someone with a quest marker is talked to by activating them (docs/adr/0009-quests.md 3.3)
      if ((f & OF_ACTIVATABLE || o.info.minimapFlags & MM_TALK_NPC) && !(f & OF_PLAYER)) {
        buttons |= DESC.ACTIVATE;
        // Ours: talking to an NPC is about quests; a tailor's or barber's Use opens their window
        if ((f & OF_NPC || o.info.minimapFlags & MM_QUEST_NPC) && !(o.info.minimapFlags & MM_OURS.SERVICE)) buttons |= DESC.TALK;
      }
      if (f & OF_GETTABLE) {
        buttons |= DESC.GET;
        if (!(f & OF_ACTIVATABLE)) buttons |= DESC.USE;
      }
    }
    lookAt(id, buttons);
  };

  /** inventry.c A_LOOKINVENTORY: Drop, and Unuse, Use (apply) or Use. */
  const lookInventoryItem = (o: ObjectInfo) => {
    // admin.c A_LOOKINVENTORY, likewise
    if (adminConsole?.open) return adminCommand(`show object ${objId(o.id)}`);
    let buttons: number = DESC.DROP;
    if (session.world.inUse.has(o.id)) buttons |= DESC.UNUSE;
    else if (o.flags & OF_APPLYABLE) buttons |= DESC.APPLY;
    else buttons |= DESC.USE;
    // Ours: whether it can be appraised (UC_APPRAISAL), for its description's Appraise button
    if (!isNumberItem(o.id)) session.shardsObject(o.id, "appraise ask");
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

  /** Ours: a shopkeeper who also pays for what we offer (the server's MM_BUYS, not a player): their Buy window has Sell */
  const takesFromUs = (id: number) => {
    const o = session.world.objects.get(id);
    return !!o && (o.info.minimapFlags & MM_OURS.BUYS) !== 0 && (o.info.flags & OF_PLAYER) === 0;
  };
  /** dialog.c DescDialogProc's buttons, on the object the dialog shows. */
  const descAction = (a: DescAction, id: number, buttons: number) => {
    switch (a) {
      case "buy":
        return askTrader(id);
      case "sell":
        return openOffer(id);
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

  // The Debug tab is the admins' alone
  const chatTab = settings.chatTab === "debug" && !adminLoaded ? "all" : settings.chatTab;
  const shown = chatTab === "debug" ? debugLines : chat.filter((l) => inTab(chatTab, l));
  /** `at`: the click's time, in the chat lines' clock (ms since 1970) */
  const pickTab = (tab: ChatTab, at: number) => {
    const now = at;
    // Leaving All, everything in it has been seen
    setSeenAt((s) => (chatTab === "all" ? { ...s, all: now, chat: now, combat: now, server: now } : { ...s, [chatTab]: now, [tab]: now }));
    atBottomRef.current = true;
    updateSettings({ chatTab: tab });
  };
  /**
   * The Modern chat's edges: its right edge makes it wider or narrower, its bottom edge taller or
   * shorter, the corner between them both. It's zoomed by the HUD size: its size is in its own
   * pixels, the pointer's in the page's.
   */
  const resizeModernChat = (e: ReactPointerEvent<HTMLDivElement>, across: boolean, down: boolean) => {
    const game = gameRef.current;
    const chat = e.currentTarget.parentElement;
    if (!game || !chat) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const zoom = settings.hudScale / 100;
    const g = game.getBoundingClientRect();
    const c = chat.getBoundingClientRect();
    const widthAt = (x: number) => Math.round(Math.max(MIN_CHAT_WIDTH, Math.min(g.right - 10 - c.left, x - c.left) / zoom));
    const tallAt = (y: number) => Math.round(Math.max(MIN_CHAT_TALL, Math.min(g.bottom - 10 - c.top, y - c.top) / zoom));
    let w: number | null = null,
      h: number | null = null;
    const move = (ev: PointerEvent) => {
      if (across) setDragWidth((w = widthAt(ev.clientX)));
      if (down) setDragTall((h = tallAt(ev.clientY)));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragWidth(null);
      setDragTall(null);
      if (w !== null || h !== null) updateSettings({ ...(w !== null ? { chatWidth: w } : {}), ...(h !== null ? { chatTall: h } : {}) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  /**
   * The Modern chat moved by its tab strip (not its tabs), kept on letting go; a double press on
   * the strip puts it back down the left, at its first height. (Not onDoubleClick: the pointer
   * capture makes the chat, not the strip, its target.)
   */
  const moveChat = (e: ReactPointerEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    const chat = e.currentTarget.parentElement;
    if (!modern || !game || !chat || e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    if (e.timeStamp - chatStripPress.current < CHAT_DOUBLE_MS) {
      chatStripPress.current = 0;
      updateSettings({ chatAt: null, chatTall: null });
      return;
    }
    chatStripPress.current = e.timeStamp;
    const strip = e.currentTarget;
    strip.setPointerCapture(e.pointerId);
    const g = game.getBoundingClientRect();
    const c = chat.getBoundingClientRect();
    const grabX = e.clientX - c.left,
      grabY = e.clientY - c.top;
    const place = (x: number, y: number): [number, number] => [
      Math.round(Math.max(CHAT_KEEP_X - c.width, Math.min(g.width - CHAT_KEEP_X, x - g.left - grabX))),
      Math.round(Math.max(0, Math.min(g.height - CHAT_KEEP_Y, y - g.top - grabY))),
    ];
    let last: [number, number] | null = null;
    const move = (ev: PointerEvent) => setDragChatAt((last = place(ev.clientX, ev.clientY)));
    const up = () => {
      strip.removeEventListener("pointermove", move);
      strip.removeEventListener("pointerup", up);
      strip.removeEventListener("pointercancel", up);
      setDragChatAt(null);
      if (last) updateSettings({ chatAt: last });
    };
    strip.addEventListener("pointermove", move);
    strip.addEventListener("pointerup", up);
    strip.addEventListener("pointercancel", up);
  };

  /** Drag the chat window's top edge to make it taller or shorter (the Modern chat: its right edge, wider or narrower) */
  const resizeChat = (e: ReactPointerEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;
    if (modern) return resizeModernChat(e, true, false);
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

  /** Ours: a click on our face shows (or puts away) the Quick Emotes, as Q does */
  const toggleEmotes = () => setEmoteMenu((v) => !v);
  /** The ☰ menu's Actions → Study…: Study mode's window, or stopping it; the phone's drawer goes away for it */
  const studyButton = () => {
    setDrawerOpen(false);
    if (studying) stopStudy();
    else openStudy();
  };

  // Ours: of mermain.c default_buttons and mailnews.c mail_buttons, only Rest/Stand and the
  // mailbox, beside the portrait instead of a toolbar over the view
  /** Hide Interface's first key, for its note */
  const hideKey = settings.keys.hideInterface[0];
  const hideKeyLabel = hideKey ? bindingLabel(hideKey) : "Hide Interface";
  const toolbarButtons =
    settings.toolbar && !touch
      ? [
          { bitmap: "rest.bmp", name: "Rest/Stand", pressed: resting, onClick: () => runCommand(resting ? "stand" : "rest") },
          { bitmap: "mailbox.bmp", name: "Read mail", onClick: () => runCommand("mail") },
        ]
      : undefined;

  // The Modern chat where it was moved (kept in the window if that has shrunk since), and as tall
  // as it was made; unmoved, down the left; unsized, down to the window's bottom. Its left and top
  // are in the window's pixels, divided by the HUD size it's zoomed by.
  const chatAt = dragChatAt ?? settings.chatAt;
  const chatTall = dragTall ?? settings.chatTall;
  const hudZoom = settings.hudScale / 100;
  const chatTop = chatAt ? `min(${chatAt[1] / hudZoom}px, 100% - ${CHAT_KEEP_Y}px)` : `${CHAT_TOP}px`;
  const chatPlace: CSSProperties | undefined = modern
    ? {
        ...(chatAt && {
          left: `clamp(${CHAT_KEEP_X}px - 100%, ${chatAt[0] / hudZoom}px, 100% - ${CHAT_KEEP_X}px)`,
          top: `clamp(0px, ${chatAt[1] / hudZoom}px, 100% - ${CHAT_KEEP_Y}px)`,
          // moved, it may go anywhere: behind the hotbar too
          maxWidth: "calc(100% - 20px)",
        }),
        ...(chatTall !== null && { bottom: "auto", height: `${chatTall}px` }),
        maxHeight: `calc(100% - ${chatTop} - 10px)`,
      }
    : undefined;

  return (
    <div
      className={`game${touch ? " touch-ui" : ""}${modern ? " modern-ui" : ""}${classic ? " classic-ui" : ""}${classic && chatFocused ? " chat-focused" : ""}${hudHidden ? " hud-hidden" : ""}${touch && chatOpen ? " chat-open" : ""}${touch && drawerOpen ? " drawer-open" : ""}`}
      ref={gameRef}
      // A phone browser's long press opens its own menu (an image's "open, save, share" over the
      // Attack button's weapon): never in the game, but in text fields. Our own handlers (examine)
      // have already run, as this is the root
      onContextMenu={touch ? (e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, [contenteditable]")) e.preventDefault();
      } : undefined}
      style={
        {
          "--chat-height": `${dragHeight ?? settings.chatHeight}px`,
          "--chat-width": `${dragWidth ?? settings.chatWidth}px`,
          "--hud-scale": settings.hudScale / 100,
        } as CSSProperties
      }>
      <TitleBar
        className="game-title"
        assets={assets}
        title={roomName ? `Meridian Shards — ${roomName}` : "Meridian Shards"}
        menu={[
          { label: "Preferences…", onSelect: () => setModal({ type: "preferences" }) },
          { label: "Configuration…", onSelect: () => setModal({ type: "configuration" }) },
          // Ours: the admin console (Shift+4) for admin characters, easier to find here
          ...(adminLoaded ? [{ label: "Admin console…", onSelect: () => setAdminConsole((a) => (a ? { ...a, open: true } : a)) }] : []),
          // actions.c: each item runs its typed command
          {
            label: "Actions",
            items: [
              ...ACTIONS_MENU.map((a) => (a ? { label: a[1], onSelect: () => runCommand(a[0]) } : { label: "", separator: true })),
              // Ours: Study mode (study.ts), practising a spell while we're away; Stop studying while it runs
              { label: "", separator: true },
              { label: studying ? "Stop studying" : "Study…", onSelect: studyButton },
              // (Ours: no Friends… or Pets…: they're tabs beside the inventory, on P and N)
            ],
          },
          // (Ours: no Spells menu, spells.c's: the Abilities tab has them, with a search)
          // language.c: the Language menu, sorted by name, the chosen one checked
          ...(languages.length > 1
            ? [
                {
                  label: "Language",
                  items: [...languages]
                    .sort((a, b) => languageName(a).localeCompare(languageName(b)))
                    .map((id) => ({ label: languageName(id), checked: settings.language === id, onSelect: () => chooseLanguage(id) })),
                },
              ]
            : []),
          // (No Mail…: the mailbox at the map's corner, the Classic toolbar's, its hotkey alias and typed mail open it)
          { label: "Change password…", onSelect: () => setModal({ type: "password" }) },
          // Not on a phone, which logs off on its own when put away (host.ts onAndroidAway)
          ...(touch ? [] : [{ label: "Logout timer…", onSelect: () => setModal({ type: "logoutTimer" }) }]),
          // (Study… is under Actions)
          { label: "Help…", onSelect: () => setModal({ type: "help" }) },
          { label: "About Meridian…", onSelect: () => setModal({ type: "about" }) },
          // Ours: back to Select character, still logged in
          { label: "Switch character", onSelect: () => session.toCharacters() },
          { label: "Log off", onSelect: () => onLogout() },
        ]}
        // The Classic interface has the meter after the toolbar, as the original's lag box
        latency={settings.latencyMeter && !classic ? latency : undefined}
        fps={settings.showFps && fps !== null && !classic ? fps : undefined}
        tooltips={settings.tooltips}
      />
      {classic && (
        <>
          {/* drawint.c: the stone edge treatment round the client area */}
          <div className="classic-edge" aria-hidden>
            <EdgeFrame />
          </div>
          <ClassicToolbar
            assets={assets}
            tooltips={settings.tooltips}
            latency={settings.latencyMeter ? latency : undefined}
            fps={settings.showFps && fps !== null ? fps : undefined}
            buttons={
              settings.toolbar
                ? [
                    // mermain.c default_buttons and mailnews.c mail_buttons: each runs its typed command
                    { bitmap: "help.bmp", name: "Help", onClick: () => runCommand("help") },
                    { bitmap: "drop.bmp", name: "Drop items", onClick: () => runCommand("drop") },
                    { bitmap: "get.bmp", name: "Get items", onClick: () => runCommand("get") },
                    { bitmap: "rest.bmp", name: "Rest/Stand", pressed: resting, onClick: () => runCommand(resting ? "stand" : "rest") },
                    { bitmap: "mailbox.bmp", name: "Read mail", onClick: () => runCommand("mail") },
                  ]
                : undefined
            }
          >
            {inArena && (
              <button type="button" className={`toolbar-button arena-classic${arenaActive ? " pressed" : ""}`} title={settings.tooltips ? "Arena" : undefined} aria-label="Arena" onClick={openArena}>
                ⚔
              </button>
            )}
            <WarButton store={factionWar} onOpen={openWar} className="toolbar-button war-classic" tooltips={settings.tooltips} />
            <EnchantmentRow session={session} icons={icons} kind="room" tooltips={settings.tooltips} onLook={(id) => lookAt(id, DESC.NONE)} />
          </ClassicToolbar>
        </>
      )}
      {/* The Classic interface draws the view's border and corners round it (graphics.c, draw3d.c) */}
      <div className="view-frame">
        {classic && (
          <>
            <i className="view-corner ul" aria-hidden />
            <i className="view-corner ur" aria-hidden />
            <i className="view-corner ll" aria-hidden />
            <i className="view-corner lr" aria-hidden />
          </>
        )}
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
        <PvpLockout until={pvpUntil} />
        {fullMap && (
          <div className="full-map" title={modern ? "Map (click it, or press the Map key, to close)" : "Map (press the Map key again to close)"}>
            <MiniMap
              world={session.world}
              getRoom={() => sceneRef.current?.currentRoom ?? null}
              zoom={settings.mapZoom}
              paper={assets.url("ui/mapbkgnd.bmp")}
              annotations={settings.mapAnnotations ? annotations?.list : undefined}
              annotationIcon={assets.url("ui/annotate.bmp")}
              onAnnotate={annotateAt}
              onClick={modern ? () => setFullMap(false) : undefined}
              tooltips={settings.tooltips}
              questMarkers={settings.questMarkers}
              getWay={settings.showWay ? getWay : undefined}
            />
            <FriendsMapHint link={social} />
          </div>
        )}
        {touch && (
          <TouchControls
            cooldown={cooldown}
            session={session}
            icons={icons}
            settings={settings}
            chatUnread={!chatOpen && chat.some((l) => l.time > chatSeenAt)}
            onMove={touchMove}
            onPress={touchPress}
            onChat={() => setChatOpen(true)}
            onDrawer={() => setDrawerOpen((v) => !v)}
            onMap={() => setFullMap((v) => !v)}
            mapOpen={fullMap}
            resting={resting}
            onRest={() => setResting(!restingRef.current)}
            // enchant.c WM_RBUTTONDOWN: look at the enchantment, as the interface's do
            onLook={(id) => lookAt(id, DESC.NONE)}
            quickSlots={quick.slots}
            onUseSlot={activateSlot}
            onEditSlot={(i) => setModal({ type: "quickSlot", index: i })}
            onSetSlot={setSlot}
            onSwapSlots={swapSlots}
            selecting={selecting}
            onSelectSelf={() => selfInfo && selectObject(selfInfo.id)}
            onCancelSelect={() => sceneRef.current?.select(null)}
            onEmotes={toggleEmotes}
            onArena={inArena ? openArena : undefined}
            arenaActive={arenaActive}
            war={factionWar}
            onWar={openWar}
          />
        )}
        {!touch && !modern && (
          <Hotbar
            session={session}
            icons={icons}
            slots={quick.slots}
            settings={settings}
            onUse={activateSlot}
            onEdit={(i) => setModal({ type: "quickSlot", index: i })}
            onSet={setSlot}
            onSwap={swapSlots}
          />
        )}
        {modern && (
          <>
            <UnitFrame
              session={session}
              icons={icons}
              settings={settings}
              selecting={selecting}
              onSelectSelf={() => selfInfo && selectObject(selfInfo.id)}
              onLook={(id) => lookAt(id, DESC.NONE)}
              onEmotes={toggleEmotes}
            />
            <TargetFrame session={session} icons={icons} target={target} onLook={(id) => lookAt(id, DESC.NONE)} onClear={() => sceneRef.current?.press("targetClear")} />
            <MapCluster
              session={session}
              icons={icons}
              assets={assets}
              settings={settings}
              buttons={toolbarButtons}
              getRoom={() => sceneRef.current?.currentRoom ?? null}
              roomName={roomName}
              annotations={annotations?.list ?? []}
              onAnnotate={annotateAt}
              onLook={(id) => lookAt(id, DESC.NONE)}
              onZoom={(dir) => handleAction(dir > 0 ? "mapZoomIn" : "mapZoomOut")}
              onMap={() => setFullMap((v) => !v)}
              getWay={getWay}
              onArena={inArena ? openArena : undefined}
              arenaActive={arenaActive}
              war={factionWar}
              onWar={openWar}
            />
            <QuestBox store={quests} settings={settings} onOpen={openQuestInfo} />
            <ActionBar
              cooldown={cooldown}
              session={session}
              icons={icons}
              settings={settings}
              slots={quick.slots}
              onUse={activateSlot}
              onEdit={(i) => setModal({ type: "quickSlot", index: i })}
              onSet={setSlot}
              onSwap={swapSlots}
            />
            {characterOpen && (
              <CharacterWindow
                session={session}
                icons={icons}
                assets={assets}
                settings={settings}
                itemSlots={itemSlots}
                tab={tab}
                onTab={setTab}
                onClose={() => setCharacterOpen(false)}
                onLookItem={lookInventoryItem}
                onLinkItem={linkItem}
                onLook={(id) => lookAt(id, DESC.NONE)}
                onDropItem={drop}
                onApplyItem={(o) => sceneRef.current?.beginSelect((t) => session.apply(o.id, t))}
                onPut={putAway}
                onTabOut={(forward) => (forward ? inputRef.current?.focus() : focusView())}
                selecting={selecting}
                onSelectObject={selectObject}
                onCast={castSpell}
                friendsPanel={friendsPanel}
                petsPanel={petsPanel}
                questsPanel={questsPanel}
                companionPanel={companionPanel}
                onTrain={() => openTrain()}
              />
            )}
          </>
        )}
        {emoteMenu && (
          <div className="quick-emotes" role="menu" aria-label="Quick emotes">
            {QUICK_EMOTES.map((e, i) =>
              e ? (
                <button
                  key={e[0]}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEmoteMenu(false);
                    runCommand(e[0]);
                    focusView();
                  }}
                >
                  {e[1]}
                </button>
              ) : (
                <span key={i} className="quick-emotes-gap" />
              ),
            )}
          </div>
        )}
        {viewNote && <div key={viewNote.at} className="view-note">{VIEW_NAMES[viewNote.mode]}</div>}
        {hideNote && (
          <div key={hideNote.at} className="view-note">
            {hideNote.hidden ? `Interface hidden (${hideKeyLabel} shows it)` : "Interface shown"}
          </div>
        )}
        <FriendsNotices link={social} onOpen={() => openTab("friends")} />
        <AchievementToast store={achievements} icons={icons} onOpen={openAchievements} />
        {studying && (
          <div className="study-banner" role="status">
            <span>{studying}</span>
            <button type="button" onClick={() => stopStudy()}>
              Stop
            </button>
          </div>
        )}
        {selecting && !touch && <div className="select-hint">Choose a target, or your face or bars for yourself (Esc or right click cancels)</div>}
        {(phase === "entering" || status?.loading) && <div className="loading">Entering…</div>}
        {desc && (
          <DescriptionDialog
            key={desc.look.object.id}
            look={desc.look}
            buttons={desc.buttons}
            icons={icons}
            onAction={(a) => descAction(a, desc.look.object.id, desc.buttons)}
            onSave={(d, u) => descSave(desc.look.object.id, d, u)}
            extra={friendButton(desc.look) ?? endEnchantmentButton(desc.look)}
            abilities={itemAbilities(desc.look)}
            onClose={() => setDesc(null)}
          />
        )}
        {appraising && (
          <AppraiseDialog
            name={appraising.name}
            price={appraising.price}
            onAppraise={(price) => {
              session.shardsObject(appraising.id, `appraise ${price}`);
              setAppraising(null);
            }}
            onClear={() => {
              session.shardsObject(appraising.id, "appraise clear");
              setAppraising(null);
            }}
            onClose={() => setAppraising(null)}
          />
        )}
        {ambientLook && (
          <AmbientPersonDialog
            key={ambientLook.object.id}
            person={ambientLook}
            icons={icons}
            roomName={(file) => roomNames.get(file) ?? file.replace(/\.roo$/, "")}
            onClose={() => setAmbientLook(null)}
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
            items={modal.items.map((o) => ({ object: o, name: (isNumberItem(o.id) ? `${o.amount} ` : "") + session.itemName(o) }))}
            onDone={modal.onDone}
            onLook={(id) => lookAt(id, DESC.NONE)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "trade" && (
          <TradeDialog
            list={modal.list}
            session={session}
            icons={icons}
            onClose={() => setModal(null)}
            onSell={takesFromUs(modal.list.seller.id) ? () => descAction("sell", modal.list.seller.id, 0) : undefined}
          />
        )}
        {modal?.type === "arena" && <ArenaDialog status={arena.status} session={session} onClose={() => setModal(null)} />}
        {modal?.type === "war" && <WarDialog store={factionWar} session={session} onClose={() => setModal(null)} />}
        {modal?.type === "achievements" && <AchievementsDialog store={achievements} session={session} icons={icons} onClose={() => setModal(null)} />}
        {modal?.type === "travel" && (
          <TravelDialog here={modal.here} places={modal.places} pvpUntil={pvpUntil} session={session} onClose={() => setModal(null)} />
        )}
        {modal?.type === "quest" && (
          <QuestDialog
            key={`${modal.npc}:${modal.offers.map((o) => `${o.id}.${o.state}.${o.step}`).join(",")}`}
            npc={modal.npc}
            offers={modal.offers}
            store={quests}
            session={session}
            onClose={() => setModal(null)}
            service={
              modal.service
                ? { label: SERVICE_LABELS[modal.service.type], open: () => setModal({ type: "cosmetics", menu: modal.service! }) }
                : undefined
            }
          />
        )}
        {modal?.type === "questInfo" && <QuestInfoDialog key={modal.id} id={modal.id} store={quests} session={session} onClose={() => setModal(null)} />}
        {modal?.type === "cosmetics" && modal.menu.type === "tailor" && (
          <TailorDialog
            name={session.resource(session.world.objects.get(modal.menu.npc)?.info.nameRes ?? 0) ?? "The tailor"}
            menu={modal.menu}
            session={session}
            assets={assets}
            icons={icons}
            onCommand={(line) => session.shardsCommand(line)}
            onShop={() => {
              const npc = modal.menu.npc;
              setModal(null);
              askTrader(npc);
            }}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "cosmetics" && modal.menu.type === "barber" && (
          <BarberDialog
            name={session.resource(session.world.objects.get(modal.menu.npc)?.info.nameRes ?? 0) ?? "The barber"}
            price={modal.menu.price}
            look={modal.menu.look}
            info={companion.charInfo}
            icons={icons}
            onCommand={(line) => session.shardsCommand(line)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "cosmetics" && (modal.menu.type === "reveal" || modal.menu.type === "repair") && (
          <ItemServiceDialog
            name={session.resource(session.world.objects.get(modal.menu.npc)?.info.nameRes ?? 0) ?? (modal.menu.type === "reveal" ? "The elder" : "The smith")}
            menu={modal.menu}
            session={session}
            icons={icons}
            onCommand={(line) => session.shardsCommand(line)}
            onShop={
              modal.menu.type === "repair"
                ? () => {
                    const npc = modal.menu.npc;
                    setModal(null);
                    askTrader(npc);
                  }
                : undefined
            }
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "cosmetics" && modal.menu.type === "rename" && (
          <NameChangeDialog
            name={session.resource(session.world.objects.get(modal.menu.npc)?.info.nameRes ?? 0) ?? "The clerk"}
            current={session.resource(session.world.self?.info.nameRes ?? 0) ?? ""}
            fee={modal.menu.fee}
            onCommand={(line) => session.shardsCommand(line)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "companionLooks" && comp && (
          <CompanionLooksDialog
            status={comp}
            info={companion.charInfo}
            icons={icons}
            onCommand={(line) => session.shardsCommand(line)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "give" && (
          <GiveDialog
            kind={modal.kind}
            target={modal.target}
            session={session}
            icons={icons}
            onClose={() => setModal(null)}
            sellable={modal.kind === "offer" && sold?.npc === modal.target.id ? sold.prices : undefined}
            asking={modal.kind === "offer" && !sellWaitOver && sold?.npc !== modal.target.id}
            onOffered={() => {
              // A taker answers with BP_OFFERED at once; with none, the server only said why in the chat
              const name = modal.target.name || "They";
              window.clearTimeout(offerWait.current);
              offerWait.current = window.setTimeout(
                () => setAlert(`${name} didn't take that. Shopkeepers only buy what suits their trade, and some people only accept quest items. Their answer is in the chat.`),
                Math.max(800, 2 * (latency ?? 150) + 500),
              );
            }}
          />
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
        {modal?.type === "quickSlot" && (
          <QuickSlotPicker
            session={session}
            icons={icons}
            index={modal.index}
            current={quick.slots[modal.index]}
            onPick={(slot) => setSlot(modal.index, slot)}
            onClose={() => setModal(null)}
          />
        )}
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
        {modal?.type === "help" && (
          <HelpDialog
            settings={settings}
            layout={touch ? "touch" : modern ? "modern" : "classic"}
            admin={adminLoaded}
            captureView={captureView}
            getRoot={getGameRoot}
            onConfiguration={() => setModal({ type: "configuration" })}
            onClose={() => setModal(null)}
          />
        )}
        {welcomeReady && !settings.seenControls && !touch && modal === null && (
          <WelcomeControls
            settings={settings}
            onHelp={() => {
              updateSettings({ seenControls: true });
              setModal({ type: "help" });
            }}
            onClose={() => updateSettings({ seenControls: true })}
          />
        )}
        {modal?.type === "about" && <AboutDialog assets={assets} session={session} icons={icons} audio={audio} onClose={() => setModal(null)} />}
        {modal?.type === "study" && (
          <StudyDialog
            spells={modal.spells}
            carried={modal.carried}
            mana={modal.mana}
            maxMana={modal.maxMana}
            memory={modal.memory}
            onStart={startStudy}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.type === "train" && <TrainDialog session={session} costs={trainCosts} initialSearch={modal.search} onClose={() => setModal(null)} />}
        {modal?.type === "logoutTimer" && (
          <LogoutTimerDialog settings={settings} iconUrl={assets.url("ui/clock.ico")} onApply={updateSettings} onClose={() => setModal(null)} />
        )}
        {modal?.type === "configuration" &&
          (touch ? (
            <TouchConfigDialog settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
          ) : (
            <ConfigurationDialog settings={settings} onApply={updateSettings} onClose={() => setModal(null)} />
          ))}
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
        {adminConsole?.open && (
          <AdminConsole
            session={session}
            rooms={adminRooms}
            text={adminConsole.text}
            command={adminConsole.command}
            onCommandChange={(command) => setAdminConsole((a) => (a ? { ...a, command } : a))}
            history={adminConsole.history}
            onCommand={adminCommand}
            onDm={adminDm}
            onTell={(name) => {
              setAdminConsole((a) => (a ? { ...a, open: false } : a));
              setText(`tell "${name}" `);
              inputRef.current?.focus();
            }}
            onHide={() => setAdminConsole((a) => (a ? { ...a, open: false } : a))}
            onQuit={() => setAdminConsole((a) => (a ? { ...a, open: false, text: "" } : a))}
            onClear={() => setAdminConsole((a) => (a ? { ...a, text: "" } : a))}
            onEditRoom={devPagesEnabled ? () => editCurrentRoom(session) : undefined}
          />
        )}
        {chess && (
          <ChessWindow
            session={session}
            assets={assets}
            state={chess}
            onBoard={(board) => setChess((c) => (c ? { ...c, board } : c))}
            onClose={() => setChess(null)}
          />
        )}
        {guildState && (
          <GuildWindow session={session} state={guildState} icons={icons} fallenHalls={fallenHalls} quests={quests} onClose={() => setGuildState(null)} />
        )}
        {guildAsk && <GuildCreateDialog session={session} cost={guildAsk.cost} secretCost={guildAsk.secretCost} onClose={() => setGuildAsk(null)} />}
        {guildHalls && <GuildHallsDialog session={session} halls={guildHalls} onClose={() => setGuildHalls(null)} />}
        {offer && (
          <OfferDialog key={offer.from?.id ?? 0} state={offer} session={session} icons={icons} onLook={(id) => lookAt(id, DESC.NONE)} onClose={() => setOffer(null)} />
        )}
      </div>
      </div>
      <div className="chat" style={chatPlace}>
        <div className="chat-resize" onPointerDown={resizeChat} title="Drag to resize the chat window" aria-hidden />
        {modern && (
          <>
            <div className="chat-resize-bottom" onPointerDown={(e) => resizeModernChat(e, false, true)} title="Drag to make the chat taller or shorter" aria-hidden />
            <div className="chat-resize-corner" onPointerDown={(e) => resizeModernChat(e, true, true)} title="Drag to resize the chat" aria-hidden />
          </>
        )}
        <div className="chat-tabs" role="tablist" aria-label="Chat" onPointerDown={moveChat} title={modern ? "Drag to move the chat; double-click to put it back" : undefined}>
          {touch && (
            <button
              type="button"
              className="chat-close"
              aria-label="Close the chat"
              onClick={() => {
                inputRef.current?.blur();
                setChatOpen(false);
                setChatSeenAt(Date.now());
              }}
            >
              ✕
            </button>
          )}
          {CHAT_TABS.filter(({ tab }) => tab !== "debug" || adminLoaded).map(({ tab, label }) => {
            // On All every line is on screen, so no tab has unseen ones (and Debug is never marked)
            const unread = chatTab !== "all" && tab !== "all" && tab !== "debug" && tab !== chatTab && chat.some((l) => inTab(tab, l) && l.time > seenAt[tab]);
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
        {/* The log and the chat line: the Classic interface frames them as the original's text area */}
        <div className="chat-box">
        <div
          ref={logRef}
          className="chat-log"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          }}
        >
          {shown.map((l, i) => (
            // The Modern chat fades its lines once they're CHAT_FRESH_MS old, until it's hovered; the
            // logon's flood of server messages is faded from the start
            <div key={i} className={modern && !l.logon && chatNow - l.time < CHAT_FRESH_MS ? "chat-line fresh" : "chat-line"}>
              {/* Add chat timestamps (config.chat_time_stamps) */}
              {settings.chatTimestamps && <span className="chat-time">[{new Date(l.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] </span>}
              {l.spans.map((s, j) => (
                <span
                  key={j}
                  className={s.item ? "chat-link" : undefined}
                  title={s.item?.name}
                  style={
                    // Show colored text off (config.colorcodes): plain text, no colour codes
                    settings.coloredText
                      ? {
                          // Over the view (Modern), dark colours lifted to read over it (tickerColor)
                          color: modern ? tickerColor(s.color) : s.color,
                          fontWeight: s.bold ? "bold" : undefined,
                          fontStyle: s.italic ? "italic" : undefined,
                          textDecoration: s.underline ? "underline" : undefined,
                        }
                      : undefined
                  }
                >
                  {/* Ours (ADR 0024): an item link, its inventory icon (magic ring and all) before "[name]" */}
                  {s.item && assets.has(`${s.item.file}.bgf`) && (
                    <ObjIcon
                      icons={icons}
                      className="chat-icon"
                      object={Object.assign(bareIcon(localRes(`${s.item.file}.bgf`)), { translation: s.item.translation, flags: s.item.flags })}
                    />
                  )}
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
            // The phone layout keeps the chat put away; typing (Enter, T, the hotkeys) brings it out
            onFocus={() => {
              setChatFocused(true);
              if (touch) setChatOpen(true);
            }}
            onBlur={() => setChatFocused(false)}
            placeholder="Enter to chat — say, emote, yell, broadcast"
            maxLength={500}
          />
          {/* Ours (ADR 0024): emoji to put in the line */}
          <EmojiPicker onPick={insertIntoChat} />
        </form>
        </div>
      </div>
      {!modern && (
        <Sidebar
          getWay={getWay}
          session={session}
          icons={icons}
          assets={assets}
          getRoom={() => sceneRef.current?.currentRoom ?? null}
          tab={tab}
          onTab={setTab}
          settings={settings}
          onLookItem={lookInventoryItem}
          onLinkItem={linkItem}
          onLook={(id) => lookAt(id, DESC.NONE)}
          onDropItem={drop}
          onApplyItem={(o) => sceneRef.current?.beginSelect((target) => session.apply(o.id, target))}
          onPut={putAway}
          onTabOut={(forward) => (forward ? inputRef.current?.focus() : focusView())}
          target={target}
          selecting={selecting}
          onSelectObject={selectObject}
          onCast={castSpell}
          annotations={annotations?.list ?? []}
          onAnnotate={annotateAt}
          friendsPanel={friendsPanel}
          petsPanel={petsPanel}
          questsPanel={questsPanel}
          companionPanel={companionPanel}
          onTrain={() => openTrain()}
          onEmotes={toggleEmotes}
        />
      )}
      {touch && drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      {alert && <MessageBox text={alert} onResult={() => setAlert(null)} />}
      {quitAsk && (
        <MessageBox
          kind="yesno"
          text="Log off and quit Meridian Shards?"
          onResult={(yes) => {
            setQuitAsk(false);
            if (!yes) return;
            onLogout();
            exitApp();
          }}
        />
      )}
      {annotating && <AnnotateDialog text={annotating.text} onDone={finishAnnotation} onClose={() => setAnnotating(null)} />}
    </div>
  );
}

