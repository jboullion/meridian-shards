// Typed commands (module/merintr/merintr.c `commands`, command.c, clientd3d/parse.c,
// alias.c, groups.c): what a line typed into the chat box means.
//
// The original treats every line as a command: "s hi" says hi (the shortest unique start of
// a command will do), a line that matches nothing is "What?", and saying something needs
// "say". We keep that for lines starting with "/", and everywhere with the Original Command
// Typing option. Otherwise (our default) a line is said aloud unless its first word is
// exactly a command, and commands that take no words only count when typed alone, so
// "drop it!" is still said.

/** The original's command handlers (command.c Command*). */
export type CommandId =
  | "say" | "broadcast" | "emote" | "who" | "quit" | "tell" | "hel" | "help" | "use" | "get" | "addgroup" | "put"
  | "delgroup" | "newgroup" | "buy" | "drop" | "look" | "offer" | "cast" | "map" | "wave" | "point" | "dance"
  | "alias" | "cmdalias" | "rest" | "yell" | "stand" | "suicid" | "suicide" | "neutral" | "happy" | "sad" | "wry"
  | "guild" | "password" | "withdraw" | "deposit" | "balance" | "group" | "appeal" | "tellguild"
  | "safetyOn" | "safetyOff" | "tempsafeOn" | "tempsafeOff" | "groupingOn" | "groupingOff" | "autolootOn"
  | "autolootOff" | "autocombineOn" | "autocombineOff" | "reagentbagOn" | "reagentbagOff" | "spellpowerOn"
  | "spellpowerOff" | "time" | "mail";

/** merintr.c `commands`, in its order (ties go to the first), with the German names. */
export const COMMAND_TABLE: readonly (readonly [string, CommandId])[] = [
  ["say", "say"], ["sagen", "say"], ["broadcast", "broadcast"], ["mitteilen", "broadcast"], ["emote", "emote"], ["ego", "emote"],
  ["who", "who"], ["wer", "who"], ["quit", "quit"], ["beenden", "quit"], ["tell", "tell"], ["telepathie", "tell"],
  ["hel", "hel"], ["hilf", "hel"], ["help", "help"], ["hilfe", "help"], ["use", "use"], ["benutzen", "use"], ["get", "get"],
  ["addgroup", "addgroup"], ["gruppehinzu", "addgroup"], ["agroup", "addgroup"], ["gruppeneu", "addgroup"], ["put", "put"],
  ["ablegen", "put"], ["delgroup", "delgroup"], ["gruppelöschen", "delgroup"], ["dgroup", "delgroup"], ["newgroup", "newgroup"],
  ["neuegruppe", "newgroup"], ["ngroup", "newgroup"], ["buy", "buy"], ["kaufen", "buy"], ["drop", "drop"], ["wegwerfen", "drop"],
  ["nehmen", "get"], ["look", "look"], ["schauen", "look"], ["offer", "offer"], ["anbieten", "offer"], ["cast", "cast"],
  ["zaubern", "cast"], ["map", "map"], ["karte", "map"], ["wave", "wave"], ["winken", "wave"], ["point", "point"],
  ["deuten", "point"], ["dance", "dance"], ["tanzen", "dance"], ["alias", "alias"], ["befehle", "alias"], ["cmdalias", "cmdalias"],
  ["kurzbefehle", "cmdalias"], ["rest", "rest"], ["rasten", "rest"], ["yell", "yell"], ["rufen", "yell"], ["stand", "stand"],
  ["aufstehen", "stand"], ["suicid", "suicid"], ["haraki", "suicid"], ["suicide", "suicide"], ["harakiri", "suicide"],
  ["neutral", "neutral"], ["happy", "happy"], ["glücklich", "happy"], ["sad", "sad"], ["traurig", "sad"], ["wry", "wry"],
  ["grimmig", "wry"], ["guild", "guild"], ["gilde", "guild"], ["password", "password"], ["passwort", "password"],
  ["withdraw", "withdraw"], ["abheben", "withdraw"], ["deposit", "deposit"], ["einzahlen", "deposit"], ["balance", "balance"],
  ["kontostand", "balance"], ["group", "group"], ["gruppen", "group"], ["appeal", "appeal"], ["aufrufen", "appeal"],
  ["tellguild", "tellguild"], ["telgilde", "tellguild"], ["tguild", "tellguild"], ["tgilde", "tellguild"],
  ["safety on", "safetyOn"], ["sicherheit an", "safetyOn"], ["safety off", "safetyOff"], ["sicherheit aus", "safetyOff"],
  ["tempsafe on", "tempsafeOn"], ["tempsicherheit an", "tempsafeOn"], ["tempsafe off", "tempsafeOff"],
  ["tempsicherheit aus", "tempsafeOff"], ["grouping on", "groupingOn"], ["gruppenbildung an", "groupingOn"],
  ["grouping off", "groupingOff"], ["gruppenbildung aus", "groupingOff"], ["autoloot on", "autolootOn"],
  ["autoloot an", "autolootOn"], ["autoloot off", "autolootOff"], ["autoloot aus", "autolootOff"],
  ["autocombine on", "autocombineOn"], ["autocombine an", "autocombineOn"], ["autocombine off", "autocombineOff"],
  ["autocombine aus", "autocombineOff"], ["reagentbag on", "reagentbagOn"], ["reagentbag an", "reagentbagOn"],
  ["reagentbag off", "reagentbagOff"], ["reagentbag aus", "reagentbagOff"], ["spellpower on", "spellpowerOn"],
  ["spellpower an", "spellpowerOn"], ["spellpower off", "spellpowerOff"], ["spellpower aus", "spellpowerOff"],
  ["time", "time"], ["Zeit", "time"],
  // module/mailnews adds its own command (mailnews.c)
  ["mail", "mail"],
];

