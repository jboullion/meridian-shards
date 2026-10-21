// A game session over any WebSocket-like transport: login, character selection,
// entering the game, and feeding game messages into WorldState. Used by the browser
// client; the protocol details live in @shards/protocol.

import {
  AP, BP, ByteReader, ByteWriter, Connection, ENCHANT, GENDER, SAY, apName, bpName, buildLogin, buildNewCharInfo,
  buildReqAttack, buildReqBuy, buildReqBuyItems, buildReqCast, buildReqDeposit, buildReqGame, buildReqLook, buildReqMove,
  buildReqCounteroffer, buildReqOffer, buildReqTurn, buildReqWithdrawal, buildReqWithdrawalItems, buildSay, buildSayGroup, buildSendEnchantments,
  buildSendSkills, buildSendSpells, buildChangeDescription, buildChangeUrl, buildReqApply,
  buildReqGetFromContainer, buildReqObjectContents, buildReqPut, buildSendStatGroups, buildSendStats, buildSimple, buildUseCharacter, buildUserCommand, buildShardsCommand, buildShardsObjectCommand,
  buildSendCharInfo, buildDeleteMail, buildDeleteNews, buildPostArticle, buildReqArticle, buildReqArticles, buildReqGetMail,
  buildReqLookupNames, buildSendMail, buildChangedStats, readStatChange, readGuildInfo, readGuildList, readGuildShield, readGuildShields,
  readGuildHalls, type GuildInfo, readArticles, readLookNewsgroup, readLookupNames, readMailHeader, type NewsArticle, buildAction, buildAppeal, buildChangePassword, buildReqInventoryMove, buildSayBlocked, UC, objId, passwordDigest, readBuyList, readCharInfo, readCharacters, readObject, readObjectList, readOffer, readPlayWave, STAT_GROUP,
  type BuyItem, type CharInfo, type CharacterSlot, type NewCharInfo, type ObjectInfo, type ObjectRef, type PlayWave,
  buildReqAdmin,
} from "@shards/protocol";
import { WorldState, fineToKod } from "./state.ts";
import { formatServerMessage, parseMarkup, type TextSpan } from "./text.ts";
import { messageChannel, type ChatChannel } from "./chatChannel.ts";
import { readDamageDealt, type DamageDealt } from "./combatHit.ts";
import { readSpellRefusal, type SpellRefusal } from "./spellRefusal.ts";
import { readCompanion, type CompanionEvent } from "./companion.ts";
import { readArena, type ArenaStatus } from "./arenaBouts.ts";
import { readCosmetics, type CosmeticsEvent } from "./cosmetics.ts";
import { readItemService } from "./itemservice.ts";
import { MAGIC_SHOW, magicShow, readMagicName } from "./magic.ts";
import { readAppraisal, readSellable, readTraining, type Appraisal, type Sellable, type TrainingCost } from "./training.ts";

/** A line for the chat window, with the original client's default colour for its kind. */
/**
 * How long after choosing a character, and again after entering the game, server messages
 * count as the logon's and go to the Server tab: the welcome, events, mail, quests and the
 * help text, which can mention attacking or killing. Attacking or casting ends it at once.
 */
export const LOGON_SERVER_TAB_MS = 5000;

/**
 * Ours: how long logging in may take before we give up and say so, rather than wait forever
 * (a hung server still accepts connections, then never answers): the socket opening, the server's
 * first word (AP_GETLOGIN comes at once from a server that's well), and the character list
 */
export const LOGIN_TIMEOUTS = { connect: 15_000, firstWord: 15_000, characters: 45_000 };
/** Ours: the socket didn't open (in LOGIN_TIMEOUTS.connect, or it closed first) */
const CANT_REACH = "Can't reach the server. Check your internet connection, or try again in a few minutes.";

export interface ChatLine {
  kind: "system" | "say" | "said-resource";
  /** The chat tab it belongs in (chatChannel.ts) */
  channel: ChatChannel;
  spans: TextSpan[];
  time: number;
  /** Who said it (BP_SAID), for ignoring players (msgfiltr.c) */
  sender?: { id: number; name: string };
  /** BP_SAID's say type (SAY_*), e.g. SAY_EVERYONE for broadcasts */
  sayType?: number;
  /** One of the logon's messages (LOGON_SERVER_TAB_MS): the Modern chat shows it faded from the start */
  logon?: boolean;
}

/**
 * An object's description for the description dialog (dialog.c DisplayDescription): BP_LOOK,
 * or UC_LOOK_PLAYER for a player (merintr.c HandleLookPlayer).
 */
export interface LookResult {
  object: ObjectInfo;
  name: string;
  /** The fixed text (IDC_DESCFIXED): the description, or a player's title and guild */
  description: string;
  /** The description box (IDC_DESCBOX): an inscription, or a player's own words; null when there's none */
  inscription: string | null;
  /** DF_* flags: DF_EDITABLE lets us change the box */
  flags: number;
  /** A player's web page (UC_LOOK_PLAYER), null for objects */
  url: string | null;
  /** UC_LOOK_PLAYER: the Player Description dialog (IDD_DESCPLAYER) */
  player: boolean;
}

/** BP_OBJECT_CONTENTS: a container and what's in it. */
export interface ContainerContents {
  container: number;
  items: ObjectInfo[];
}

/** Default colours (clientd3d/color.c): system messages violet, speech white, resource speech black. */
const DEFAULT_COLORS = { system: "rgb(128,0,128)", say: "rgb(255,255,255)", "said-resource": "rgb(0,0,0)" } as const;

/** A shop's wares (BP_BUY_LIST) or a banker's vault (BP_WITHDRAWAL_LIST). */
export interface TradeList {
  kind: "buy" | "withdraw";
  seller: ObjectInfo;
  items: BuyItem[];
}

/**
 * The offer exchange (offer.c), from our side: we offered `items` to `target`
 * (BP_OFFERED echoes them); the other side answers with a counteroffer
 * (BP_COUNTEROFFER, e.g. a shopkeeper's shillings), or cancels. From theirs:
 * someone offers us items (BP_OFFER), we answer with a counteroffer
 * (BP_REQ_COUNTEROFFER, echoed as BP_COUNTEROFFERED) and they accept or cancel.
 */
export type OfferEvent =
  | { type: "offered"; items: ObjectInfo[] }
  | { type: "counteroffer"; items: ObjectInfo[] }
  | { type: "received"; offerer: ObjectInfo; items: ObjectInfo[] }
  | { type: "counteroffered"; items: ObjectInfo[] }
  | { type: "canceled" };

/** Mail and the news globes (module/mailnews), as the server sends them. */
export type MailNewsEvent =
  /** BP_LOOK_NEWSGROUP: we looked at a news globe */
  | { type: "newsgroup"; newsgroup: number; permission: number; object: ObjectInfo; name: string; description: string }
  /** BP_ARTICLES, all parts: the newsgroup's index */
  | { type: "articles"; newsgroup: number; articles: NewsArticle[] }
  /** BP_ARTICLE: the text of the article asked for */
  | { type: "article"; text: string }
  /** BP_MAIL: a message, to keep (then BP_DELETE_MAIL its index on the server) */
  | { type: "mail"; index: number; sender: string; time: number; recipients: string[]; text: string }
  /** BP_MAIL with no recipients: no more new mail */
  | { type: "noMoreMail" }
  /** BP_LOOKUP_NAMES: the recipients' ids, 0 for a name that isn't a player */
  | { type: "lookupNames"; ids: number[] };

