// The agent's character (docs/adr/0020-ai-playtester.md): a GameSession it acts through, with a
// journal of what happens to it and the latest of each answer the tools wait for (a look, a shop's
// wares, quest offers, the quest log). No Node APIs: the headless body (headless.ts) makes its own
// session in Node; the browser body attaches to the real client's (inpage.ts), moving the scene's
// mover with it so the view follows.

import { SAY } from "../../packages/protocol/src/index.ts";
import type {
  ChatLine, ContainerContents, GameSession, LookResult, OfferEvent, QuestEvent, QuestLogEntry, SessionEvents, TradeList, TrainingCost, WorldEvent,
} from "../../packages/world/src/index.ts";
import { QUEST_OFFER } from "../../packages/world/src/session.ts";
import type { GameInfo } from "./gameInfo.ts";
import { health, nameOf, roomName, type View } from "./describe.ts";
import { Journal, type EntryKind } from "./journal.ts";

/** What the tools wait for, by name, with what came */
export interface Answers {
  look: LookResult;
  trade: TradeList;
  offers: Extract<QuestEvent, { type: "offers" }>;
  questLog: Extract<QuestEvent, { type: "log" }>;
  contents: ContainerContents;
  offer: OfferEvent;
  /** UC_TRAINING: what we can train, and 1%'s cost */
  training: TrainingCost[];
  inGame: true;
}

/** The client's PlayerMover, when the body is in the real client: it owns where we stand there */
export interface MoverHook {
  place(x: number, y: number, now: number): void;
  setAngle(angle: number): void;
}

const SAY_NAMES: Record<number, string> = {
  [SAY.NORMAL]: "says", [SAY.YELL]: "yells", [SAY.EVERYONE]: "broadcasts", [SAY.GROUP]: "tells", [SAY.EMOTE]: "emote", [SAY.DM]: "DM", [SAY.GUILD]: "guild",
};
const OFFER_STATE: Record<number, string> = {
  [QUEST_OFFER.OFFER]: "offered", [QUEST_OFFER.READY]: "ready to hand in", [QUEST_OFFER.PENDING]: "under way", [QUEST_OFFER.SOON]: "later (more health)",
};
/** How long after entering a room a move from the server is our placing */
const ARRIVAL_MS = 2000;
/** The Underworld, where the dead go */
const UNDERWORLD = "uworld.roo";

export class Body {
  readonly journal = new Journal();
  readonly data: GameInfo;
  session: GameSession | null = null;
  /** The creature we last attacked or targeted */
  target: number | null = null;
  questLog: { active: QuestLogEntry[]; done: { id: number; times: number }[] } | null = null;
  lastLook: LookResult | null = null;
  /** The next journal entry wait_events reads from */
  cursor = 1;
  /** The client's mover, in the browser body */
  mover: MoverHook | null = null;
  private waiters: { name: keyof Answers; resolve: (v: unknown) => void }[] = [];
  private lastHealthPct = 100;
  /** When we last came into a room: the server places us then, which isn't a blocked step */
  private enteredAt = 0;
  private unwatch: (() => void)[] = [];

  constructor(data: GameInfo) {
    this.data = data;
  }

  get inGame(): boolean {
    return this.session?.phase === "game" && !!this.session.world.self;
  }

  /** The session, or an error for the tool to show */
  get live(): GameSession {
    if (!this.session || !this.inGame) throw new Error("Not in the game: call connect first.");
    return this.session;
  }

  /** Throws unless we're in the game */
  mustBeIn(): void {
    void this.live;
  }

  name = (res: number): string => this.session?.resource(res) ?? "";

  get roomFile(): string {
    const p = this.session?.world.player;
    return p ? this.name(p.roomRes).toLowerCase() : "";
  }

  get view(): View {
    if (!this.session) throw new Error("Not connected.");
    return { world: this.session.world, name: this.name, roomFile: this.roomFile, exits: this.data.exits, roomsOf: (f) => this.data.roomsOf(f) };
  }

  /** Steps to a spot (fine units): our object, the client's mover if there is one, and BP_REQ_MOVE */
  stepTo(x: number, y: number, speed: number): void {
    const session = this.live;
    const self = session.world.self!;
    self.x = x;
    self.y = y;
    this.mover?.place(x, y, performance.now());
    session.requestMove(x, y, speed);
  }

  /** Turns to an angle (4096 to the circle), as stepTo does */
  turnTo(angle: number): void {
    const session = this.live;
    session.world.self!.angle = angle;
    this.mover?.setAngle(angle);
    session.requestTurn(angle);
  }

