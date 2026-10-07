// Object bitmap-group animation (clientd3d/animate.c AnimateSingle). Groups arrive
// 1-based from the server (server.h BitmapGroupSToC); we store them 0-based.

import { ANIMATE, type Animation } from "@shards/protocol";

export interface AnimState {
  type: number;
  group: number;
  groupLow: number;
  groupHigh: number;
  groupFinal: number;
  period: number;
  tick: number;
}

export function animStateFrom(a: Animation): AnimState {
  const g = (v: number | undefined) => (v ?? 1) - 1;
  switch (a.type) {
    case ANIMATE.CYCLE:
    case ANIMATE.ONCE:
      return {
        type: a.type,
        group: g(a.groupLow),
        groupLow: g(a.groupLow),
        groupHigh: g(a.groupHigh),
        groupFinal: g(a.groupFinal),
        period: a.period ?? 0,
        tick: a.period ?? 0,
      };
    default:
      return { type: ANIMATE.NONE, group: g(a.group), groupLow: 0, groupHigh: 0, groupFinal: 0, period: 0, tick: 0 };
  }
}

/**
 * Advance by dt ms. `numGroups` is the bitmap's group count (0 if unknown), used when
 * low == high, which means "cycle through every group". Returns true if the group changed.
 */
export function animStep(a: AnimState, numGroups: number, dt: number): boolean {
  if (a.type === ANIMATE.CYCLE) {
    a.tick -= dt;
    if (a.tick > 0) return false;
    if (a.groupLow === a.groupHigh) a.group = numGroups === 0 ? a.group + 1 : (a.group + 1) % numGroups;
    else a.group = a.groupLow + ((a.group - a.groupLow + 1) % (a.groupHigh - a.groupLow + 1));
    a.tick = a.period;
    return true;
  }
  if (a.type === ANIMATE.ONCE) {
    a.tick -= dt;
    if (a.tick > 0) return false;
    if (a.group === a.groupHigh) {
      a.type = ANIMATE.NONE;
      a.group = a.groupFinal;
    } else a.group++;
    a.tick = a.period;
    return true;
  }
  return false;
}