/** The guild windows' news from the server (merintr.c HandleGuild*) */
export type GuildEvent =
  /** UC_GUILDINFO: our guild, for the guild window */
  | { type: "info"; info: GuildInfo }
  /** UC_GUILD_ASK: create a guild, at these costs (plain, secret) */
  | { type: "ask"; cost: number; secretCost: number }
  | { type: "list"; list: ReturnType<typeof readGuildList> }
  | { type: "shield"; shield: ReturnType<typeof readGuildShield> }
  | { type: "shields"; patterns: number[] }
  /** UC_GUILD_HALLS: halls to rent */
  | { type: "halls"; halls: ReturnType<typeof readGuildHalls> };

/** A mini-game's messages (module/chess chess.c, minigame.kod) */
export type MinigameEvent =
  /** UC_MINIGAME_START: the game object, and our player number (1 white, 2 red, more an observer) */
  | { type: "start"; game: number; player: number }
  /** UC_MINIGAME_MOVE: the game's state string ("" before the first move) */
  | { type: "state"; game: number; state: string }
  /** UC_MINIGAME_PLAYER: who plays as player `player` */
  | { type: "player"; player: number; name: string };

/** Sound and music from the server (server.c HandlePlayWave / HandleStopWave / HandlePlayMusic). */
export type SoundEvent =
  | { type: "play"; wave: PlayWave; file: string }
  | { type: "stop"; file: string; object: number }
  | { type: "music"; file: string }
  /** Entering a room stops looping sounds (game.c EnterNewRoom SoundStopAll(SF_LOOP)). */
  | { type: "stopLoops" };

export type SessionPhase =
  | "connecting"
  | "login" // waiting for the server to accept the account
  | "characters" // the character list is available
  | "entering" // a character was picked, waiting for the room
  | "game"
  | "closed";

export interface SessionOptions {
  url: string;
  username: string;
  password: string;
  secretKey: string;
  /** Resolves a resource id to its string (rsc0000.rsb); needed for the redbook token. */
  lookupResource: (id: number, language?: number) => string | undefined;
  /** Set when pings are driven externally (Web Worker); see Connection.pingIntervalMs. */
  pingIntervalMs?: number;
  /** Factory for the socket; defaults to the global WebSocket. */
  createSocket?: (url: string) => WebSocket;
  /** How long logging in may take (LOGIN_TIMEOUTS, ms); the tests shorten them */
  loginTimeouts?: Partial<typeof LOGIN_TIMEOUTS>;
}

/** A travel point on a portal's list (UC_TRAVEL_LIST) */
export interface TravelPlace {
  id: number;
  name: string;
}

/**
 * Ours (docs/adr/0011-fast-travel.md): UC_TRAVEL_LIST, the places the portal we touched can take
 * us (`here` is its own point), and UC_PVP_UNTIL, the seconds the PvP lockout has left.
 */
export type TravelEvent = { type: "list"; here: number; pvpSeconds: number; places: TravelPlace[] } | { type: "pvp"; seconds: number };

/** What an NPC has for us (UC_QUEST_OFFERS): QO_* in questbook.kod */
export const QUEST_OFFER = { OFFER: 1, READY: 2, PENDING: 3, SOON: 4 } as const;

export interface QuestOffer {
  id: number;
  /** QUEST_OFFER */
  state: number;
  step: number;
}

/** A quest in our log (UC_QUEST_LOG): its step (from 1), the step's count, seconds left (-1 none) */
export interface QuestLogEntry {
  id: number;
  step: number;
  count: number;
  secondsLeft: number;
}

/**
 * Ours (docs/adr/0009-quests.md 3): our server's quests (shards-server util/questbook.kod). Only
 * ids and numbers: the text is in the catalogue (dist/assets/quests.json), whose hash the log carries.
 */
export type QuestEvent =
  /** What the NPC we just talked to has for us; the steps to hand in come first */
  | { type: "offers"; npc: number; offers: QuestOffer[] }
  | { type: "log"; hash: number; active: QuestLogEntry[]; done: { id: number; times: number }[] }
  /** A step's count went up */
  | { type: "progress"; id: number; step: number; count: number }
  /** Ours: the signet rings we carry, to return (UC_SIGNETS): shown as bronze quests */
  | { type: "signets"; rings: SignetRing[] };

/** A signet ring we carry (UC_SIGNETS): the ring, whose it is, and where they stand ("" and 0 for nowhere) */
export interface SignetRing {
  id: number;
  owner: string;
  room: string;
  rid: number;
}

/** A friend as our server lists them (UC_FRIENDS FR_LIST) */
export interface ServerFriend {
  name: string;
  online: boolean;
  /** When they last left the game (Kod time, KOD_TIME_BASE), 0 if never */
  lastSeen: number;
}

/** A pet as our server keeps it (UC_PETS), or null for none */
export interface ServerPet {
  kind: string;
  colour: number;
  name: string;
}

/**
 * Ours (docs/adr/0015-social-on-our-server.md): what our server's friends, pets and shared crowd
 * say (shards-server util/shardssocial.kod). Rooms are their files, lower case.
 */
export type SocialEvent =
  /** Our friends, the requests either way, whom we follow and who follows us, and our options (SF_* flags) */
  | { type: "friends"; flags: number; friends: ServerFriend[]; incoming: string[]; outgoing: string[]; following: string | null; followers: string[] }
  /** Where a friend is (shown false: they don't say) */
  | { type: "location"; name: string; shown: boolean; rid: number; room: string; at: [number, number] }
  /** A friend in our room's health, a whole percentage */
  | { type: "health"; name: string; pct: number }
  /** The friend we follow left a room, from this square */
  | { type: "exit"; name: string; from: string; to: string; at: [number, number] }
  /** Players in the game whose names hold what we searched for */
  | { type: "search"; names: string[] }
  /** Pets of players in our room, by object id */
  | { type: "pets"; pets: { id: number; pet: ServerPet | null }[] }
  /** Our room's shared crowd: its seed, how long ago it began (ms), the game hour it began in */
  | { type: "ambient"; seed: number; elapsed: number; hour: number | null };

