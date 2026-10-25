// Ours (docs/adr/0025-achievements.md): the toast that comes up when an achievement is earned,
// one at a time, in the order they came.

import { useEffect } from "react";
import type { IconRenderer } from "../icons.ts";
import { AchievementIcon } from "./AchievementIcon.tsx";
import { achievementInfo, TOAST_MS, useAchievements, type AchievementsStore } from "../achievements.ts";

export function AchievementToast({ store, icons, onOpen }: { store: AchievementsStore; icons: IconRenderer; onOpen: () => void }) {
  useAchievements(store);
  const id = store.toasts[0];
  useEffect(() => {
    if (id === undefined) return;
    const t = window.setTimeout(() => store.shiftToast(), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [store, id]);
  const info = id === undefined ? undefined : achievementInfo(id);
  if (!info) return null;
  return (
    <button type="button" key={`${id}-${store.toasts.length}`} className="achievement-toast" onClick={onOpen} title="Achievements (U)">
      <AchievementIcon icons={icons} info={info} className="achievement-toast-icon" />
      <span className="achievement-toast-text">
        <span className="achievement-toast-head">Achievement earned</span>
        <span className="achievement-toast-name">{info.name}</span>
        {info.title ? <span className="achievement-toast-title">Title: {info.title}</span> : null}
      </span>
    </button>
  );
}
