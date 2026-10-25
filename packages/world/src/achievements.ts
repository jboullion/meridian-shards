// Ours (docs/adr/0025-achievements.md): the achievements a character has earned, as our server
// sends them (UC_ACHIEVEMENTS, shards-server util/achievements.kod): the whole list for the
// Achievements window (at logon and when asked for with "achievements"), and one just earned,
// for the toast. The names, descriptions and icons are the client's (apps/client achievements.ts).

import type { ByteReader } from "@shards/protocol";

export interface EarnedAchievement {
  id: number;
  /** The server's clock (Kod's GetTime, not Unix time) when it was earned */
  when: number;
}

export type AchievementsEvent =
  /** Everything earned, and the server's clock now (a date is worked out from the gap) */
  | { type: "all"; now: number; earned: EarnedAchievement[] }
  /** One just earned */
  | { type: "unlock"; id: number; when: number };

/** UC_ACHIEVEMENTS's body (after the UC byte) */
export function readAchievements(r: ByteReader): AchievementsEvent | null {
  const kind = r.u8();
  if (kind === 1) {
    const now = r.u32();
    const earned: EarnedAchievement[] = [];
    for (let n = r.u16(); n > 0; n--) earned.push({ id: r.u16(), when: r.u32() });
    return { type: "all", now, earned };
  }
  if (kind === 2) return { type: "unlock", id: r.u16(), when: r.u32() };
  return null;
}

export const achievementsCommand = (): string => "achievements";