export interface SessionEvents {
  phase?: (phase: SessionPhase) => void;
  characters?: (characters: CharacterSlot[], motd: string) => void;
  /** The character creator's choices (BP_CHARINFO), after requestCharInfo() */
  charInfo?: (info: CharInfo) => void;
  error?: (message: string) => void;
  chat?: (line: ChatLine) => void;
  look?: (look: LookResult) => void;
  /** BP_REQ_STAT_CHANGE (module/stats): an elder offers to rearrange our stats and school levels */
  statChange?: (stats: number[], levels: number[]) => void;
  /** Guilds (merintr.c guild*.c) */
  guild?: (e: GuildEvent) => void;
  /** Mini-game messages (chess) */
  minigame?: (e: MinigameEvent) => void;
  /** BP_ADMIN (module/admin): the server's answer to an admin command, newlines and all */
  admin?: (text: string) => void;
  /** Mail and news (module/mailnews) */
  mailNews?: (e: MailNewsEvent) => void;
  /** BP_OBJECT_CONTENTS: what's inside a container we asked about (gameuser.c GotObjectContents) */
  contents?: (container: number, items: ObjectInfo[]) => void;
  trade?: (list: TradeList) => void;
  /** Ours: fast travel (docs/adr/0011-fast-travel.md): where a portal can take us, and the PvP lockout */
  travel?: (e: TravelEvent) => void;
  /** Ours: friends, pets and the shared crowd, from our server (docs/adr/0015-social-on-our-server.md) */
  social?: (e: SocialEvent) => void;
  /** Ours: quests, from our server (docs/adr/0009-quests.md) */
  quest?: (e: QuestEvent) => void;
  /** Ours: our companion, from our server (docs/adr/0010-followers.md) */
  companion?: (e: CompanionEvent) => void;
  /** Ours: the arena's mock bouts, where we stand in them, and our records (docs/adr/0019-arena-bouts.md) */
  arena?: (s: ArenaStatus) => void;
  /** Ours: a tailor's or barber's menu (docs/adr/0012-cosmetics.md) */
  cosmetics?: (e: CosmeticsEvent) => void;
  /** Ours: the abilities we can train, and what 1% of each costs (docs/adr/0016-abilities.md) */
  training?: (list: TrainingCost[]) => void;
  /** Ours: whether an item of ours can be appraised for the citizen's market, and its price (docs/adr/0016-abilities.md) */
  appraisal?: (a: Appraisal) => void;
  /** Ours: what a buyer would take from our inventory, and for how much (UC_SELLABLE) */
  sellable?: (s: Sellable) => void;
  offer?: (e: OfferEvent) => void;
  sound?: (e: SoundEvent) => void;
  /** We hurt something, and by how much (combatHit.ts: for damage numbers over its head) */
  damageDealt?: (hit: DamageDealt) => void;
  /** A ping's round trip in ms, every 5 s in the game (lagbox.c) */
  latency?: (ms: number) => void;
  /** The game options the server keeps for us (UC_RECEIVE_PREFERENCES: CF_* flags) */
  preferences?: (flags: number) => void;
  /**
   * BP_LOAD_MODULE / BP_UNLOAD_MODULE: the server loads or unloads one of the client's
   * modules by file name (modules.c), e.g. "chess.dll" for a chess game or "stats.dll".
   */
  module?: (name: string, loaded: boolean) => void;
  /** Every game message, after WorldState has seen it (for chat, stats, etc. later). */
  message?: (type: number, r: ByteReader) => void;
  debug?: (line: string) => void;
}

export class GameSession {
  phase: SessionPhase = "connecting";
  /** The server's game options for us (CF_* flags), once UC_RECEIVE_PREFERENCES arrives */
  preferences: number | null = null;
  readonly world = new WorldState();
  characters: CharacterSlot[] = [];
  private readonly conn: Connection;
  private readonly ws: WebSocket;
  private readonly opts: SessionOptions;
  private readonly events: SessionEvents;
  private closedByUs = false;

  constructor(opts: SessionOptions, events: SessionEvents = {}) {
    this.opts = opts;
    this.events = events;
    this.ws = (opts.createSocket ?? ((u) => new WebSocket(u, ["binary"])))(opts.url);
    this.ws.binaryType = "arraybuffer";
    this.conn = new Connection(
      (b) => this.ws.send(b as Uint8Array<ArrayBuffer>),
      {
        message: (type, r, state) => (state === "login" ? this.onLogin(type, r) : this.onGame(type, r)),
        error: (e) => this.fail(`protocol error: ${e.message}`),
        state: (st) => {
          // statstrt.c: back in the game after resynchronizing, ask for everything again
          if (st === "startup") this.resyncing = this.phase === "game";
          else if (st === "game" && this.resyncing) {
            this.resyncing = false;
            this.refetchGameData();
          }
        },
        latency: (ms) => this.events.latency?.(ms),
      },
      { pingIntervalMs: opts.pingIntervalMs },
    );
    this.conn.token.lookup = opts.lookupResource;
    const limits = { ...LOGIN_TIMEOUTS, ...opts.loginTimeouts };
    // Ours: a server that doesn't open, doesn't answer, or never gets us to the character list
    this.loginTimer = setTimeout(() => this.loginStalled(CANT_REACH), limits.connect);
    let heard = false;
    let opened = false;
    this.ws.onopen = () => {
      opened = true;
      this.armLoginTimer(limits.firstWord, "The server isn't answering. It may be starting up or busy: try again in a few minutes.");
      this.charactersTimer = setTimeout(() => this.loginStalled("Logging in is taking too long. Try again in a few minutes."), limits.characters);
      this.conn.start();
    };
    this.ws.onmessage = (ev) => {
      if (!heard) {
        heard = true;
        this.clearLoginTimer();
      }
      this.conn.receive(new Uint8Array(ev.data as ArrayBuffer));
    };
    this.ws.onclose = () => {
      this.clearLoginTimer();
      this.clearCharactersTimer();
      // A socket that never opened (no internet, the server down) is one that can't reach the server
      if (!this.closedByUs && this.phase !== "closed") this.events.error?.(opened ? "Disconnected from the server." : CANT_REACH);
      this.setPhase("closed");
      this.conn.close();
    };
    this.ws.onerror = () => this.events.debug?.("socket error");
  }

  /** Resynchronizing after a transmission error (the beacon handshake) */
  private resyncing = false;

  /** Ours: the login's timers (LOGIN_TIMEOUTS) */
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private charactersTimer: ReturnType<typeof setTimeout> | null = null;

  private armLoginTimer(ms: number, why: string): void {
    this.clearLoginTimer();
    this.loginTimer = setTimeout(() => this.loginStalled(why), ms);
  }

  private clearLoginTimer(): void {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = null;
  }

  private clearCharactersTimer(): void {
    if (this.charactersTimer) clearTimeout(this.charactersTimer);
    this.charactersTimer = null;
  }

  /** Logging in got stuck: say why, and let go of the connection (the account isn't left held) */
  private loginStalled(why: string): void {
    this.loginTimer = this.charactersTimer = null;
    if (this.phase === "closed" || this.closedByUs) return;
    this.fail(why);
  }

  /**
   * game.c ResetUserData (BP_INVALIDATE_DATA, and after a resync): every id we hold is
   * stale, so ask again for the player, the room, who's on and the inventory (and, as the
   * interface module does, stat groups, spells, skills, enchantments, preferences).
   */
  private refetchGameData(): void {
    this.world.resetData();
    this.send(buildSimple(BP.SEND_PLAYER));
    this.send(buildSimple(BP.SEND_ROOM_CONTENTS));
    this.send(buildSimple(BP.SEND_PLAYERS));
    this.requestGameData();
  }

  /**
   * language.c MenuLanguageChosen: strings in another language from now on, then
   * ResetUserData (game.c), asking for everything again so names already shown change too.
   */
  setLanguage(language: number): void {
    if (language === this.language) return;
    this.language = language;
    if (this.phase === "game") this.refetchGameData();
  }

  /** Send BP_PING (call every 5 s if pings are driven externally). */
  ping(): void {
    if (this.conn.state === "game") this.conn.ping();
  }

  useCharacter(id: number): void {
    this.logonUntil = Date.now() + LOGON_SERVER_TAB_MS;
    this.setPhase("entering");
    this.conn.sendGame(buildUseCharacter(id));
  }

