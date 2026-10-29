// What the agent does besides walking (docs/adr/0020-ai-playtester.md): speaking (rate limited),
// looking, talking to NPCs, fighting, casting, items and shops. Each waits for the server's answer
// where there is one and returns it as text, with what the journal caught meanwhile.

import { objId, SAY, STAT_GROUP, UA, UC, type BuyItem, type ObjectInfo } from "../../packages/protocol/src/index.ts";
import { squareOf, trainableAmount, trainCommand } from "../../packages/world/src/index.ts";
import { sleep, type Body } from "./body.ts";
import { angleTo, distanceText, health, nameOf, OF } from "./describe.ts";
import { entryLine, type EntryKind } from "./journal.ts";
import { walkToObject } from "./walker.ts";

const SQ = 1024;
/** One line of speech per this long, and this long at most: the agent mustn't flood the chat */
export const SPEAK_EVERY_MS = 3000;
export const SPEAK_MAX = 200;
/** Melee reach (arena.ts uses 1.5) and a swing a second */
const REACH = 1.4;
const SWING_MS = 1000;

/** The journal's lines from `seq` on, of these kinds, as text ("" for none) */
export function since(body: Body, seq: number, kinds: EntryKind[] = []): string {
  return body.journal
    .since(seq, kinds)
    .map(entryLine)
    .join("\n");
}

/** Waits `ms`, then what the journal caught since `seq` */
async function after(body: Body, seq: number, ms: number): Promise<string> {
  await sleep(ms);
  const s = since(body, seq, ["chat", "server", "quest", "trade", "look", "combat", "room", "error"]);
  return s ? `\nMeanwhile:\n${s}` : "";
}

// ---- speech

let lastSpoke = 0;

function speakable(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) throw new Error("Nothing to say.");
  if (t.length > SPEAK_MAX) throw new Error(`Too long: ${t.length} characters (at most ${SPEAK_MAX}).`);
  const wait = lastSpoke + SPEAK_EVERY_MS - Date.now();
  if (wait > 0) throw new Error(`Speaking too fast: wait ${Math.ceil(wait / 1000)} s.`);
  lastSpoke = Date.now();
  return t;
}

export function say(body: Body, text: string, how: "say" | "yell" | "emote" | "broadcast"): string {
  const session = body.live;
  const t = speakable(text);
  session.say(t, { say: SAY.NORMAL, yell: SAY.YELL, emote: SAY.EMOTE, broadcast: SAY.EVERYONE }[how]);
  body.journal.add("self", `You ${how === "say" ? "said" : how === "yell" ? "yelled" : how === "emote" ? "emoted" : "broadcast"}: ${t}`);
  return "Said.";
}

/** A tell: to a player in the game by name (exact, else the only one starting with it) */
export function tell(body: Body, name: string, text: string): string {
  const session = body.live;
  const w = name.trim().toLowerCase();
  const online = [...session.world.players.values()].map((p) => ({ id: p.id, name: p.name || body.name(p.nameRes) }));
  const exact = online.filter((p) => p.name.toLowerCase() === w);
  const prefix = online.filter((p) => p.name.toLowerCase().startsWith(w));
  const to = exact[0] ?? (prefix.length === 1 ? prefix[0] : undefined);
  if (!to) throw new Error(prefix.length > 1 ? `Several players start with "${name}": ${prefix.map((p) => p.name).join(", ")}.` : `No player "${name}" in the game. Online: ${online.map((p) => p.name).join(", ") || "nobody"}.`);
  const t = speakable(text);
  session.sayTo([to.id], t);
  body.journal.add("self", `You told ${to.name}: ${t}`);
  return `Told ${to.name}.`;
}

export function who(body: Body): string {
  const players = [...body.live.world.players.values()].map((p) => p.name || body.name(p.nameRes)).filter(Boolean);
  return players.length ? `In the game (${players.length}): ${players.sort().join(", ")}.` : "Nobody in the game's list yet.";
}

const EMOTES = { wave: UA.WAVE, point: UA.POINT, dance: UA.DANCE, happy: UA.HAPPY, sad: UA.SAD, wry: UA.WRY, neutral: UA.NORMAL } as const;
export type Emote = keyof typeof EMOTES;
export function emote(body: Body, e: Emote): string {
  body.live.action(EMOTES[e]);
  return `You ${e}.`;
}

