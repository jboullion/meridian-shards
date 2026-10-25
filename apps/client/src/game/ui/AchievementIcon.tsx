// Ours (docs/adr/0025-achievements.md): an achievement's picture: the game's own sprite for the boss
// it is about (the front of its .bgf, as the inventory draws an object), else the game's icon (the roses and the crystal, no text).

import { localRes } from "@shards/world";
import iconUrl from "../../icons/icon-192.png";
import { bareIcon, type IconRenderer } from "../icons.ts";
import type { AchievementInfo } from "../achievements.ts";
import { ObjIcon } from "./Sidebar.tsx";

export function AchievementIcon({ icons, info, className }: { icons: IconRenderer; info: AchievementInfo; className?: string }) {
  return (
    <span className={`achievement-art ${className ?? ""}`}>
      {info.sprite ? <ObjIcon icons={icons} object={bareIcon(localRes(info.sprite))} /> : <img src={iconUrl} alt="" draggable={false} />}
    </span>
  );
}