/** Ours, on top: shorthands players are used to. */
const EXTRA_WORDS: Record<string, CommandId> = { em: "emote", bc: "broadcast", t: "tell", pickup: "get" };

/** Commands whose words after the name mean something; the others only count typed alone (our default). */
const TAKES_WORDS = new Set<CommandId>([
  "say", "broadcast", "emote", "yell", "tell", "tellguild", "appeal", "cast", "addgroup", "delgroup", "newgroup", "alias",
  "cmdalias", "deposit", "withdraw",
]);

export interface ParsedCommand {
  id: CommandId;
  /** The words after the command name, spaces trimmed from the front */
  args: string;
}

/**
 * parse.c ParseCommand: the command whose name the line starts with. A whole name wins at
 * once; otherwise the longest shared start of the line's first word (ties go to the first
 * in the table). A word longer than a name doesn't match it. The arguments start after
 * the line's first word, even for two-word names ("safety on").
 */
export function parseCommand(line: string, table: readonly (readonly [string, CommandId])[] = COMMAND_TABLE): ParsedCommand | null {
  const str = line.replace(/^ +/, "");
  let best = -1;
  let maxMatch = 0;
  for (let index = 0; index < table.length; index++) {
    const name = table[index][0];
    let i = 0;
    let match = 0;
    while (i < str.length && i < name.length) {
      // stop comparing at the end of the typed word
      if (str[i] === " " && name[i] !== " ") break;
      if (str[i].toUpperCase() !== name[i].toUpperCase()) {
        match = 0;
        break;
      }
      match++;
      i++;
    }
    if (i === name.length) {
      // the whole name: exact if the typed word ends here too
      if (i === str.length || str[i] === " ") {
        best = index;
        maxMatch = 1;
        break;
      }
      continue;
    }
    if (match > maxMatch) {
      maxMatch = match;
      best = index;
    }
  }
  if (maxMatch === 0 || best < 0) return null;
  const word = /^\S*/.exec(str)![0];
  return { id: table[best][1], args: str.slice(word.length).replace(/^ +/, "") };
}

