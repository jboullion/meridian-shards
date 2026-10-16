// Ours (docs/adr/0011-fast-travel.md 4.4): crossed swords and a countdown by the minimap while the
// PvP lockout runs (UC_PVP_UNTIL): no fast travel, Elusion or Rescue until it ends.

import { useEffect, useState } from "react";

export function PvpLockout({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [until]);
  const left = Math.ceil((until - now) / 1000);
  if (left <= 0) return null;
  return (
    <div className="pvp-lockout" title="You fought another player: no fast travel, Elusion or Rescue until this runs out">
      <span aria-hidden>⚔</span> {left}
    </div>
  );
}