  /** Resolves with the next answer of this kind, or null after `ms` */
  next<K extends keyof Answers>(name: K, ms: number): Promise<Answers[K] | null> {
    return new Promise((resolve) => {
      const w = { name, resolve: (v: unknown) => resolve(v as Answers[K] | null) };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, ms);
    });
  }

  protected answer<K extends keyof Answers>(name: K, v: Answers[K]): void {
    const now = this.waiters.filter((w) => w.name === name);
    this.waiters = this.waiters.filter((w) => w.name !== name);
    for (const w of now) w.resolve(v);
  }

  protected log(kind: EntryKind, text: string, from?: string): void {
    this.journal.add(kind, text, from);
  }

  /** Attaches to a session in the game already (the real client's): its events, and the quest log */
  attach(session: GameSession, mover: MoverHook | null = null): void {
    this.detach();
    this.session = session;
    this.mover = mover;
    this.unwatch.push(session.listen(this.sessionEvents()), this.watchWorld(session));
    session.shardsCommand("quest log");
  }

  detach(): void {
    for (const off of this.unwatch) off();
    this.unwatch = [];
  }

  /** The session's events the body follows */
  protected sessionEvents(): SessionEvents {
    return {
      error: (e) => this.log("error", e),
      chat: (l) => this.onChat(l),
      look: (look) => {
        this.lastLook = look;
        this.log("look", `${look.name}: ${look.description}${look.inscription ? ` | ${look.inscription}` : ""}`);
        this.answer("look", look);
      },
      trade: (t) => {
        this.log("trade", `${this.name(t.seller.nameRes)} ${t.kind === "buy" ? "sells" : "keeps for you"} ${t.items.length} things.`);
        this.answer("trade", t);
      },
      offer: (e) => {
        this.log("trade", `offer: ${e.type}${"items" in e ? ` (${e.items.map((i) => nameOf(this.view, i)).join(", ")})` : ""}`);
        this.answer("offer", e);
      },
      contents: (container, items) => this.answer("contents", { container, items }),
      quest: (e) => this.onQuest(e),
      companion: (e) => this.log("companion", JSON.stringify(e)),
      arena: (s) => this.log("arena", JSON.stringify(s)),
      travel: (e) => this.log("travel", e.type === "list" ? `Portal: ${e.places.map((p) => `${p.id} ${p.name}`).join(", ")}${e.pvpSeconds ? ` (PvP lockout ${e.pvpSeconds} s)` : ""}` : `PvP lockout ${e.seconds} s`),
      damageDealt: (hit) => this.log("combat", `You hit ${hit.name} for ${hit.damage}.`),
      training: (list) => this.answer("training", list),
    };
  }

  /** The world's events the body follows; a function that stops it */
  protected watchWorld(session: GameSession): () => void {
    return session.world.on((e: WorldEvent) => {
      if (e.type === "player" && e.roomChanged) {
        this.target = null;
        this.enteredAt = Date.now();
        this.log("room", `Entered ${roomName(this.view)}.`);
        if (this.roomFile === UNDERWORLD) this.log("health", "You died: you're in the Underworld.");
      } else if (e.type === "stats" && e.group === 1) this.onHealth();
      else if (e.type === "objectRemoved" && e.id === this.target) {
        this.log("combat", "Your target is gone (dead, or it left).");
        this.target = null;
      } else if (e.type === "selfMoved" && Date.now() - this.enteredAt > ARRIVAL_MS) this.log("self", "The server moved you back (a blocked step).");
      else if (e.type === "wait") this.log("server", e.waiting ? "The server is saving: wait." : "The server finished saving.");
      else if (e.type === "idsStale") this.target = null;
    });
  }

  private onChat(l: ChatLine): void {
    const text = l.spans.map((s) => s.text).join("");
    // Our own words come back: the tools have noted them already
    if (l.sender && l.sender.id === this.session?.world.player?.id) return;
    if (l.sender && l.kind === "say") {
      const how = l.sayType !== undefined ? SAY_NAMES[l.sayType] : undefined;
      // NPCs speak too; only players are in the online list
      const npc = !this.session?.world.players.has(l.sender.id);
      return this.log("chat", how ? `(${how}) ${text}` : text, npc ? `${l.sender.name} (npc)` : l.sender.name);
    }
    this.log(l.channel === "combat" ? "combat" : "server", text);
  }

  private onQuest(e: QuestEvent): void {
    const qname = (id: number) => this.data.catalog.quests.find((q) => q.id === id)?.name ?? `quest ${id}`;
    if (e.type === "offers") {
      const npc = this.session?.world.objects.get(e.npc);
      const who = npc ? nameOf(this.view, npc.info) : `object ${e.npc}`;
      this.log("quest", e.offers.length ? `${who} has: ${e.offers.map((o) => `[${o.id}] ${qname(o.id)} (${OFFER_STATE[o.state] ?? o.state}, step ${o.step})`).join("; ")}` : `${who} has no quests for you.`);
      this.answer("offers", e);
    } else if (e.type === "log") {
      this.questLog = { active: e.active, done: e.done };
      this.answer("questLog", e);
    } else if (e.type === "progress") {
      const q = this.data.catalog.quests.find((x) => x.id === e.id);
      const step = q?.steps[e.step - 1];
      this.log("quest", `${qname(e.id)} step ${e.step}: ${step ? `${step.objective} ${Math.min(e.count, step.count)}/${step.count}` : `count ${e.count}`}`);
      const active = this.questLog?.active.find((a) => a.id === e.id);
      if (active) Object.assign(active, { step: e.step, count: e.count });
    } else if (e.type === "signets") this.log("quest", `Signet rings carried: ${e.rings.map((r) => `${r.owner}'s (${r.room || "nowhere"})`).join(", ") || "none"}`);
  }

  private onHealth(): void {
    if (!this.session) return;
    const hp = health(this.session.world);
    if (!hp || !hp.max) return;
    const pct = Math.round((hp.value / hp.max) * 100);
    // Only crossings worth knowing: below half, below a fifth, and back to full
    for (const mark of [50, 20]) if (pct < mark && this.lastHealthPct >= mark) this.log("health", `Health ${hp.value}/${hp.max}: below ${mark}%.`);
    if (pct >= 100 && this.lastHealthPct < 100) this.log("health", `Health back to full (${hp.max}).`);
    this.lastHealthPct = pct;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