// ---- objects

function object(body: Body, id: number) {
  const o = body.live.world.objects.get(id);
  if (!o) throw new Error(`Object ${id} isn't in this room. Use look_around for ids.`);
  return o;
}

export async function examine(body: Body, id: number): Promise<string> {
  const session = body.live;
  const inRoom = session.world.objects.get(id);
  if (!inRoom && !session.world.inventory.get(id)) throw new Error(`Object ${id} is neither in this room nor in your inventory.`);
  const answer = body.next("look", 4000);
  session.look(id);
  const look = await answer;
  if (!look) return "No description came back.";
  return [`${look.name}${look.player ? " (a player)" : ""}`, look.description, look.inscription ? `Written: ${look.inscription}` : "", look.url ? `Web page: ${look.url}` : ""].filter(Boolean).join("\n");
}

/** Activates an object: talking to an NPC (its quests come back), a lever, a portal */
export async function talk(body: Body, id: number): Promise<string> {
  const session = body.live;
  const o = object(body, id);
  const self = session.world.self!;
  if (Math.hypot(o.x - self.x, o.y - self.y) > 3 * SQ) {
    const r = await walkToObject(body, id, 1.5);
    if (!r.ok) return `Couldn't get close: ${r.text}`;
  }
  const seq = body.journal.head;
  body.turnTo(angleTo(o.x - self.x, o.y - self.y));
  session.activate(id);
  await body.next("offers", 2500);
  return `Activated ${nameOf(body.view, o.info)}.${await after(body, seq, 300)}`;
}

/** choice: on the last hand-in of a quest whose reward is a choice, which one (1 on) */
export async function quest(body: Body, verb: "offers" | "accept" | "turnin" | "abandon" | "log", id?: number, choice?: number): Promise<string> {
  const session = body.live;
  const seq = body.journal.head;
  if (verb === "log") {
    const answer = body.next("questLog", 4000);
    session.shardsCommand("quest log");
    await answer;
    return "";
  }
  const words = `${verb}${id !== undefined ? ` ${id}` : ""}${verb === "turnin" && id !== undefined && choice !== undefined ? ` ${choice}` : ""}`;
  session.shardsCommand(`quest ${words}`);
  if (verb !== "offers") {
    // The log comes again after a change
    const log = body.next("questLog", 3000);
    session.shardsCommand("quest log");
    await log;
  }
  return `Sent quest ${words}.${await after(body, seq, 500)}`;
}

/** Fights a creature: walks up, faces it, swings every second until it's gone, we're low, or time's up */
export async function fight(body: Body, id: number, maxSeconds: number, fleeBelowPct: number): Promise<string> {
  const session = body.live;
  const o = object(body, id);
  if (!(o.info.flags & OF.ATTACKABLE)) throw new Error(`${nameOf(body.view, o.info)} isn't something you can attack.`);
  const name = nameOf(body.view, o.info);
  const startRoom = body.roomFile;
  const seq = body.journal.head;
  body.target = id;
  const deadline = Date.now() + maxSeconds * 1000;
  let swings = 0,
    lastSwing = 0,
    outcome = "Time's up.";
  for (;;) {
    if (body.roomFile !== startRoom) {
      outcome = body.roomFile === "uworld.roo" ? "You died." : "You left the room.";
      break;
    }
    const foe = session.world.objects.get(id);
    if (!foe) {
      outcome = `${name} is gone: killed, or it fled.`;
      break;
    }
    const hp = health(session.world);
    if (hp && hp.max && (hp.value / hp.max) * 100 < fleeBelowPct) {
      outcome = `Stopped: your health is ${hp.value}/${hp.max}.`;
      break;
    }
    if (Date.now() > deadline) break;
    const self = session.world.self!;
    if (Math.hypot(foe.x - self.x, foe.y - self.y) > REACH * SQ) {
      const r = await walkToObject(body, id, REACH - 0.2);
      if (!r.ok && session.world.objects.get(id)) {
        outcome = `Couldn't reach it: ${r.text}`;
        break;
      }
      continue;
    }
    if (Date.now() - lastSwing >= SWING_MS) {
      body.turnTo(angleTo(foe.x - self.x, foe.y - self.y));
      session.attack(id);
      lastSwing = Date.now();
      swings++;
    }
    await sleep(200);
  }
  const fightLines = body.journal.since(seq, ["combat"]);
  if (swings >= 5 && !fightLines.length) outcome += " Not one swing got an answer: fighting may not be allowed here (a safe area), or you're held.";
  const hits = fightLines.filter((e) => e.text.startsWith("You hit "));
  const dealt = hits.reduce((s, e) => s + Number(/for (\d+)/.exec(e.text)?.[1] ?? 0), 0);
  const hp = health(session.world);
  const lines = body.journal.since(seq, ["combat", "health", "quest", "room"]).slice(-15).map(entryLine);
  return `${outcome} ${swings} swings, ${hits.length} hits for ${dealt} damage. Health ${hp ? `${hp.value}/${hp.max}` : "?"}.\n${lines.join("\n")}`;
}

