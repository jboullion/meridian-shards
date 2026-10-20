// The game tools' work (docs/adr/0020-ai-playtester.md), apart from their MCP schemas: each takes
// the body and the tool's arguments (checked by server.ts) and answers in text. No Node APIs, so the
// same handlers run in Node for the headless body and in the page for the browser body (inpage.ts).

import { squareOf } from "../../packages/world/src/index.ts";
import * as act from "./actions.ts";
import type { Body } from "./body.ts";
import { angleTo, inventoryText, OF, questLogText, questText, roomName, roomText, spellsText, statusText } from "./describe.ts";
import { entryLine, type Entry, type EntryKind } from "./journal.ts";
import { takeExit, travelTo, walkTo, walkToObject } from "./walker.ts";

/** Where we are and what just happened, for the tools that run in Node (reports, test helpers) */
export interface PlayContext {
  inGame: boolean;
  character: string;
  room: string;
  square: string;
  playerId: number;
  row: number;
  col: number;
  journal: Entry[];
}

// The arguments as server.ts's schemas check them
type Args = Record<string, unknown>;
const n = (v: unknown) => v as number;
const nOpt = (v: unknown) => v as number | undefined;
const str = (v: unknown) => v as string;

const COMPASS_ANGLE: Record<string, number> = { E: 0, SE: 512, S: 1024, SW: 1536, W: 2048, NW: 2560, N: 3072, NE: 3584 };

export const PLAY: Record<string, (body: Body, a: Args) => string | Promise<string>> = {
  status: (body) => {
    body.mustBeIn();
    return `${statusText(body.view, body.target)}\nJournal: next event is #${body.journal.head}.`;
  },
  look_around: (body, a) => {
    body.mustBeIn();
    return roomText(body.view, nOpt(a.radius));
  },
  wait_events: async (body, a) => {
    const from = nOpt(a.since) ?? body.cursor;
    const found = await body.journal.wait(from, (nOpt(a.wait_seconds) ?? 20) * 1000, (a.kinds as EntryKind[] | undefined) ?? []);
    body.cursor = Math.max(body.cursor, body.journal.head);
    const lines = found.map(entryLine);
    return `${lines.length ? lines.join("\n") : "Nothing happened."}\n(next: since ${body.journal.head}${body.inGame ? "" : "; not in the game"})`;
  },
  walk_to: async (body, a) => (await walkTo(body, n(a.row), n(a.col))).text,
  walk_to_object: async (body, a) => (await walkToObject(body, n(a.id), nOpt(a.within))).text,
  take_exit: async (body, a) => (await takeExit(body, str(a.to))).text,
  travel_to: async (body, a) => (await travelTo(body, str(a.room))).text,
  face: (body, a) => {
    const session = body.live;
    const self = session.world.self!;
    let angle: number;
    if (a.id !== undefined) {
      const o = session.world.objects.get(n(a.id));
      if (!o) throw new Error(`Object ${n(a.id)} isn't here.`);
      angle = angleTo(o.x - self.x, o.y - self.y);
    } else if (a.direction) angle = COMPASS_ANGLE[str(a.direction)]!;
    else throw new Error("Give an id or a direction.");
    body.turnTo(angle);
    return "Turned.";
  },
  say: (body, a) => act.say(body, str(a.text), (a.how as "say" | "yell" | "emote" | "broadcast" | undefined) ?? "say"),
  tell: (body, a) => act.tell(body, str(a.name), str(a.text)),
  who: (body) => act.who(body),
  emote: (body, a) => act.emote(body, a.emote as act.Emote),
  examine: (body, a) => act.examine(body, n(a.id)),
  talk: (body, a) => act.talk(body, n(a.id)),
  quest: async (body, a) => {
    const said = await act.quest(body, a.action as "accept" | "turnin" | "abandon" | "offers" | "log", nOpt(a.id));
    return `${said}${said ? "\n\n" : ""}Quest log:\n${questLogText(body.questLog, body.data.catalog)}`;
  },
  quest_info: (body, a) => questText(body.data.catalog, n(a.id)),
  fight: (body, a) => {
    const foe = nOpt(a.id) ?? act.nearest(body, (o) => (o.info.flags & OF.ATTACKABLE) !== 0 && (o.info.flags & OF.PLAYER) === 0)?.id;
    if (foe === undefined) throw new Error("No monster here.");
    return act.fight(body, foe, nOpt(a.max_seconds) ?? 30, nOpt(a.flee_below) ?? 30);
  },
  cast: (body, a) => act.cast(body, str(a.spell), nOpt(a.target)),
  spells: (body) => spellsText(body.view),
  rest: (body, a) => act.rest(body, a.on as boolean),
  inventory: (body) => inventoryText(body.view),
  get: (body, a) => act.get(body, n(a.id)),
  item: (body, a) => act.itemVerb(body, a.action as "use" | "unuse" | "drop", str(a.item), nOpt(a.amount)),
  shop: (body, a) => act.shop(body, n(a.id)),
  buy: (body, a) => act.buy(body, a.items as { item: number; amount?: number }[]),
  sell: (body, a) => act.sell(body, n(a.to), a.items as string[], a.accept as boolean),
  train: (body, a) => act.train(body, a.ability as string | undefined, nOpt(a.amount)),
  bank: (body, a) => act.bank(body, a.action as "balance" | "deposit" | "withdraw", nOpt(a.amount)),
  vault: (body, a) => act.vault(body, a.action as "list" | "withdraw" | "deposit", (a.items as act.Pick[] | undefined) ?? [], nOpt(a.banker)),
  container: (body, a) => act.container(body, n(a.id), a.action as "look" | "take" | "put", (a.items as act.Pick[] | undefined) ?? []),
  command: async (body, a) => {
    const seq = body.journal.head;
    body.live.shardsCommand(str(a.line));
    await new Promise((r) => setTimeout(r, 1000));
    return `Sent.\n${act.since(body, seq)}`;
  },
};

/** Where we are and what just happened (for reports and the test helpers) */
export function context(body: Body): PlayContext {
  const self = body.session?.world.self;
  const [row, col] = self ? squareOf(self) : [0, 0];
  return {
    inGame: body.inGame,
    character: self ? body.name(self.info.nameRes) : "",
    room: body.inGame ? roomName(body.view) : "(not in the game)",
    square: self ? `row ${row}, col ${col}` : "",
    playerId: body.session?.world.player?.id ?? 0,
    row,
    col,
    journal: body.journal.last(30),
  };
}
