// Our client's quest catalogue, dist/assets/quests.json: everything the offer window, the Quests
// tab and the tracker show, by quest id. The server sends only ids and numbers (UC_QUEST_*); its
// UC_QUEST_LOG carries the catalogue's hash, so a client with an old one can say so.

import type { CatalogNpc, CatalogQuest, CatalogRewards } from "../../packages/world/src/quests.ts";
import type { ResolvedGiver, ResolvedNpc, ResolvedQuest, ResolvedRewards } from "./validate.ts";
import type { World } from "./world.ts";

const roomsOf = (w: World, rids: number[]) => rids.map((rid) => ({ rid, name: w.rooms.get(rid) ?? String(rid) }));

const rewardsOf = (r: ResolvedRewards): CatalogRewards => ({
  xp: r.xp,
  shillings: r.shillings,
  trainingPoints: r.trainingPoints,
  items: r.items.map((i) => ({ className: i.cls, name: i.name, count: i.count })),
  oneOf: r.oneOf.map((i) => ({ className: i.cls, name: i.name, count: i.count })),
  special: r.specialText,
});

const npcOf = (w: World, n: ResolvedNpc): CatalogNpc => ({ name: n.name, className: n.cls, placed: n.placed, rooms: roomsOf(w, n.rids) });

/** The catalogue without its hash (the hash is of this) */
export function buildCatalog(quests: ResolvedQuest[], _givers: ResolvedGiver[], w: World): CatalogQuest[] {
  return quests.map((q) => ({
    id: q.id,
    key: q.key,
    name: q.name,
    tier: q.tier,
    giver: npcOf(w, q.giver),
    band: q.band,
    prereqs: q.prereqs,
    repeatHours: q.cooldownSeconds === null ? null : q.cooldownSeconds / 3600,
    // Only when paused (QBQ_PAUSED, 16), so other quests' entries stay as they were
    ...(q.needs & 16 ? { paused: true } : {}),
    // Only when it starts on a death (QBQ_ON_DEATH, 32): no NPC offers it
    ...(q.needs & 32 ? { onDeath: true } : {}),
    timeLimitMinutes: q.timeLimitSeconds === null ? null : q.timeLimitSeconds / 60,
    text: q.text,
    steps: q.steps.map((s) => ({
      kind: s.kind,
      objective: s.objective,
      brief: s.brief,
      count: s.count,
      className: s.cls,
      targetName: s.clsName,
      exact: s.exact,
      rooms: roomsOf(w, s.area),
      parcel: s.parcel,
      turnin: npcOf(w, s.turnin),
      auto: s.auto,
      rewards: rewardsOf(s.rewards),
      withName: s.withName,
      amount: s.amount,
      items: s.items.map((i) => ({ className: i.cls, name: i.name })),
    })),
    rewards: rewardsOf(q.rewards),
  }));
}

/** FNV-1a over the catalogue's JSON, kept to 27 bits (Kod's integers are 28-bit and signed), never 0 */
export function catalogHash(quests: CatalogQuest[], givers: ResolvedGiver[]): number {
  const text = JSON.stringify({ quests, givers: givers.map((g) => [g.id, g.name, g.icon, g.ridNum, g.row, g.col, g.fineRow, g.fineCol, g.angle, g.desc]) });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0x7ffffff) || 1;
}