/** Casts a spell we know (by name, or the start of one) on a target (or ourselves when it needs one) */
export async function cast(body: Body, spell: string, target?: number): Promise<string> {
  const session = body.live;
  const w = spell.trim().toLowerCase();
  const spells = session.world.spells.map((s) => ({ s, name: body.name(s.object.nameRes) }));
  const found = spells.find((x) => x.name.toLowerCase() === w) ?? spells.find((x) => x.name.toLowerCase().startsWith(w));
  if (!found) throw new Error(`You don't know "${spell}". You know: ${spells.map((x) => x.name).join(", ") || "nothing"}.`);
  const seq = body.journal.head;
  const targets = found.s.numTargets ? [{ id: target ?? session.world.player!.id }] : [];
  if (targets.length && target !== undefined) {
    const t = session.world.objects.get(target);
    const self = session.world.self!;
    if (t) body.turnTo(angleTo(t.x - self.x, t.y - self.y));
  }
  session.cast(found.s.object.id, targets);
  return `Cast ${found.name}${targets.length ? ` on ${targets[0]!.id === session.world.player!.id ? "yourself" : `object ${targets[0]!.id}`}` : ""}.${await after(body, seq, 1200)}`;
}

// ---- items

/** An inventory item by id or name (exact, else the first containing it) */
export function findItem(body: Body, what: string | number): ObjectInfo {
  const inv = [...body.live.world.inventory.values()];
  if (typeof what === "number" || /^\d+$/.test(String(what))) {
    const item = body.live.world.inventory.get(Number(what));
    if (item) return item;
  }
  const w = String(what).trim().toLowerCase();
  const named = inv.map((i) => ({ i, n: body.name(i.nameRes).toLowerCase() }));
  const hit = named.find((x) => x.n === w) ?? named.find((x) => x.n.includes(w));
  if (!hit) throw new Error(`No "${what}" in your inventory.`);
  return hit.i;
}

export async function get(body: Body, id: number): Promise<string> {
  const session = body.live;
  const o = object(body, id);
  if (!(o.info.flags & OF.GETTABLE)) throw new Error(`${nameOf(body.view, o.info)} can't be picked up.`);
  const self = session.world.self!;
  if (Math.hypot(o.x - self.x, o.y - self.y) > 1.5 * SQ) {
    const r = await walkToObject(body, id, 1);
    if (!r.ok) return `Couldn't get close: ${r.text}`;
  }
  const seq = body.journal.head;
  session.pickUp(o.info.id);
  await sleep(800);
  return `${session.world.inventory.get(id) ? "Picked up" : "Tried to pick up"} ${nameOf(body.view, o.info)}.${await after(body, seq, 0)}`;
}

export async function itemVerb(body: Body, verb: "use" | "unuse" | "drop", what: string, amount?: number): Promise<string> {
  const session = body.live;
  const item = findItem(body, what);
  const seq = body.journal.head;
  if (verb === "use") session.use(item.id);
  else if (verb === "unuse") session.unuse(item.id);
  else session.drop(item.id, amount ?? (item.amount > 1 ? item.amount : undefined));
  return `${verb} ${nameOf(body.view, item)}.${await after(body, seq, 800)}`;
}

