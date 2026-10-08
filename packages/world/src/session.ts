// A game session over any WebSocket-like transport: login, character selection,
// entering the game, and feeding game messages into WorldState. Used by the browser
// client; the protocol details live in @shards/protocol.

import {
  AP, BP, ByteReader, ByteWriter, Connection, ENCHANT, GENDER, SAY, apName, bpName, buildLogin, buildNewCharInfo,
  buildReqAttack, buildReqBuy, buildReqBuyItems, buildReqCast, buildReqDeposit, buildReqGame, buildReqLook, buildReqMove,
  buildReqCounteroffer, buildReqOffer, buildReqTurn, buildReqWithdrawal, buildReqWithdrawalItems, buildSay, buildSayGroup, buildSendEnchantments,
  buildSendSkills, buildSendSpells, buildChangeDescription, buildChangeUrl, buildReqApply,
  buildReqGetFromContainer, buildReqObjectContents, buildReqPut, buildSendStatGroups, buildSendStats, buildSimple, buildUseCharacter, buildUserCommand,
  buildSendCharInfo, buildAction, buildAppeal, buildChangePassword, buildReqInventoryMove, buildSayBlocked, UC, objId, passwordDigest, readBuyList, readCharInfo, readCharacters, readObject, readObjectList, readOffer, readPlayWave, STAT_GROUP,
  type BuyItem, type CharInfo, type CharacterSlot, type NewCharInfo, type ObjectInfo, type ObjectRef, type PlayWave,
} from "@shards/protocol";
import { WorldState, fineToKod } from "./state.ts";
import { formatServerMessage, parseMarkup, type TextSpan } from "./text.ts";
import { messageChannel, type ChatChannel } from "./chatChannel.ts";
import { readDamageDealt, type DamageDealt } from "./combatHit.ts";

/** A line for the chat window, with the original client's default colour for its kind. */
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
  lookupResource: (id: number) => string | undefined;
  /** Set when pings are driven externally (Web Worker); see Connection.pingIntervalMs. */
  pingIntervalMs?: number;
  /** Factory for the socket; defaults to the global WebSocket. */
  createSocket?: (url: string) => WebSocket;
}

export interface SessionEvents {
  phase?: (phase: SessionPhase) => void;
  characters?: (characters: CharacterSlot[], motd: string) => void;
  /** The character creator's choices (BP_CHARINFO), after requestCharInfo() */
  charInfo?: (info: CharInfo) => void;
  error?: (message: string) => void;
  chat?: (line: ChatLine) => void;
  look?: (look: LookResult) => void;
  /** BP_OBJECT_CONTENTS: what's inside a container we asked about (gameuser.c GotObjectContents) */
  contents?: (container: number, items: ObjectInfo[]) => void;
  trade?: (list: TradeList) => void;
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
    this.ws.onopen = () => this.conn.start();
    this.ws.onmessage = (ev) => this.conn.receive(new Uint8Array(ev.data as ArrayBuffer));
    this.ws.onclose = () => {
      if (!this.closedByUs && this.phase !== "closed") this.events.error?.("Disconnected from the server.");
      this.setPhase("closed");
      this.conn.close();
    };
    this.ws.onerror = () => this.events.debug?.("socket error");
  }

  /** Resynchronizing after a transmission error (the beacon handshake) */
  private resyncing = false;

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

  /** Send BP_PING (call every 5 s if pings are driven externally). */
  ping(): void {
    if (this.conn.state === "game") this.conn.ping();
  }

  useCharacter(id: number): void {
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
    this.send(buildReqCast(spell, targets));
  }

  /** A line from the client itself in the chat window (system colour, like GameMessage). */
  localMessage(text: string): void {
    this.chatLine("system", text, "server");
  }

  /** BP_REQ_ATTACK (gameuser.c UserAttackClosest sends ATTACK_NORMAL at the target). */
  attack(target: number): void {
    this.send(buildReqAttack(target));
  }

  /** BP_USERCOMMAND (UC_DEPOSIT amount, UC_WITHDRAW amount, UC_BALANCE, UC_REST ...). */
  userCommand(uc: number, ...ints: number[]): void {
    this.send(buildUserCommand(uc, ...ints));
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

  close(): void {
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

  private chatLine(kind: ChatLine["kind"], text: string, channel: ChatChannel, extra: Pick<ChatLine, "sender" | "sayType"> = {}): void {
    this.events.chat?.({ kind, channel, spans: parseMarkup(text, DEFAULT_COLORS[kind]), time: Date.now(), ...extra });
  }

  private setPhase(p: SessionPhase): void {
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
          this.setPhase("closed");
          break;
        case BP.MESSAGE:
        case BP.SYS_MESSAGE: {
          // server.c HandleStringMessage -> GameMessage (system colour); the tab from the format
          const format = r.u32();
          const params = new ByteReader(r.buf.subarray(r.pos));
          const text = formatServerMessage(format, r, (id) => this.resource(id));
          const formatText = this.resource(format) ?? "";
          const channel = type === BP.SYS_MESSAGE ? "server" : messageChannel(formatText);
          if (text !== null) this.chatLine("system", text, channel);
          if (type === BP.MESSAGE) {
            const hit = readDamageDealt(formatText, params, (id) => this.resource(id));
            if (hit) this.events.damageDealt?.(hit);
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