/** What a typed line comes to. */
export type TypedLine =
  | { kind: "command"; id: CommandId; args: string }
  | { kind: "say"; text: string }
  /** A command alias to run instead (alias.c ParseVerbAlias), or an ambiguous alias */
  | { kind: "alias"; line: string }
  | { kind: "ambiguousAlias" }
  /** parse.c IDS_BADCOMMAND */
  | { kind: "bad" };

export const BAD_COMMAND = "What?  (Press F1 or '?' for help.)";

/**
 * alias.c ParseVerbAlias: an alias whose verb starts with the line's first word (a whole
 * verb wins); "~~" in it is replaced with the rest of the line. `prefix` false asks for
 * the whole verb (our default, so chat words don't run aliases).
 */
export function matchAlias(aliases: Record<string, string>, line: string, prefix: boolean): TypedLine | null {
  const t = line.trim();
  const verb = /^\S+/.exec(t)?.[0];
  if (!verb) return null;
  const args = t.slice(verb.length).replace(/^[ \t]+/, "");
  const v = verb.toLowerCase();
  let found: string | null = null;
  let tie = false;
  for (const name of Object.keys(aliases)) {
    const n = name.toLowerCase();
    if (n === v) {
      found = name;
      tie = false;
      break;
    }
    if (prefix && n.startsWith(v)) {
      if (found !== null) tie = true;
      found = name;
    }
  }
  if (found === null) return null;
  if (tie) return { kind: "ambiguousAlias" };
  const text = aliases[found];
  const at = text.indexOf("~~");
  return { kind: "alias", line: at < 0 ? text : text.slice(0, at) + args + text.slice(at + 2) };
}

/**
 * What a line means: our ":" emote and shorthands, then the command table, then command
 * aliases, then (our default, without a "/") speech. `original` is the Original Command
 * Typing option: every line is a command, as in the original.
 */
export function interpretLine(line: string, aliases: Record<string, string>, original: boolean): TypedLine | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith(":")) return t.slice(1).trim() ? { kind: "command", id: "emote", args: t.slice(1).trim() } : null;
  const slash = t.startsWith("/");
  const body = slash ? t.slice(1).trim() : t;
  if (!body) return null;
  const first = /^\S+/.exec(body)![0];
  const rest = body.slice(first.length).replace(/^ +/, "");
  const extra = EXTRA_WORDS[first.toLowerCase()];
  if (original || slash) {
    if (extra) return { kind: "command", id: extra, args: rest };
    const c = parseCommand(body);
    if (c) return { kind: "command", ...c };
    return matchAlias(aliases, body, true) ?? { kind: "bad" };
  }
  // Our default: the first word (or two) exactly a command's name
  const words = body.split(/\s+/);
  const two = words.length >= 2 ? `${words[0]} ${words[1]}`.toLowerCase() : "";
  const byName = (name: string) => COMMAND_TABLE.find(([n]) => n.toLowerCase() === name)?.[1];
  const twoId = two ? byName(two) : undefined;
  if (twoId && words.length === 2) return { kind: "command", id: twoId, args: words[1] };
  const id = byName(first.toLowerCase()) ?? extra;
  if (id && (TAKES_WORDS.has(id) || !rest)) return { kind: "command", id, args: rest };
  return matchAlias(aliases, body, false) ?? { kind: "say", text: t };
}

// ---------------------------------------------------------------- names, groups and spells

/**
 * mermain.c GetPlayerName, repeatedly: the names in a line, each quoted ("Sir Bob") or one
 * word, separated by spaces or commas.
 */
export function splitNames(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"?|([^\s,"]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2]);
  return out.filter(Boolean);
}

/** groups.c FindGroupByName: a whole group name, or the only one starting with `name`. */
export function findGroup(groups: Record<string, string[]>, name: string): string | "none" | "ambiguous" {
  const n = name.toLowerCase();
  const names = Object.keys(groups);
  const exact = names.find((g) => g.toLowerCase() === n);
  if (exact) return exact;
  const prefixed = names.filter((g) => g.toLowerCase().startsWith(n));
  return prefixed.length === 1 ? prefixed[0] : prefixed.length ? "ambiguous" : "none";
}