export function rest(body: Body, on: boolean): string {
  body.live.userCommand(on ? UC.REST : UC.STAND);
  return on ? "You sit down to rest." : "You stand up.";
}

// ---- shops

let lastWares: { seller: number; items: BuyItem[] } | null = null;

/** A shopkeeper's wares (BP_REQ_BUY) */
export async function shop(body: Body, id: number): Promise<string> {
  const session = body.live;
  const o = object(body, id);
  if (!(o.info.flags & OF.BUYABLE)) throw new Error(`${nameOf(body.view, o.info)} doesn't sell anything.`);
  const self = session.world.self!;
  if (Math.hypot(o.x - self.x, o.y - self.y) > 3 * SQ) {
    const r = await walkToObject(body, id, 2);
    if (!r.ok) return `Couldn't get close: ${r.text}`;
  }
  const answer = body.next("trade", 4000);
  session.requestBuy(id);
  const list = await answer;
  if (!list) return "No answer from the shopkeeper.";
  lastWares = { seller: id, items: list.items };
  if (!list.items.length) return `${nameOf(body.view, list.seller)} has nothing to sell.`;
  return [`${nameOf(body.view, list.seller)} sells (item: price):`, ...list.items.map((b, i) => `- ${i + 1}. ${nameOf(body.view, b.object)}: ${b.cost}`)].join("\n");
}

/** Buys from the shop last listed: items by their number in the list, with an amount for stacks */
export async function buy(body: Body, picks: { item: number; amount?: number }[]): Promise<string> {
  const session = body.live;
  if (!lastWares) throw new Error("Use shop on a shopkeeper first.");
  const refs = picks.map((p) => {
    const b = lastWares!.items[p.item - 1];
    if (!b) throw new Error(`No item ${p.item} in the list.`);
    return { id: b.object.id, amount: p.amount ?? 1 };
  });
  const seq = body.journal.head;
  session.buyItems(lastWares.seller, refs);
  return `Asked to buy ${refs.length} kinds of thing.${await after(body, seq, 1200)}`;
}

/** Sells inventory items to someone who buys them: offer, see their counteroffer, accept it (or not) */
export async function sell(body: Body, to: number, what: string[], accept: boolean): Promise<string> {
  const session = body.live;
  const o = object(body, to);
  const items = what.map((w) => findItem(body, w));
  const answer = body.next("offer", 1500);
  session.offerItems(to, items.map((i) => ({ id: i.id, amount: i.amount > 1 ? i.amount : undefined })));
  let e = await answer;
  // BP_OFFERED (our items echoed) first, then their counteroffer
  if (e?.type === "offered") e = await body.next("offer", 4000);
  if (!e || e.type !== "counteroffer") {
    session.cancelOffer();
    return `${nameOf(body.view, o.info)} made no counteroffer${e ? ` (${e.type})` : ""}; cancelled.`;
  }
  const what2 = e.items.map((i) => nameOf(body.view, i)).join(", ") || "nothing";
  if (!accept) {
    session.cancelOffer();
    return `${nameOf(body.view, o.info)} would give ${what2}; you said no (cancelled).`;
  }
  const seq = body.journal.head;
  session.acceptOffer();
  return `Sold for ${what2}.${await after(body, seq, 800)}`;
}

/** Where everything is relative to us, for the nearest of a kind (used by the fight tool's picker) */
export function nearest(body: Body, pred: (o: { info: ObjectInfo }) => boolean): { id: number; text: string } | null {
  const w = body.live.world;
  const self = w.self!;
  let best: { id: number; d: number; text: string } | null = null;
  for (const o of w.objects.values()) {
    if (o.id === self.id || !pred(o)) continue;
    const d = Math.hypot(o.x - self.x, o.y - self.y);
    if (!best || d < best.d) best = { id: o.id, d, text: `${nameOf(body.view, o.info)} [${o.id}] ${distanceText(self, o)}` };
  }
  return best && { id: best.id, text: best.text };
}

export const squareOfSelf = (body: Body): string => {
  const [row, col] = squareOf(body.live.world.self!);
  return `row ${row}, col ${col}`;
};