  /** BP_SEND_CHARINFO: ask for what the character creator offers (answered with BP_CHARINFO). */
  requestCharInfo(): void {
    this.conn.sendGame(buildSendCharInfo());
  }

  /**
   * BP_NEW_CHARINFO: create the character in an empty slot (module/char charmake.c
   * VerifySettings). The server answers CHARINFO_OK (we then enter) or CHARINFO_NOT_OK.
   */
  createCharacter(info: NewCharInfo): void {
    this.setPhase("entering");
    this.conn.sendGame(buildNewCharInfo(info));
  }

  /** A character with default looks and even stats (for tools and tests). */
  createDefaultCharacter(slotId: number, name: string, gender: number = GENDER.MALE): void {
    this.createCharacter({
      id: slotId, name, description: "", gender, faceParts: [], hairTranslation: 0, skinTranslation: 3,
      stats: [35, 35, 35, 35, 35, 35], spells: [], skills: [],
    });
  }

  // ---- game actions (clientd3d/protocol.h Request*) ----

  /** BP_REQ_MOVE; x, y are client fine coordinates. */
  requestMove(x: number, y: number, speed: number): void {
    const p = this.world.player;
    if (p) this.send(buildReqMove(fineToKod(y), fineToKod(x), speed, p.roomId));
  }

  /** BP_REQ_TURN for our own object. */
  requestTurn(angle: number): void {
    const p = this.world.player;
    if (p) this.send(buildReqTurn(p.id, angle & 4095));
  }

  /** BP_REQ_GO: open a door / use the exit we're standing on (the Space key). */
  go(): void {
    this.send(buildSimple(BP.REQ_GO));
  }

  look(id: number): void {
    this.send(buildReqLook(id));
  }

  pickUp(id: number): void {
    this.send(new ByteWriter().u8(BP.REQ_GET).u32(objId(id)).finish());
  }

  /** BP_REQ_DROP takes an object: id, plus the amount for number items (protocol.c PARAM_OBJECT). */
  drop(id: number, amount?: number): void {
    const w = new ByteWriter().u8(BP.REQ_DROP).u32(id);
    if (amount !== undefined) w.u32(amount);
    this.send(w.finish());
  }

  /** Use (wield/wear) an inventory item. */
  use(id: number): void {
    this.send(new ByteWriter().u8(BP.REQ_USE).u32(objId(id)).finish());
  }

  unuse(id: number): void {
    this.send(new ByteWriter().u8(BP.REQ_UNUSE).u32(objId(id)).finish());
  }

  /** BP_SEND_OBJECT_CONTENTS: ask what's inside a container. */
  requestContents(id: number): void {
    this.send(buildReqObjectContents(id));
  }

  /** BP_REQ_GET_FROM_CONTAINER: take an item (all of it, or `amount` of a number item) out of a container. */
  getFromContainer(id: number, amount?: number): void {
    this.send(buildReqGetFromContainer(id, amount));
  }

  /** BP_REQ_PUT: put an inventory item into a container. */
  put(id: number, amount: number | undefined, container: number): void {
    this.send(buildReqPut(id, amount, container));
  }

  /** BP_REQ_APPLY: use an inventory item on another object. */
  apply(item: number, target: number): void {
    this.send(buildReqApply(item, target));
  }

  /** BP_CHANGE_DESCRIPTION: write an inscription or our own description. */
  changeDescription(id: number, text: string): void {
    this.send(buildChangeDescription(id, text));
  }

  /** UC_CHANGE_URL: our web page, shown when others look at us. */
  changeUrl(id: number, url: string): void {
    this.send(buildChangeUrl(id, url));
  }

  /** Activate a room object (levers, chests...). */
  activate(id: number): void {
    this.send(new ByteWriter().u8(BP.REQ_ACTIVATE).u32(objId(id)).finish());
  }

  say(text: string, kind: number = SAY.NORMAL): void {
    this.send(buildSay(text, kind));
  }

  /** BP_SAY_GROUP: say something to these players only ("tell", group messages). */
  sayTo(ids: readonly number[], text: string): void {
    if (ids.length) this.send(buildSayGroup(ids, text));
  }

  /** UC_SEND_PREFERENCES: the game options the server keeps for us (CF_* flags). */
  sendPreferences(flags: number): void {
    this.preferences = flags;
    this.userCommand(UC.SEND_PREFERENCES, flags);
  }

  /** BP_SEND_STATS: ask for a stat group (the stats panel asks when its tab opens). */
  requestStats(group: number): void {
    this.send(buildSendStats(group));
  }

  /** BP_REQ_BUY: ask a shopkeeper for their wares (answered with BP_BUY_LIST). */
  requestBuy(seller: number): void {
    this.send(buildReqBuy(seller));
  }

  buyItems(seller: number, items: ObjectRef[]): void {
    this.send(buildReqBuyItems(seller, items));
  }

  /** BP_REQ_WITHDRAWAL: ask a banker for the vault list (BP_WITHDRAWAL_LIST). */
  requestWithdrawal(banker: number): void {
    this.send(buildReqWithdrawal(banker));
  }

  withdrawItems(banker: number, items: ObjectRef[]): void {
    this.send(buildReqWithdrawalItems(banker, items));
  }

  depositItems(banker: number, items: ObjectRef[]): void {
    this.send(buildReqDeposit(banker, items));
  }

  /** BP_REQ_OFFER: offer items to someone; selling to a shopkeeper starts here. */
  offerItems(target: number, items: ObjectRef[]): void {
    this.send(buildReqOffer(target, items));
  }

  /**
   * BP_REQ_COUNTEROFFER: answer someone's offer with these items (none for "Offer
   * nothing"). The server only lets them accept after this (offer.c RcvOfferDialogProc IDOK).
   */
  counteroffer(items: ObjectRef[]): void {
    this.send(buildReqCounteroffer(items));
  }

  acceptOffer(): void {
    this.send(buildSimple(BP.ACCEPT_OFFER));
  }

  cancelOffer(): void {
    this.send(buildSimple(BP.CANCEL_OFFER));
  }

  cast(spell: number, targets: ObjectRef[] = []): void {
    this.logonUntil = 0;
    this.send(buildReqCast(spell, targets));
    for (const fn of this.castListeners) fn(spell);
  }

  /**
   * Ours: more listeners for the session's events, called after the ones it was made with (the
   * AI playtester's body in the page, tools/agent/inpage.ts); a function that stops them. Stop
   * them in the reverse order they were added.
   */
  listen(extra: SessionEvents): () => void {
    type Handler = ((...args: never[]) => void) | undefined;
    const events = this.events as Record<string, Handler>;
    const before: [string, Handler][] = [];
    for (const [key, fn] of Object.entries(extra) as [string, Handler][]) {
      if (!fn) continue;
      const prev = events[key];
      before.push([key, prev]);
      events[key] = (...args: never[]) => {
        prev?.(...args);
        fn(...args);
      };
    }
    return () => {
      for (const [key, prev] of before) events[key] = prev;
    };
  }

  /** Ours: each BP_REQ_CAST we send, by spell id (the quick slots' cooldowns, apps/client cooldowns.ts) */
  private readonly castListeners = new Set<(spell: number) => void>();
  onCastSent(fn: (spell: number) => void): () => void {
    this.castListeners.add(fn);
    return () => this.castListeners.delete(fn);
  }

