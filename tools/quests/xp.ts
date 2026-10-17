// Experience and health (docs/adr/0009-quests.md 8). On our server XP buys health: the next point
// of base health past h costs (h+1)^2 (System.CalculateXPTable), and Player.AddXP gives the point
// once the total passes it. A kill is worth about the monster's viLevel, but only while the
// player's base health is below that level (Player.KilledSomething).

/** XP for the next point of health past h */
export const xpToNext = (h: number): number => (h + 1) * (h + 1);

/** XP to go from health a to health b */
export function xpBetween(a: number, b: number): number {
  let sum = 0;
  for (let h = a; h < b; h++) sum += xpToNext(h);
  return sum;
}

/** A third of levelling comes from quests (decided 2026-10-17) */
export const QUEST_SHARE = 1 / 3;

/** XP worth this many points of health to a player at health h (a quest's band minimum) */
export const xpForPoints = (points: number, h: number): number => Math.round(points * xpToNext(h));