// ---- training (ours, docs/adr/0016-abilities.md)

/** apps/client/src/game/statRows.ts STAT_NUM.TRAINING: training points, in the Stats group */
const STAT_TRAINING = 8;

/** The spells and skills we know (stat groups 3 and 4) and our training points, as the Train window reads them */
async function trainState(body: Body): Promise<{ abilities: { id: number; name: string; percent: number }[]; points: number }> {
  const session = body.live;
  // The client asks for these when their tabs open; we ask each time, for fresh percents
  for (const g of [STAT_GROUP.STATS, STAT_GROUP.SPELLS, STAT_GROUP.SKILLS]) session.requestStats(g);
  await sleep(800);
  const stats = session.world.stats;
  const abilities = [STAT_GROUP.SPELLS, STAT_GROUP.SKILLS].flatMap((g) =>
    (stats.get(g) ?? []).flatMap((st) => (st.list ? [{ id: objId(st.list.id), name: body.name(st.nameRes), percent: st.list.value }] : [])),
  );
  const points = stats.get(STAT_GROUP.STATS)?.find((st) => st.num === STAT_TRAINING)?.numeric?.value ?? 0;
  return { abilities, points };
}

/**
 * Train: without an ability, what we can train and what 1% costs (UC_TRAINING, after "train list");
 * with one, spend training points to raise it by `amount` percent (UC_SHARDS_OBJECT "train <n>")
 */
export async function train(body: Body, ability?: string, amount?: number): Promise<string> {
  const session = body.live;
  const costsCame = body.next("training", 4000);
  session.shardsCommand("train list");
  const [list, state] = await Promise.all([costsCame, trainState(body)]);
  if (!list) return "The server didn't say what you can train.";
  const cost = new Map(list.map((t) => [t.id, t.cost]));
  const trainable = state.abilities.filter((a) => (cost.get(a.id) ?? 0) > 0);
  if (!ability) {
    if (!trainable.length) return `You have ${state.points} training points and nothing you can train yet.`;
    return [`You have ${state.points} training points. You can train (percent now, points a percent):`, ...trainable.map((a) => `- ${a.name} ${a.percent}% (${cost.get(a.id)} a percent)`)].join("\n");
  }
  const w = ability.trim().toLowerCase();
  const a = trainable.find((x) => x.name.toLowerCase() === w) ?? trainable.find((x) => x.name.toLowerCase().includes(w));
  if (!a) return `You can't train "${ability}". Trainable: ${trainable.map((x) => x.name).join(", ") || "nothing"}.`;
  const price = cost.get(a.id)!;
  const most = trainableAmount(a.percent, price, state.points);
  if (most === 0) return `${a.name} is at ${a.percent}%: it costs ${price} points a percent and you have ${state.points}.`;
  const want = Math.max(1, Math.floor(amount ?? 1));
  const gain = Math.min(want, most);
  const seq = body.journal.head;
  session.shardsObject(a.id, trainCommand(gain));
  await sleep(1000);
  const now = (await trainState(body)).abilities.find((x) => x.id === a.id);
  const said = since(body, seq);
  return `Trained ${a.name} by ${gain}%${gain < want ? " (as far as your points go)" : ""}: ${a.percent}% → ${now?.percent ?? "?"}%.${said ? `\n${said}` : ""}`;
}

// ---- the bank and the vault

/** The banker nearby (someone who takes things, or who keeps a vault), as the client's deposit and withdraw find one */
function banker(body: Body, id: number | undefined, flag: number): number {
  if (id !== undefined) return object(body, id).id;
  const b = nearest(body, (o) => (o.info.flags & flag) !== 0 && (o.info.flags & OF.ATTACKABLE) === 0);
  if (!b) throw new Error("There's no banker here: go to a town's bank (look_around, travel_to).");
  return b.id;
}

