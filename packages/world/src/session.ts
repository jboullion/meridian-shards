// A game session over any WebSocket-like transport: login, character selection,
// entering the game, and feeding game messages into WorldState. Used by the browser
// client; the protocol details live in @shards/protocol.

import {
  AP, BP, ByteReader, ByteWriter, Connection, ENCHANT, GENDER, SAY, apName, bpName, buildLogin, buildNewCharInfo,
  buildReqAttack, buildReqBuy, buildReqBuyItems, buildReqCast, buildReqDeposit, buildReqGame, buildReqLook, buildReqMove,
  buildReqOffer, buildReqTurn, buildReqWithdrawal, buildReqWithdrawalItems, buildSay, buildSayGroup, buildSendEnchantments,
  buildSendSkills, buildSendSpells, buildSendStatGroups, buildSendStats, buildSimple, buildUseCharacter, buildUserCommand,
  buildSendCharInfo, UC, objId, passwordDigest, readBuyList, readCharInfo, readCharacters, readObject, readObjectList, readOffer, readPlayWave, STAT_GROUP,
  type BuyItem, type CharInfo, type CharacterSlot, type NewCharInfo, type ObjectInfo, type ObjectRef, type PlayWave,
} from "@shards/protocol";
import { WorldState, fineToKod } from "./state.ts";
import { formatServerMessage, parseMarkup, type TextSpan } from "./text.ts";

/** A line for the chat window, with the original client's default colour for its kind. */
export interface ChatLine {
  kind: "system" | "say" | "said-resource";
  spans: TextSpan[];
  time: number;
  /** Who said it (BP_SAID), for ignoring players (msgfiltr.c) */
  sender?: { id: number; name: string };
  /** BP_SAID's say type (SAY_*), e.g. SAY_EVERYONE for broadcasts */
  sayType?: number;
}

/** BP_LOOK: an object's description (DisplayDescription). */
export interface LookResult {
  object: ObjectInfo;
  name: string;
  description: string;
  inscription: string | null;
  flags: number;
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
 * (BP_COUNTEROFFER, e.g. a shopkeeper's shillings), or cancels.
 */
export type OfferEvent =
  | { type: "offered"; items: ObjectInfo[] }
  | { type: "counteroffer"; items: ObjectInfo[] }
  | { type: "received"; offerer: ObjectInfo; items: ObjectInfo[] }
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
  trade?: (list: TradeList) => void;
  offer?: (e: OfferEvent) => void;
  sound?: (e: SoundEvent) => void;
  /** A ping's round trip in ms, every 5 s in the game (lagbox.c) */
  latency?: (ms: number) => void;
  /** The game options the server keeps for us (UC_RECEIVE_PREFERENCES: CF_* flags) */
  preferences?: (flags: number) => void;
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
    this.chatLine("system", text);
  }

  /** BP_REQ_ATTACK (gameuser.c UserAttackClosest sends ATTACK_NORMAL at the target). */
  attack(target: number): void {
    this.send(buildReqAttack(target));
  }

  /** BP_USERCOMMAND (UC_DEPOSIT amount, UC_WITHDRAW amount, UC_BALANCE, UC_REST ...). */
  userCommand(uc: number, ...ints: number[]): void {
    this.send(buildUserCommand(uc, ...ints));
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

  private chatLine(kind: ChatLine["kind"], text: string, extra: Pick<ChatLine, "sender" | "sayType"> = {}): void {
    this.events.chat?.({ kind, spans: parseMarkup(text, DEFAULT_COLORS[kind]), time: Date.now(), ...extra });
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
          // server.c HandleStringMessage -> GameMessage (system colour)
          const text = formatServerMessage(r.u32(), r, (id) => this.resource(id));
          if (text !== null) this.chatLine("system", text);
          break;
        }
        case BP.SAID: {
          // server.c HandleSaid: sender id, sender name rsc, say type, then a message
          const senderId = r.u32();
          const senderName = this.resource(r.u32()) ?? "";
          const sayType = r.u8();
          const text = formatServerMessage(r.u32(), r, (id) => this.resource(id));
          if (text !== null)
            this.chatLine(sayType === SAY.RESOURCE ? "said-resource" : "say", text, { sender: { id: senderId, name: senderName }, sayType });
          break;
        }
        case BP.USERCOMMAND: {
          // merintr.c HandleUserCommand: only UC_RECEIVE_PREFERENCES matters to us yet
          if (r.u8() === UC.RECEIVE_PREFERENCES) {
            this.preferences = r.i32();
            this.events.preferences?.(this.preferences);
          }
          break;
        }
        case BP.BUY_LIST:
        case BP.WITHDRAWAL_LIST: {
          const { seller, items } = readBuyList(r);
          this.events.trade?.({ kind: type === BP.BUY_LIST ? "buy" : "withdraw", seller, items });
          break;
        }
        case BP.OFFERED:
          this.events.offer?.({ type: "offered", items: readObjectList(r) });
          break;
        case BP.COUNTEROFFER:
          this.events.offer?.({ type: "counteroffer", items: readObjectList(r) });
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
          this.events.look?.({ object, name: this.resource(object.nameRes) ?? "", description, inscription, flags });
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