/** groups.h MAX_NUMGROUPS, MAX_GROUPSIZE, MAX_GROUPNAME */
export const MAX_GROUPS = 30;
export const MAX_GROUP_SIZE = 100;
export const MAX_GROUP_NAME = 10;

/** The result of a group command: the groups after it (unchanged if null) and what to tell the player. */
export interface GroupResult {
  groups: Record<string, string[]> | null;
  messages: string[];
}

const groupError = (r: "none" | "ambiguous"): string =>
  r === "none" ? "There is no group matching that name." : "That group name is ambiguous.";

/** command.c CommandGroupNew / groups.c GroupNew */
export function groupNew(groups: Record<string, string[]>, args: string): GroupResult {
  const name = splitNames(args)[0];
  if (!name) return { groups: null, messages: listGroups(groups) };
  if (Object.keys(groups).length >= MAX_GROUPS) return { groups: null, messages: ["You can't make more groups; delete some first."] };
  if (Object.keys(groups).some((g) => g.toLowerCase() === name.toLowerCase())) return { groups: null, messages: ["There is already a group with that name."] };
  return { groups: { ...groups, [name.slice(0, MAX_GROUP_NAME)]: [] }, messages: ["Group created."] };
}

/** command.c CommandGroupAdd / groups.c GroupAdd: the group's members with no names */
export function groupAdd(groups: Record<string, string[]>, args: string, online: (name: string) => boolean): GroupResult {
  const [name, ...names] = splitNames(args);
  if (!name) return { groups: null, messages: listGroups(groups) };
  const g = findGroup(groups, name);
  if (g === "none" || g === "ambiguous") return { groups: null, messages: [groupError(g)] };
  if (!names.length) return { groups: null, messages: listMembers(g, groups[g], online) };
  const members = [...groups[g]];
  const messages: string[] = [];
  let added = 0;
  for (const n of names) {
    if (members.length >= MAX_GROUP_SIZE) {
      messages.push(`The ${g} group is full.`);
      break;
    }
    if (members.some((m) => m.toLowerCase() === n.toLowerCase())) continue;
    members.push(n);
    added++;
  }
  if (added) messages.push(`Added ${added} names to group.`);
  return { groups: { ...groups, [g]: members }, messages };
}

/** command.c CommandGroupDelete: the whole group, or names from it */
export function groupDelete(groups: Record<string, string[]>, args: string): GroupResult {
  const [name, ...names] = splitNames(args);
  if (!name) return { groups: null, messages: listGroups(groups) };
  const g = findGroup(groups, name);
  if (g === "none" || g === "ambiguous") return { groups: null, messages: [groupError(g)] };
  if (!names.length) {
    const next = { ...groups };
    delete next[g];
    return { groups: next, messages: ["Group deleted."] };
  }
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const members = groups[g].filter((m) => !lower.has(m.toLowerCase()));
  return { groups: { ...groups, [g]: members }, messages: [`Removed ${groups[g].length - members.length} names from group.`] };
}

/** groups.c GroupsPrint */
export function listGroups(groups: Record<string, string[]>): string[] {
  const names = Object.keys(groups);
  return names.length ? ["You have these groups defined:", names.join(", ")] : ["You have no groups defined."];
}

/** groups.c GroupPrint (the original marks who's on in red; we say so) */
function listMembers(name: string, members: string[], online: (name: string) => boolean): string[] {
  return [`Members of the ${name} group (* = logged on):`, members.map((m) => (online(m) ? `${m}*` : m)).join(", ")];
}

/**
 * command.c CommandTell: a logged-on player by their whole name, then a group by its whole
 * name, then a player by the start of their name, then a group by the start of its name.
 */