/** Money in the bank (command.c CommandDeposit, CommandWithdraw, CommandBalance) */
export async function bank(body: Body, action: "balance" | "deposit" | "withdraw", amount?: number): Promise<string> {
  const session = body.live;
  const seq = body.journal.head;
  if (action === "balance") session.userCommand(UC.BALANCE);
  else {
    if (!amount || amount <= 0) throw new Error(`How many shillings to ${action}?`);
    session.userCommand(action === "deposit" ? UC.DEPOSIT : UC.WITHDRAW, amount);
  }
  return `Asked to ${action}${amount ? ` ${amount}` : ""}.${await after(body, seq, 1200)}`;
}

let lastVault: { banker: number; items: BuyItem[] } | null = null;

export interface Pick {
  item: string | number;
  amount?: number;
}

/** Things kept in the vault: list them (BP_REQ_WITHDRAWAL), take some out by list number, or put inventory items in */
export async function vault(body: Body, action: "list" | "withdraw" | "deposit", picks: Pick[] = [], id?: number): Promise<string> {
  const session = body.live;
  const seq = body.journal.head;
  if (action === "deposit") {
    const who = banker(body, id, OF.OFFERABLE);
    if (!picks.length) throw new Error("Which items to put in the vault?");
    const refs = picks.map((p) => {
      const i = findItem(body, p.item);
      return { id: i.id, amount: i.amount > 1 ? (p.amount ?? i.amount) : undefined };
    });
    session.depositItems(who, refs);
    return `Asked to keep ${refs.length} things in the vault.${await after(body, seq, 1200)}`;
  }
  if (action === "list" || !lastVault) {
    const who = banker(body, id, OF.BUYABLE);
    const answer = body.next("trade", 4000);
    session.requestWithdrawal(who);
    const list = await answer;
    if (!list || list.kind !== "withdraw") return `No vault list came back.${await after(body, seq, 0)}`;
    lastVault = { banker: who, items: list.items };
    if (action === "list")
      return list.items.length ? ["In your vault:", ...list.items.map((b, i) => `- ${i + 1}. ${nameOf(body.view, b.object)}${b.cost ? ` (fee ${b.cost})` : ""}`)].join("\n") : "Your vault is empty.";
  }
  const v = lastVault!;
  if (!picks.length) throw new Error("Which items (by their number in the vault list) to take out?");
  const refs = picks.map((p) => {
    const b = v.items[Number(p.item) - 1];
    if (!b) throw new Error(`No item ${p.item} in the vault list.`);
    return { id: b.object.id, amount: p.amount ?? (b.object.amount > 1 ? b.object.amount : undefined) };
  });
  session.withdrawItems(v.banker, refs);
  return `Asked to take ${refs.length} things out of the vault.${await after(body, seq, 1200)}`;
}

// ---- containers (storage boxes)

/** What's in a container nearby, taking things out (by list number), or putting inventory items in */
export async function container(body: Body, id: number, action: "look" | "take" | "put", picks: Pick[] = []): Promise<string> {
  const session = body.live;
  const box = object(body, id);
  const self = session.world.self!;
  if (Math.hypot(box.x - self.x, box.y - self.y) > 1.5 * SQ) {
    const r = await walkToObject(body, id, 1);
    if (!r.ok) return `Couldn't get close: ${r.text}`;
  }
  const seq = body.journal.head;
  if (action === "put") {
    for (const p of picks) {
      const i = findItem(body, p.item);
      session.put(i.id, i.amount > 1 ? (p.amount ?? i.amount) : undefined, id);
    }
    return `Put ${picks.length} things in.${await after(body, seq, 1000)}`;
  }
  const answer = body.next("contents", 4000);
  session.requestContents(id);
  const got = await answer;
  if (!got) return `${nameOf(body.view, box.info)} showed nothing (not a container you can open?).${await after(body, seq, 0)}`;
  if (action === "look") return got.items.length ? [`In ${nameOf(body.view, box.info)}:`, ...got.items.map((i, n) => `- ${n + 1}. ${nameOf(body.view, i)}`)].join("\n") : `${nameOf(body.view, box.info)} is empty.`;
  for (const p of picks) {
    const i = got.items[Number(p.item) - 1];
    if (!i) throw new Error(`No item ${p.item} in it.`);
    session.getFromContainer(i.id, i.amount > 1 ? (p.amount ?? i.amount) : undefined);
  }
  return `Took ${picks.length} things out.${await after(body, seq, 1000)}`;
}