  /** Ours: the server refused a cast (no reagents, no mana, resting), for Study mode (spellRefusal.ts) */
  private readonly refusalListeners = new Set<(refusal: SpellRefusal) => void>();
  onSpellRefused(fn: (refusal: SpellRefusal) => void): () => void {
    this.refusalListeners.add(fn);
    return () => this.refusalListeners.delete(fn);
  }

  /** A line from the client itself in the chat window (system colour, like GameMessage). */
  localMessage(text: string): void {
    this.chatLine("system", text, "server");
  }

  /** BP_REQ_ATTACK (gameuser.c UserAttackClosest sends ATTACK_NORMAL at the target). */
  attack(target: number): void {
    this.logonUntil = 0;
    this.send(buildReqAttack(target));
  }

  /** BP_USERCOMMAND (UC_DEPOSIT amount, UC_WITHDRAW amount, UC_BALANCE, UC_REST ...). */
  userCommand(uc: number, ...ints: number[]): void {
    this.send(buildUserCommand(uc, ...ints));
  }

  /** UC_SHARDS (ours): a command line for our server's Kod, such as "travel 2" (user.kod ShardsCommand) */
  shardsCommand(line: string): void {
    this.send(buildShardsCommand(line));
  }

  /** UC_SHARDS_OBJECT (ours): a command line about one object, such as "vault" on an item (user.kod ShardsObjectCommand) */
  shardsObject(id: number, line: string): void {
    this.send(buildShardsObjectCommand(id, line));
  }

  /** Ours: UC_FRIENDS, UC_PETS or UC_AMBIENT (shards-server util/shardssocial.kod), as an event */
  private readSocial(uc: number, r: ByteReader): SocialEvent | null {
    const room = (rsc: number) => (this.resource(rsc) ?? "").toLowerCase();
    const names = () => {
      const out: string[] = [];
      for (let n = r.u16(); n > 0; n--) out.push(r.string());
      return out;
    };
    if (uc === UC.AMBIENT) {
      const seed = r.u32();
      const elapsed = r.i32();
      const hour = r.u8();
      return { type: "ambient", seed, elapsed, hour: hour < 24 ? hour : null };
    }
    if (uc === UC.PETS) {
      const pets: { id: number; pet: ServerPet | null }[] = [];
      for (let n = r.u16(); n > 0; n--) {
        const id = r.u32();
        if (!r.u8()) {
          pets.push({ id, pet: null });
          continue;
        }
        const kind = r.string();
        const colour = r.u8();
        pets.push({ id, pet: { kind, colour, name: r.string() } });
      }
      return { type: "pets", pets };
    }
    switch (r.u8()) {
      // FR_LIST
      case 1: {
        const flags = r.u8();
        const friends: ServerFriend[] = [];
        for (let n = r.u16(); n > 0; n--) friends.push({ name: r.string(), online: r.u8() !== 0, lastSeen: r.u32() });
        const incoming = names();
        const outgoing = names();
        const following = r.u8() ? r.string() : null;
        return { type: "friends", flags, friends, incoming, outgoing, following, followers: names() };
      }
      // FR_LOC
      case 2: {
        const name = r.string();
        const shown = r.u8() !== 0;
        const rid = r.u32();
        const file = room(r.u32());
        const row = r.u16();
        return { type: "location", name, shown, rid, room: file, at: [row, r.u16()] };
      }
      // FR_HP
      case 3:
        return { type: "health", name: r.string(), pct: r.u8() };
      // FR_EXIT
      case 4: {
        const name = r.string();
        const from = room(r.u32());
        const to = room(r.u32());
        const row = r.u16();
        return { type: "exit", name, from, to, at: [row, r.u16()] };
      }
      // FR_SEARCH
      case 5:
        return { type: "search", names: names() };
    }
    return null;
  }

  /** BP_REQ_ADMIN: an admin command (the server answers with BP_ADMIN; only admin accounts may) */
  adminCommand(command: string): void {
    this.send(buildReqAdmin(command));
  }

  /** BP_ACTION (command.c, actions.c): a UA_* emote (wave, point, dance) or mood (happy, sad, neutral, wry). */
  action(ua: number): void {
    this.send(buildAction(ua));
  }

  /** UC_APPEAL (command.c CommandAppeal): a message to the game's staff. */
  appeal(text: string): void {
    this.send(buildAppeal(text));
  }

  /** BP_SAY_BLOCKED (msgfiltr.c): we hid a tell from this ignored player. */
  sayBlocked(id: number): void {
    this.send(buildSayBlocked(id));
  }

  /** BP_REQ_INVENTORY_MOVE (inventry.c): put an item where another one is in the inventory. */
  inventoryMove(id: number, before: number): void {
    this.send(buildReqInventoryMove(id, before));
  }

  /** mailnews.c ReceiveArticles: the index parts so far, and the last part number */
  private articleParts: NewsArticle[] = [];
  private lastArticlePart = 0;

  /** BP_CHANGED_STATS (statsmake.c VerifySettings) */
  changeStats(stats: readonly number[], levels: readonly number[]): void {
    this.send(buildChangedStats(stats, levels));
  }

  /** BP_REQ_GET_MAIL: send us our new mail (each comes as BP_MAIL) */
  requestMail(): void {
    this.send(buildReqGetMail());
  }

  /** BP_DELETE_MAIL: we've kept the message; the server may forget it */
  deleteMail(index: number): void {
    this.send(buildDeleteMail(index));
  }

  /** BP_REQ_LOOKUP_NAMES: mail recipients' names to ids (answered with BP_LOOKUP_NAMES) */
  lookupNames(names: readonly string[]): void {
    this.send(buildReqLookupNames(names));
  }

  /** BP_SEND_MAIL: "Subject: ...", a newline, then the message */
  sendMail(ids: readonly number[], text: string): void {
    this.send(buildSendMail(ids, text));
  }

  requestArticles(newsgroup: number): void {
    this.send(buildReqArticles(newsgroup));
  }

  requestArticle(newsgroup: number, num: number): void {
    this.send(buildReqArticle(newsgroup, num));
  }

  postArticle(newsgroup: number, title: string, text: string): void {
    this.send(buildPostArticle(newsgroup, title, text));
  }

  deleteArticle(newsgroup: number, num: number): void {
    this.send(buildDeleteNews(newsgroup, num));
  }

  /** Whether this is the account's password (command.c SuicideVerifyDialogProc checks the typed one). */
  passwordMatches(password: string): boolean {
    return password === this.opts.password;
  }

  /**
   * BP_CHANGE_PASSWORD (maindlg.c PasswordDialogProc): both passwords as digests. The server
   * answers BP_PASSWORD_OK or BP_PASSWORD_NOT_OK; like the original, we take the new one as
   * ours if the old one was right.
   */
  changePassword(oldPassword: string, newPassword: string): void {
    if (oldPassword === this.opts.password) this.opts.password = newPassword;
    this.send(buildChangePassword(passwordDigest(oldPassword), passwordDigest(newPassword)));
  }

  /** Send any game message (protocol builders). */
  send(body: Uint8Array): void {
    if (this.conn.state === "game") this.conn.sendGame(body);
  }

  /**
   * Ours: back to the character list, still logged in (to play another character). The server
   * answers BP_REQ_QUIT with BP_QUIT, as for the original's quit (gameuser.c RequestQuit), and the
   * menu that follows brings the list (see the BP.QUIT case).
   */
  toCharacters(): void {
    this.send(buildSimple(BP.REQ_QUIT));
  }