export function resolveTell(
  args: string,
  players: readonly { id: number; name: string }[],
  groups: Record<string, string[]>,
): { ids: number[]; text: string } | { error: string } | null {
  let rest = args.trim();
  if (!rest) return null;
  let name: string;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    name = rest.slice(1, end < 0 ? undefined : end);
    rest = end < 0 ? "" : rest.slice(end + 1);
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
  if (!text) return null;
  const n = name.toLowerCase();
  const toGroup = (g: string) => {
    const ids = [...new Set(groups[g].map((m) => players.find((p) => p.name.toLowerCase() === m.toLowerCase())?.id).filter((id): id is number => id !== undefined))];
    return ids.length ? { ids, text } : { error: "No one from that group is currently logged in." };
  };
  const exact = players.find((p) => p.name.toLowerCase() === n);
  if (exact) return { ids: [exact.id], text };
  const exactGroup = Object.keys(groups).find((g) => g.toLowerCase() === n);
  if (exactGroup) return toGroup(exactGroup);
  const prefixed = players.filter((p) => p.name.toLowerCase().startsWith(n));
  if (prefixed.length === 1) return { ids: [prefixed[0].id], text };
  const g = findGroup(groups, name);
  if (g === "ambiguous") return { error: "That group name is ambiguous." };
  if (g !== "none") return toGroup(g);
  return { error: prefixed.length > 1 ? "That name is ambiguous." : "No one with that name is logged on." };
}

/**
 * spells.c FindSpellByName: a spell by its whole name or the only one starting with what
 * was typed (spell names have spaces, so the whole argument is the name).
 */
export function findSpell<T extends { name: string }>(spells: readonly T[], typed: string): T | "none" | "ambiguous" {
  const n = typed.trim().replace(/^"|"$/g, "").toLowerCase();
  const exact = spells.find((s) => s.name.toLowerCase() === n);
  if (exact) return exact;
  const prefixed = spells.filter((s) => s.name.toLowerCase().startsWith(n));
  return prefixed.length === 1 ? prefixed[0] : prefixed.length ? "ambiguous" : "none";
}

/**
 * alias.c CommandAliasCommon: "alias word command" defines a command alias, "alias word"
 * removes it. (The original keeps a "=" after the word as part of the command; we drop it,
 * so "alias go = say hi" works as it reads.)
 */
export function defineAlias(aliases: Record<string, string>, args: string): { aliases: Record<string, string>; message: string } {
  const m = /^\s*([^\s=]+)[\s=]*(.*)$/.exec(args)!;
  const verb = m[1].toLowerCase();
  const text = m[2].trim();
  const next = { ...aliases };
  if (text) {
    next[verb] = text;
    return { aliases: next, message: "Command Alias defined." };
  }
  delete next[verb];
  return { aliases: next, message: "Command Alias removed." };
}

// ---------------------------------------------------------------- outgoing text

/** say.c MAX_SPACES, MAX_CODERUN, MAX_CODES */
const MAX_SPACES = 10;
const MAX_CODERUN = 4;
const MAX_CODES = 20;

/**
 * say.c FilterSayMessage (after its profanity check): control characters go, and so do
 * spaces and colour codes ("~" or "`" and the next character) past 10 in a row, codes past
 * 4 in a row, and codes past 20 in all. Returns what's left to send, or null for nothing.
 */
export function filterSayMessage(text: string): string | null {
  let s = "";
  for (const ch of text) if (ch.charCodeAt(0) & ~0x1f) s += ch;
  let out = "";
  let spaces = 0;
  let coderun = 0;
  let codes = 0;
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    const code = ch === "~" || ch === "`";
    if (ch === " " || code) {
      spaces++;
      if (code) {
        coderun++;
        codes++;
      }
    } else {
      spaces = 0;
      coderun = 0;
    }
    const keep = spaces < MAX_SPACES && coderun < MAX_CODERUN && (!code || codes < MAX_CODES);
    const len = code ? Math.min(2, s.length - i) : 1;
    if (keep) out += s.slice(i, i + len);
    i += len;
  }
  return out.trim() ? out : null;
}
