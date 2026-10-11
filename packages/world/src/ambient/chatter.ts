// Ours: what townsfolk say now and then, shown over their heads and never in the chat. A line is
// picked by the place, the hour, the weather and who's speaking. The words are ours.

/** Where someone is: a town, or a castle's or the arena's own */
export type Place =
  | "tos" | "barloque" | "marion" | "jasper" | "cornoth" | "raza" | "kocatan" | "bergen" | "jixa" | "blackstone" | "castle" | "arena";

/** Who's speaking */
export type Role = "folk" | "patron" | "guard" | "knight" | "lady" | "noble" | "fighter" | "mage" | "spectator";

export type Weather = "rain" | "snow" | null;

export interface ChatterContext {
  place?: Place;
  role: Role;
  hour: number | null;
  weather: Weather;
  /** Speaking to the player, as they pass */
  greeting?: boolean;
  /** The player's armour caught their eye */
  impressed?: boolean;
  /** The last one standing in the arena */
  won?: boolean;
  /** Beaten in the arena, and watching from the stands */
  lost?: boolean;
}

const ANY = [
  "Fine weather today.",
  "Have you heard about the rats in the cellar?",
  "Prices keep going up.",
  "My cousin swears he saw a dragon.",
  "Don't trust anything that sells cheap.",
  "I've a mind to try my luck adventuring.",
  "The roads aren't safe after dark.",
  "Someone's been at my garden again.",
  "I could do with a pint.",
  "Mind your purse in a crowd.",
  "They say the old mines are haunted.",
  "Business is slow this week.",
  "Have you seen my dog?",
  "Too many sword-swingers about lately.",
];
const MORNING = ["Up early, are we?", "Market opens soon.", "Morning already. Where does it go?", "Fresh bread, if you hurry."];
const EVENING = ["Long day.", "Time I was home.", "The inn will be busy tonight.", "Supper's waiting."];
const NIGHT = ["Shouldn't be out this late.", "Keep to the lit streets.", "Did you hear that?", "Can't sleep either?"];
const RAIN = ["Soaked through!", "This rain won't let up.", "Good for the crops, I suppose.", "Should have brought a hood.", "Puddles everywhere."];
const SNOW = ["Cold enough for you?", "My fingers are numb.", "Snow again!", "Mind the ice.", "I can't feel my toes."];
const GREET = ["Good day to you.", "Well met.", "Safe travels.", "Afternoon.", "Mind how you go.", "Hello there."];
const GREET_NIGHT = ["Evening.", "Late to be about.", "Good evening to you."];
const WON = ["Victory!", "Is there no one else?", "Kraanan smiles on me!", "Who's next?", "Too easy!", "Ha! Undefeated!"];
const LOST = ["Next time.", "I'll be back.", "Well fought.", "Ow.", "I slipped!", "Lucky blow."];
const IMPRESSED = ["Fine armour, that.", "Must weigh a ton.", "Look at that gear!", "You've seen a fight or two.", "Wish I could afford that."];
const SCATTER = ["Run!", "Magic! Get back!", "Mind the fire!", "Not again!", "Help!", "Watch it!"];

const BY_PLACE: Partial<Record<Place, string[]>> = {
  tos: ["Tos never sleeps.", "The Princess was seen in town.", "The arena's loud today.", "Busy at the smithy."],
  barloque: ["The Duke's men are everywhere.", "Ships in from the south.", "Long live the Duke!", "The market's packed."],
  marion: ["Lovely day by the river.", "The healer's been busy.", "Quiet, Marion. I like it."],
  jasper: ["Watch the bank, they say.", "Jasper's grown so.", "Mind the sewers' smell."],
  cornoth: ["The university's taking students.", "Have you seen the museum?", "Cor Noth was a fine place once."],
  raza: ["Spooky, the crypt.", "Raza's quiet. Too quiet.", "The forest creeps closer every year."],
  kocatan: ["Hot again.", "The jungle never stops growing.", "Ko'catan's not for the soft."],
  bergen: ["Cold up here, always.", "The mountains are restless.", "Bergensdorf builds 'em tough."],
  jixa: ["Strange folk come through Jixa.", "Mind the desert."],
  blackstone: ["Long live the Duke!", "Keep your blade sharp.", "The rebels won't dare come here.", "Stand straight, the Duke may pass."],
  castle: ["The Princess is in good spirits.", "Have you read the new chronicle?", "Long live the Princess!", "The library's open to scholars."],
  arena: ["Kraanan guide your blade!", "Did you see that blow?", "My money's on the tall one.", "Another bout!", "What a fight!"],
};
const BY_ROLE: Partial<Record<Role, string[]>> = {
  patron: ["Another round!", "Who's buying?", "This ale is watered.", "Heard a good song last night.", "Pull up a stool."],
  guard: ["Move along.", "Keep the peace.", "All quiet.", "Nothing to see here."],
  knight: ["For the crown!", "Steel and honour.", "Ready for the field.", "Drills at dawn."],
  lady: ["Such a lovely gown.", "Have you heard the news from court?", "The banquet was divine."],
  noble: ["The taxes are a disgrace.", "Fine day for a hunt.", "My estate needs a steward."],
  fighter: ["Who's next?", "Come on, then!", "Not bad!", "Again!", "Yield?"],
  mage: ["Feel the fire!", "Is that all?", "Shal'ille shield me!", "Faren's fury!", "Dodge this!"],
  spectator: ["Hit him!", "Go on!", "Ooh!", "Kraanan's blessing!", "Did you see that?", "Again! Again!", "Huzzah!"],
};

/** A line to say */
export function chatterLine(rand: () => number, ctx: ChatterContext): string {
  const pick = (l: string[]) => l[Math.floor(rand() * l.length) % l.length];
  const night = ctx.hour !== null && (ctx.hour >= 21 || ctx.hour < 5);
  if (ctx.won) return pick(WON);
  if (ctx.lost) return pick(LOST);
  if (ctx.impressed) return pick(IMPRESSED);
  if (ctx.greeting) return pick(night ? GREET_NIGHT : GREET);
  const pools: [string[], number][] = [];
  const role = BY_ROLE[ctx.role];
  if (role) pools.push([role, ctx.role === "patron" ? 2 : 3]);
  const place = ctx.place ? BY_PLACE[ctx.place] : undefined;
  if (place) pools.push([place, 2]);
  // Indoors, the weather and the hour matter less
  const outside = ctx.role !== "patron";
  if (outside && ctx.weather === "rain") pools.push([RAIN, 4]);
  if (outside && ctx.weather === "snow") pools.push([SNOW, 4]);
  if (ctx.hour !== null) {
    if (ctx.hour >= 5 && ctx.hour < 9) pools.push([MORNING, 1.5]);
    else if (ctx.hour >= 17 && ctx.hour < 21) pools.push([EVENING, 1.5]);
    else if (night && outside) pools.push([NIGHT, 2]);
  }
  if (ctx.role === "folk" || ctx.role === "patron" || ctx.role === "noble") pools.push([ANY, 3]);
  if (!pools.length) pools.push([ANY, 1]);
  const total = pools.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [l, w] of pools) if ((r -= w) < 0) return pick(l);
  return pick(pools[0][0]);
}

/** A cry as they run from a spell */
export function scatterLine(rand: () => number): string {
  return SCATTER[Math.floor(rand() * SCATTER.length) % SCATTER.length];
}