  close(): void {
    this.clearLoginTimer();
    this.clearCharactersTimer();
    this.closedByUs = true;
    try {
      if (this.conn.state === "game") this.conn.sendGame(buildSimple(BP.REQ_QUIT));
    } catch {
      // ignore
    }
    this.ws.close();
    this.conn.close();
    this.setPhase("closed");
  }

  /** Resource string: dynamic (player names) first, then the .rsb. */
  resource(id: number): string | undefined {
    return this.world.dynamicResources.get(id) ?? this.opts.lookupResource(id, this.language);
  }

  /**
   * Ours (the magic item revamp): an item's name for lists: a revealed magic item's full name
   * ("potent longsword of siphoning"), asked of the server the first time it's seen with those
   * flags (UC_SHARDS_OBJECT "magicname"; it comes as UC_MAGIC_NAME and lists redraw), else its own.
   */
  itemName(o: { id: number; nameRes: number; flags: number }): string {
    const own = this.resource(o.nameRes) ?? "";
    if (magicShow(o.flags) < MAGIC_SHOW.REVEALED) return own;
    const known = this.world.magicNames.get(o.id);
    if (known?.flags === o.flags) return known.name;
    const key = `${o.id}:${o.flags}`;
    if (!this.world.magicNamesAsked.has(key)) {
      this.world.magicNamesAsked.add(key);
      this.shardsObject(o.id, "magicname");
    }
    return known?.name ?? own;
  }

  /** Until then, server messages are the logon's, for the Server tab (LOGON_SERVER_TAB_MS) */
  private logonUntil = 0;

  /**
   * The resource language strings are shown in (config.language, the Language menu; English
   * is 0). The redbook token and our format-string matching (chat tabs, damage numbers)
   * stay on English.
   */
  language = 0;

  /** A string in English, for matching format strings and names written in it */
  englishResource(id: number): string | undefined {
    return this.world.dynamicResources.get(id) ?? this.opts.lookupResource(id);
  }

  /**
   * What the original asks for on entering the game: the inventory (game.c GameInit)
   * and, from the interface module, stat groups, skills, spells and our enchantments
   * (merintr mermain.c InterfaceInit, enchant.c EnchantmentsInit).
   */
  private requestGameData(): void {
    this.send(buildSimple(BP.REQ_INVENTORY));
    this.send(buildSendStatGroups());
    this.send(buildSendSkills());
    this.send(buildSendSpells());
    this.send(buildSendEnchantments(ENCHANT.PLAYER));
    // mermain.c InterfaceUserChanged: RequestPreferences
    this.userCommand(UC.REQ_PREFERENCES);
  }

  /**
   * Applied to every line before it's shown, colour codes and all (srvrstr.c DisplayMessage
   * runs the profanity filter there); the client sets it.
   */
  textFilter: ((text: string) => string) | null = null;

  private chatLine(kind: ChatLine["kind"], text: string, channel: ChatChannel, extra: Pick<ChatLine, "sender" | "sayType"> = {}): void {
    const shown = this.textFilter ? this.textFilter(text) : text;
    const logon = Date.now() < this.logonUntil || undefined;
    this.events.chat?.({ kind, channel, spans: parseMarkup(shown, DEFAULT_COLORS[kind]), time: Date.now(), logon, ...extra });
  }

  private setPhase(p: SessionPhase): void {
    if (p === "characters" || p === "entering" || p === "game") this.clearCharactersTimer();
    if (this.phase === p) return;
    this.phase = p;
    this.events.phase?.(p);
  }

  private fail(message: string): void {
    this.events.error?.(message);
    this.close();
  }

  private onLogin(type: number, r: ByteReader): void {
    this.events.debug?.(`<- ${apName(type)}`);
    switch (type) {
      case AP.GETLOGIN:
        this.setPhase("login");
        this.conn.sendLogin(
          buildLogin({
            username: this.opts.username,
            passwordDigest: passwordDigest(this.opts.password),
            secretKey: this.opts.secretKey,
            screenWidth: globalThis.screen?.width,
            screenHeight: globalThis.screen?.height,
          }),
        );
        break;
      case AP.LOGINFAILED:
        this.fail("Login failed. Check your password.");
        break;
      case AP.ACCOUNTUSED:
        this.fail("That account is already in use.");
        break;
      case AP.TOOMANYLOGINS:
        this.fail("Too many failed logins.");
        break;
      case AP.MESSAGE:
        this.fail(r.string());
        break;
      case AP.GETCLIENT:
      case AP.CLIENT_PATCH:
        this.fail("The server rejected this client (wrong secret key or version).");
        break;
      case AP.TIMEOUT:
        // server.c HandleTimeout -> LoginTimeout: IDS_TIMEOUT
        this.fail("Login timed out.");
        break;
      case AP.DOWNLOAD: {
        // server.c HandleDownload: the server has update files for the original client
        // (download.c fetches them). Our game files come from the asset manifest instead,
        // so say why rather than waiting for a login that never comes.
        r.u16(); // number of files
        r.string(); // machine
        r.string(); // path
        const reason = r.string();
        this.fail(`The server wants to send client updates, which Meridian Shards can't install${reason ? `: ${reason}` : "."}`);
        break;
      }
      case AP.NOCHARACTERS:
        this.fail("This account has no character slots.");
        break;
      case AP.GETCHOICE:
        if (this.closedByUs) return;
        this.conn.sendLogin(buildReqGame());
        break;
      default:
        break;
    }
  }

