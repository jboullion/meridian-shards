// Ours (docs/adr/0025-achievements.md): the Achievements window, from typing "achievements", its key
// (U) or a click on the toast. What the character has earned and when, and what is left, by kind.

import { useEffect, useState } from "react";
import { achievementsCommand, type GameSession } from "@shards/world";
import { Button, Tabs, Window } from "./kit.tsx";
import type { IconRenderer } from "../icons.ts";
import { AchievementIcon } from "./AchievementIcon.tsx";
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, useAchievements, type AchievementCategory, type AchievementsStore } from "../achievements.ts";

const TABS = ["All", ...ACHIEVEMENT_CATEGORIES] as const;
type Tab = (typeof TABS)[number];

const dateText = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function AchievementsDialog({ store, session, icons, onClose }: { store: AchievementsStore; session: GameSession; icons: IconRenderer; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("All");
  useAchievements(store);
  useEffect(() => {
    session.shardsCommand(achievementsCommand());
  }, [session]);
  const shown = ACHIEVEMENTS.filter((a) => tab === "All" || a.category === (tab as AchievementCategory));
  // Earned first (newest first), then what is left
  const rows = [...shown].sort((a, b) => {
    const ea = store.earned.get(a.id);
    const eb = store.earned.get(b.id);
    if (ea !== undefined && eb !== undefined) return eb - ea;
    if (ea !== undefined) return -1;
    if (eb !== undefined) return 1;
    return 0;
  });
  const got = shown.filter((a) => store.earned.has(a.id)).length;
  return (
    <Window title="Achievements" onClose={onClose} className="game-dialog achievements-window">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="achievements-page">
        <p className="achievements-count">{store.loaded ? `${got} of ${shown.length} earned` : "Asking the chroniclers..."}</p>
        <ul className="achievements-list">
          {rows.map((a) => {
            const when = store.earned.get(a.id);
            return (
              <li key={a.id} className={`achievement${when === undefined ? " locked" : ""}`}>
                <AchievementIcon icons={icons} info={a} className="achievement-icon" />
                <span className="achievement-body">
                  <span className="achievement-name">{a.name}</span>
                  <span className="achievement-desc">{a.description}</span>
                  {a.title ? <span className="achievement-title">Title: {a.title}</span> : null}
                </span>
                <span className="achievement-when">{when === undefined ? "" : dateText(when)}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mk-buttons">
        <Button isDefault onClick={onClose}>
          Close
        </Button>
      </div>
    </Window>
  );
}
