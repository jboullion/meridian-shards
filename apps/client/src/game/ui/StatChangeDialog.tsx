// Changing your stats at an elder (module/stats, stats.rc IDD_CHARSTATS in the "Adjust your
// character" sheet). The six stats share 220 points, each 1 to 50, as in the creator; the
// eight school levels can only go down, and intellect can't go below what the levels you
// keep need. Two warnings, then BP_CHANGED_STATS.

import { useState, type ReactNode } from "react";
import type { GameSession } from "@shards/world";
import { STAT_NAMES, STAT_ROWS } from "../CharacterCreator.tsx";
import { Button, GraphBar, GroupBox, MessageBox, Text, Window, type Rect } from "./kit.tsx";

/** statsstat.c: stats 1..50, 220 points in all (initStatsFromServer), schools 0..6 */
const STAT_MIN = 1;
const STAT_MAX = 50;
const STAT_TOTAL = 220;
const STAT_POINTS_INITIAL = 70;
const SCHOOL_MAX = 6;

/** stats.rc: where each school's bar and name go (Shal'ille, Qor, Kraanan, Faren, Riija, Jala, Weaponcraft, Crafting) */
const SCHOOL_ROWS: { name: string; label: Rect; bar: Rect }[] = [
  { name: "Shal'ille", label: [21, 205, 34, 8], bar: [57, 202, 79, 14] },
  { name: "Qor", label: [21, 224, 34, 8], bar: [57, 223, 79, 14] },
  { name: "Kraanan", label: [21, 245, 34, 8], bar: [57, 242, 79, 14] },
  { name: "Faren", label: [154, 205, 50, 8], bar: [208, 202, 79, 14] },
  { name: "Riija", label: [154, 224, 50, 8], bar: [208, 223, 79, 14] },
  { name: "Jala", label: [154, 245, 50, 8], bar: [208, 242, 79, 14] },
  { name: "Weaponcraft", label: [18, 265, 40, 8], bar: [57, 263, 79, 14] },
  { name: "Crafting", label: [154, 263, 50, 8], bar: [208, 263, 79, 14] },
];

/**
 * statsstat.c StatsIntellectNeeded: eight levels need nothing more; past that, 5 intellect
 * for each level beyond the first in a school (level ones count as if they were twos).
 */
export function intellectNeeded(levels: readonly number[]): number {
  let levelsCount = 0;
  let schools = 0;
  let ones = 0;
  for (const v of levels) {
    if (v === 1) ones++;
    if (v > 1) {
      schools++;
      levelsCount += v;
    }
  }
  levelsCount += ones;
  return levelsCount <= 8 ? 1 : (levelsCount - schools - 8) * 5;
}

/** A right-aligned label (the .rc LTEXTs that end at their control) */
function Label({ at: r, children }: { at: Rect; children: ReactNode }) {
  return (
    <Text at={r} className="right">
      {children}
    </Text>
  );
}

const CONFIRM_POINTS = "You have some points remaining to allocate to statistics; are you sure you want to discard these points?";
const CONFIRM_1 =
  "Are you sure you would like to change your character using these stats?\n\nIf you have reduced stats, you WILL lose 2 percent PER stat point reduced, in every spell that depends on that stat, this cannot be reversed!";
const CONFIRM_2 =
  "Are you REALLY, REALLY, sure you would like to change your character using these stats?\n\nServer admins will not undo any changes you make,  LAST CHANCE!\n\nI'm Serious!  Don't be sending tells to the admins if you blow up your character, this is on you.";

export function StatChangeDialog({
  session, stats: initialStats, levels: initialLevels, onClose,
}: {
  session: GameSession;
  stats: number[];
  levels: number[];
  onClose: () => void;
}) {
  const [stats, setStats] = useState(initialStats);
  const [levels, setLevels] = useState(initialLevels);
  /** The questions before sending (statsstat.c PSN_APPLY, statsmake.c VerifySettings) */
  const [asking, setAsking] = useState<string[] | null>(null);
  const points = STAT_TOTAL - stats.reduce((a, v) => a + v, 0);

  // StatGraphProc GRPH_POSSETUSER: no more than the points left; intellect not below what the levels need
  const setStat = (i: number, v: number) => {
    let next = Math.max(STAT_MIN, Math.min(STAT_MAX, v));
    if (i === 1 && next < intellectNeeded(levels)) return;
    if (next - stats[i] > points) next = stats[i] + points;
    setStats(stats.map((s, j) => (j === i ? next : s)));
  };
  // Schools only go down; raising one back raises intellect to what it needs (CharStatsGraphChanging)
  const setLevel = (i: number, v: number) => {
    const next = Math.max(0, Math.min(initialLevels[i], v));
    const all = levels.map((l, j) => (j === i ? next : l));
    setLevels(all);
    if (next > levels[i]) {
      const need = Math.min(STAT_MAX, intellectNeeded(all));
      if (stats[1] < need) setStats(stats.map((s, j) => (j === 1 ? need : s)));
    }
  };
  const done = () => setAsking([...(points > 0 ? [CONFIRM_POINTS] : []), CONFIRM_1, CONFIRM_2]);

  return (
    <div className="mk-modal">
      <Window title="Adjust your character" dlu={[320, 316]} onClose={onClose}>
        <Text at={[37, 6, 200, 8]}>Change your character&apos;s statistics.</Text>
        {STAT_ROWS.map((r, i) => [
          <Label key="l" at={[0, r.y, 38, 8]}>
            {STAT_NAMES[i]}
          </Label>,
          <GraphBar key="g" at={[42, r.bar, 102, 14]} label={STAT_NAMES[i]} min={STAT_MIN} max={STAT_MAX} value={stats[i]} onChange={(v) => setStat(i, v)} />,
          <Text key="t1" at={[149, r.textY, 165, 8]}>
            {r.text[0]}
          </Text>,
          <Text key="t2" at={[149, r.textY + 8, 165, 8]}>
            {r.text[1]}
          </Text>,
        ])}
        <Text at={[67, 136, 60, 8]}>Stat points left</Text>
        <GraphBar at={[43, 147, 98, 11]} kind="points" label="Stat points left" min={0} max={STAT_POINTS_INITIAL} value={points} />
        <Text at={[44, 170, 260, 8]}>NOTE: To reduce intellect, you may have to forfeit school levels below.</Text>
        <GroupBox at={[16, 186, 286, 100]} label="Schools" />
        {SCHOOL_ROWS.map((s, i) => [
          <Text key="l" at={s.label}>
            {s.name}
          </Text>,
          <GraphBar key="g" at={s.bar} label={s.name} min={0} max={SCHOOL_MAX} value={levels[i]} onChange={(v) => setLevel(i, v)} />,
        ])}
        <Button at={[200, 295, 50, 14]} isDefault onClick={done}>
          OK
        </Button>
        <Button at={[256, 295, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
      </Window>
      {asking && (
        <MessageBox
          kind="yesno"
          defaultNo
          text={asking[0]}
          onResult={(yes) => {
            if (!yes) return setAsking(null);
            if (asking.length > 1) return setAsking(asking.slice(1));
            session.changeStats(stats, levels);
            setAsking(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}