  private onGame(type: number, r: ByteReader): void {
    const start = r.pos;
    if (this.world.handle(type, r)) {
      if (type === BP.PLAYER) {
        // game.c EnterNewRoom: looping sounds belong to the room we left
        this.events.sound?.({ type: "stopLoops" });
        if (this.phase !== "game") {
          this.logonUntil = Date.now() + LOGON_SERVER_TAB_MS;
          this.setPhase("game");
          this.requestGameData();
        }
      }
      if (type === BP.STAT_GROUPS) this.requestStats(STAT_GROUP.MAIN); // stats.c StatsGroupsInfo
    } else {
      switch (type) {
        case BP.LOAD_MODULE: {
          const name = this.resource(r.u32()) ?? "";
          this.events.debug?.(`load module ${name}`);
          // The char module (char.dll) asks for the character list when it loads.
          if (/char/i.test(name) && this.phase !== "game") this.conn.sendGame(buildSimple(BP.SEND_CHARACTERS));
          this.events.module?.(name, true);
          break;
        }
        case BP.UNLOAD_MODULE: {
          // server.c HandleUnloadModule -> modules.c ModuleExitByRsc (the mini-games close theirs)
          const name = this.resource(r.u32()) ?? "";
          this.events.debug?.(`unload module ${name}`);
          this.events.module?.(name, false);
          break;
        }
        case BP.CHARACTERS: {
          // Logged in: the login's timers are done
          this.clearCharactersTimer();
          const { characters, motd } = readCharacters(r);
          this.characters = characters;
          this.setPhase("characters");
          this.events.characters?.(characters, motd);
          break;
        }
        case BP.CHARINFO:
          this.events.charInfo?.(readCharInfo(r));
          break;
        case BP.CHARINFO_OK:
          this.conn.sendGame(buildUseCharacter(r.u32()));
          break;
        case BP.CHARINFO_NOT_OK:
          this.setPhase("characters");
          this.events.error?.("That name can't be used. Try another.");
          this.events.characters?.(this.characters, "");
          break;
        case BP.QUIT:
          // game.c GameQuit: back to the menu, still logged in (after a suicide, a rescue). The
          // server is in STATE_SYNCHED again and offers the menu (AP_GETCHOICE), which onLogin
          // answers with AP_REQ_GAME, so we come back to the character list.
          this.world.resetData();
          this.setPhase("login");
          break;
        case BP.MESSAGE:
        case BP.SYS_MESSAGE: {
          // server.c HandleStringMessage -> GameMessage (system colour); the tab from the format
          const format = r.u32();
          const params = new ByteReader(r.buf.subarray(r.pos));
          const text = formatServerMessage(format, r, (id) => this.resource(id));
          const formatText = this.englishResource(format) ?? "";
          // The logon's messages (welcome, news, quests, the help text) all go to the Server tab,
          // whatever words they use; after that, the format string decides
          const channel = type === BP.SYS_MESSAGE || Date.now() < this.logonUntil ? "server" : messageChannel(formatText);
          if (text !== null) this.chatLine("system", text, channel);
          if (type === BP.MESSAGE) {
            const hit = readDamageDealt(formatText, params, (id) => this.resource(id));
            if (hit) this.events.damageDealt?.(hit);
            const refusal = readSpellRefusal(formatText, new ByteReader(params.buf), (id) => this.englishResource(id));
            if (refusal) for (const fn of this.refusalListeners) fn(refusal);
          }
          break;
        }
        case BP.SAID: {
          // server.c HandleSaid: sender id, sender name rsc, say type, then a message
          const senderId = r.u32();
          const senderName = this.resource(r.u32()) ?? "";
          const sayType = r.u8();
          const text = formatServerMessage(r.u32(), r, (id) => this.resource(id));
          if (text !== null)
            this.chatLine(sayType === SAY.RESOURCE ? "said-resource" : "say", text, "chat", { sender: { id: senderId, name: senderName }, sayType });
          break;
        }
        case BP.USERCOMMAND: {
          // merintr.c HandleUserCommand
          const uc = r.u8();
          if (uc === UC.RECEIVE_PREFERENCES) {
            this.preferences = r.i32();
            this.events.preferences?.(this.preferences);
          } else if (uc === UC.SPELL_SCHOOLS) {
            // merintr.c HandleSpellSchools: the schools' names, for the Spells menu
            const n = r.u8();
            const schools: number[] = [];
            for (let i = 0; i < n; i++) schools.push(r.u32());
            this.world.setSpellSchools(schools);
          } else if (uc === UC.GUILDINFO) {
            this.events.guild?.({ type: "info", info: readGuildInfo(r) });
          } else if (uc === UC.GUILD_ASK) {
            const cost = r.i32();
            this.events.guild?.({ type: "ask", cost, secretCost: r.i32() });
          } else if (uc === UC.GUILD_LIST) {
            this.events.guild?.({ type: "list", list: readGuildList(r) });
          } else if (uc === UC.GUILD_SHIELD) {
            this.events.guild?.({ type: "shield", shield: readGuildShield(r) });
          } else if (uc === UC.GUILD_SHIELDS) {
            this.events.guild?.({ type: "shields", patterns: readGuildShields(r) });
          } else if (uc === UC.GUILD_HALLS) {
            this.events.guild?.({ type: "halls", halls: readGuildHalls(r) });
          } else if (uc === UC.MINIGAME_START) {
            // chess.c HandleGameStart: game ID, player number BYTE
            this.events.minigame?.({ type: "start", game: r.u32(), player: r.u8() });
          } else if (uc === UC.MINIGAME_MOVE) {
            // HandleGameState: game ID, state string
            this.events.minigame?.({ type: "state", game: r.u32(), state: r.string() });
          } else if (uc === UC.MINIGAME_PLAYER) {
            // HandleGamePlayer: player number BYTE, name string
            this.events.minigame?.({ type: "player", player: r.u8(), name: r.string() });
          } else if (uc === UC.TRAVEL_LIST) {
            // Ours (user.kod SendTravelList): this point, the lockout's seconds, then id and name each
            const here = r.u32();
            const pvpSeconds = r.i32();
            const n = r.u8();
            const places: TravelPlace[] = [];
            for (let i = 0; i < n; i++) {
              const id = r.u32();
              places.push({ id, name: this.resource(r.u32()) ?? `#${id}` });
            }
            this.events.travel?.({ type: "list", here, pvpSeconds, places: places.reverse() });
          } else if (uc === UC.PVP_UNTIL) {
            // Ours (user.kod SendPvPUntil)
            this.events.travel?.({ type: "pvp", seconds: r.i32() });
          } else if (uc === UC.QUEST_OFFERS) {
            // Ours (questbook.kod SendOffers): the NPC, then id, state and step each
            const npc = objId(r.u32());
            const offers: QuestOffer[] = [];
            for (let i = r.u8(); i > 0; i--) offers.push({ id: r.u32(), state: r.u8(), step: r.u8() });
            this.events.quest?.({ type: "offers", npc, offers });
          } else if (uc === UC.QUEST_LOG) {
            // Ours (questbook.kod SendLog): the catalogue's hash, the active quests, the quests done
            const hash = r.u32();
            const active: QuestLogEntry[] = [];
            for (let i = r.u8(); i > 0; i--) active.push({ id: r.u32(), step: r.u8(), count: r.u16(), secondsLeft: r.i32() });
            const done: { id: number; times: number }[] = [];
            for (let i = r.u16(); i > 0; i--) done.push({ id: r.u32(), times: r.u16() });
            this.events.quest?.({ type: "log", hash, active, done });
          } else if (uc === UC.QUEST_PROGRESS) {
            // Ours (questbook.kod SendProgress)
            this.events.quest?.({ type: "progress", id: r.u32(), step: r.u8(), count: r.u16() });
          } else if (uc === UC.SIGNETS) {
            // Ours (questbook.kod SendSignets): each ring, its owner's name, their room's name and number
            const rings: SignetRing[] = [];
            for (let n = r.u8(); n > 0; n--) {
              const id = objId(r.u32());
              const owner = this.resource(r.u32()) ?? "";
              const room = this.resource(r.u32()) ?? "";
              rings.push({ id, owner, room, rid: r.u32() });
            }
            this.events.quest?.({ type: "signets", rings });
          } else if (uc === UC.SEASON) {
            // Ours (system.kod SendSeason): the season, the year, the day of the year
            this.world.season = { season: r.u8(), year: r.u16(), day: r.u16() };
          } else if (uc === UC.ARENA) {
            // Ours (arenabouts.kod SendStatus)
            const s = readArena(r, (id) => this.resource(id));
            if (s) this.events.arena?.(s);
          } else if (uc === UC.COMPANION) {
            // Ours (companionbook.kod SendStatus, HealthChanged)
            const e = readCompanion(r, (id) => this.resource(id));
            if (e) this.events.companion?.(e);
          } else if (uc === UC.COSMETICS) {
            // Ours (cosmeticsbook.kod SendTailorMenu, SendBarberMenu)
            const e = readCosmetics(r, (id) => this.resource(id));
            if (e) this.events.cosmetics?.(e);
          } else if (uc === UC.ITEM_SERVICE) {
            // Ours (itemservicebook.kod SendRevealMenu, SendRepairMenu): opens as a tailor's does
            const e = readItemService(r);
            if (e) this.events.cosmetics?.(e);
          } else if (uc === UC.MAGIC_NAME) {
            // Ours (itemservicebook.kod SendMagicName): asked for by itemName
            const m = readMagicName(r, (id) => this.resource(id));
            if (m) this.world.setMagicName(m.id, m.flags, m.name);
          } else if (uc === UC.TRAINING) {
            // Ours (shardsabilities.kod SendTraining)
            this.events.training?.(readTraining(r));
          } else if (uc === UC.APPRAISAL) {
            // Ours (shardsabilities.kod SendAppraisal)
            this.events.appraisal?.(readAppraisal(r));
          } else if (uc === UC.SELLABLE) {
            // Ours (shardsabilities.kod SendSellable)
            this.events.sellable?.(readSellable(r));
          } else if (uc === UC.FRIENDS || uc === UC.PETS || uc === UC.AMBIENT) {
            // Ours (shards-server util/shardssocial.kod)
            const e = this.readSocial(uc, r);
            if (e) this.events.social?.(e);
          } else if (uc === UC.SEND_QUIT) {
            // merintr.c HandleSendQuit: the server wants us out (after a suicide, a rescue)
            this.send(buildSimple(BP.REQ_QUIT));
          } else if (uc === UC.LOOK_PLAYER) {
            // HandleLookPlayer: the player, flags, their own words, the fixed string, the URL
            const object = readObject(r);
            const flags = r.u8();
            const lookup = (id: number) => this.resource(id);
            const words = formatServerMessage(r.u32(), r, lookup) ?? "";
            const fixed = formatServerMessage(r.u32(), r, lookup) ?? "";
            const url = r.string();
            this.events.look?.({ object, name: this.resource(object.nameRes) ?? "", description: fixed, inscription: words, flags, url, player: true });
          }
          break;
        }
        case BP.BUY_LIST:
        case BP.WITHDRAWAL_LIST: {
          const { seller, items } = readBuyList(r);
          this.events.trade?.({ kind: type === BP.BUY_LIST ? "buy" : "withdraw", seller, items });
          break;
        }
        case BP.WAIT:
          // server.c HandleWait: the system is saving; the target's id won't survive it
          this.world.emitIdsStale();
          this.world.setWaiting(true);
          break;
        case BP.UNWAIT:
          // server.c HandleUnwait -> game.c GameUnwait: back to playing
          this.world.setWaiting(false);
          break;
        case BP.INVALIDATE_DATA:
          this.refetchGameData();
          break;
        case BP.PASSWORD_OK:
          // server.c HandlePasswordOk: IDS_PASSWORDCHANGED
          this.localMessage("Password changed.");
          break;
        case BP.PASSWORD_NOT_OK:
          this.localMessage("You typed your old password incorrectly.  Password NOT changed!");
          break;
        case BP.RESYNC:
          // server.c HandleGameResync -> GameDisplayResync (Connection runs the handshake)
          this.localMessage("Transmission error; trying to reestablish connection.");
          break;
        case BP.OBJECT_CONTENTS: {
          // server.c HandleObjectContents: the container, then its contents
          const container = r.u32();
          this.events.contents?.(container, readObjectList(r));
          break;
        }
        case BP.OFFERED:
          this.events.offer?.({ type: "offered", items: readObjectList(r) });
          break;
        case BP.COUNTEROFFER:
          this.events.offer?.({ type: "counteroffer", items: readObjectList(r) });
          break;
        case BP.COUNTEROFFERED:
          this.events.offer?.({ type: "counteroffered", items: readObjectList(r) });
          break;
        case BP.OFFER: {
          const { offerer, items } = readOffer(r);
          this.events.offer?.({ type: "received", offerer, items });
          break;
        }
        case BP.OFFER_CANCELED:
          this.events.offer?.({ type: "canceled" });
          break;
        case BP.PLAY_WAVE: {
          const wave = readPlayWave(r);
          const file = this.resource(wave.resource);
          if (file) this.events.sound?.({ type: "play", wave, file });
          break;
        }
        case BP.STOP_WAVE: {
          const file = this.resource(r.u32());
          const object = r.u32();
          if (file) this.events.sound?.({ type: "stop", file, object });
          break;
        }
        case BP.PLAY_MUSIC:
        case BP.PLAY_MIDI: {
          const file = this.resource(r.u32());
          if (file) this.events.sound?.({ type: "music", file });
          break;
        }
        case BP.REQ_STAT_CHANGE: {
          const { stats, levels } = readStatChange(r);
          this.events.statChange?.(stats, levels);
          break;
        }
        case BP.ADMIN:
          // admin.c HandleAdmin: a string
          this.events.admin?.(r.string());
          break;
        case BP.LOOK_NEWSGROUP: {
          // mailnews.c HandleLookNewsgroup: a news globe, instead of BP_LOOK
          const { newsgroup, permission, object } = readLookNewsgroup(r);
          const description = formatServerMessage(r.u32(), r, (id) => this.resource(id)) ?? "";
          this.events.mailNews?.({ type: "newsgroup", newsgroup, permission, object, name: this.resource(object.nameRes) ?? "", description });
          break;
        }
        case BP.ARTICLES: {
          // ReceiveArticles: parts arrive in order; the index is whole at the last one
          const { newsgroup, part, maxPart, articles } = readArticles(r);
          if (part !== this.lastArticlePart + 1) {
            this.lastArticlePart = 0;
            break;
          }
          this.lastArticlePart = part;
          this.articleParts = part === 1 ? articles : [...this.articleParts, ...articles];
          if (part === maxPart) {
            this.lastArticlePart = 0;
            this.events.mailNews?.({ type: "articles", newsgroup, articles: this.articleParts });
          }
          break;
        }
        case BP.ARTICLE:
          this.events.mailNews?.({ type: "article", text: r.string() });
          break;
        case BP.MAIL: {
          const { index, sender, time, recipients } = readMailHeader(r);
          if (!recipients.length) {
            this.events.mailNews?.({ type: "noMoreMail" });
            break;
          }
          const text = formatServerMessage(r.u32(), r, (id) => this.resource(id)) ?? "";
          this.events.mailNews?.({ type: "mail", index, sender, time, recipients, text });
          break;
        }
        case BP.LOOKUP_NAMES:
          this.events.mailNews?.({ type: "lookupNames", ids: readLookupNames(r) });
          break;
        case BP.LOOK: {
          const object = readObject(r);
          const flags = r.u8();
          const lookup = (id: number) => this.resource(id);
          const description = formatServerMessage(r.u32(), r, lookup) ?? "";
          const inscription = flags & 0x03 && r.remaining >= 4 ? formatServerMessage(r.u32(), r, lookup) : null;
          this.events.look?.({ object, name: this.resource(object.nameRes) ?? "", description, inscription, flags, url: null, player: false });
          break;
        }
        default:
          break;
      }
    }
    r.pos = start;
    this.events.message?.(type, r);
    if (type !== BP.ECHO_PING) this.events.debug?.(`<- ${bpName(type)}`);
  }
}
