// Ours (docs/adr/0010-followers.md 9.2): the Companion tab of the character window and the
// interface column. Our companion's picture, name and kind, its health and bond, where it is,
// its stance, and what we can do with it: give it things and take them back (the vault windows),
// change its looks, dismiss it for a while or for good, call it back.

import { useState } from "react";
import { COMPANION_FLAG, COMPANION_STANCES, COMPANION_STATE, companionStateLabel, type CompanionStatus } from "@shards/world";
import type { Drawable, IconRenderer } from "../icons.ts";
import { Button } from "./kit.tsx";
import { PanelSection } from "./FriendsPanel.tsx";
import { ObjIcon } from "./Sidebar.tsx";

export function CompanionPanel({
  status, icons, object, onCommand, onGive, onTake, onLooks,
}: {
  /** Our companion, or null for none */
  status: CompanionStatus | null;
  icons: IconRenderer;
  /** Its figure while it's in view, for the picture */
  object: Drawable | null;
  /** A `companion ...` command line (UC_SHARDS) */
  onCommand: (line: string) => void;
  onGive: () => void;
  onTake: () => void;
  onLooks: () => void;
}) {
  const [confirm, setConfirm] = useState(false);

  if (!status) {
    return (
      <div className="pets-panel companion-panel">
        <PanelSection title="Companion">
          <p className="panel-note">
            You have no companion. From 50 health, your faction's leader will swear one to you: the Duke a battle-mage, the Princess a spellsword, Jonas a war-priest.
            Stand close to them and ask.
          </p>
          <div className="panel-row">
            <Button onClick={() => onCommand("companion ask")}>Ask for a companion</Button>
          </div>
        </PanelSection>
      </div>
    );
  }

  const s = status;
  const active = s.state === COMPANION_STATE.ACTIVE;
  const here = active && !(s.flags & COMPANION_FLAG.LEFT_BEHIND);
  const away = s.state === COMPANION_STATE.WAITING || s.state === COMPANION_STATE.RECOVERING;
  const hpPct = s.maxHp > 0 ? Math.round((100 * s.hp) / s.maxHp) : 0;
  const bondPct = s.nextTier > s.tierFloor ? Math.round((100 * (s.bond - s.tierFloor)) / (s.nextTier - s.tierFloor)) : 100;
  const armed = !!(s.flags & COMPANION_FLAG.FOREVER_ARMED);

  return (
    <div className="pets-panel companion-panel">
      <PanelSection title="Your companion">
        <div className="pet-current">
          <div className="pet-preview companion-preview">{object ? <ObjIcon icons={icons} object={object} opts={{ group: 0 }} /> : <span>{s.name}</span>}</div>
          <div className="pet-current-side">
            <b>{s.name}</b>
            <span className="companion-kind">{s.kindName}</span>
            <span className={`companion-state s${s.state}`}>
              {companionStateLabel(s)}
              {s.room && !here ? `: ${s.room}` : ""}
            </span>
          </div>
        </div>
        <div className="companion-bar" title={`Health ${s.hp} / ${s.maxHp}`}>
          <span>Health</span>
          <i className="companion-hp" style={{ ["--pct" as string]: `${hpPct}%` }} />
          <span>
            {s.hp}/{s.maxHp}
          </span>
        </div>
        <div className="companion-bar" title={s.nextTier ? `${s.bond} bond; the next tier at ${s.nextTier}` : `${s.bond} bond`}>
          <span>Bond {s.tier}/5</span>
          <i className="companion-bond" style={{ ["--pct" as string]: `${bondPct}%` }} />
          <span>{s.nextTier ? `${s.bond}/${s.nextTier}` : "Full"}</span>
        </div>
        {s.flags & COMPANION_FLAG.LEFT_BEHIND ? <p className="panel-note">It couldn't follow you here, and will rejoin you when it can.</p> : null}
        {s.state === COMPANION_STATE.FALLEN && (
          <p className="panel-note">It has fallen. Restore Companion (Shal'ille) on its body brings it back; otherwise it recovers in an hour.</p>
        )}
        {s.state === COMPANION_STATE.RECOVERING && s.secondsLeft > 0 && (
          <p className="panel-note">
            Recovering: ready in {Math.ceil(s.secondsLeft / 60)} minutes, or {s.fee} shillings to fetch it now.
          </p>
        )}
      </PanelSection>

      {active && (
        <PanelSection title="Stance">
          <div className="pet-colours companion-stances">
            {COMPANION_STANCES.map((st) => (
              <button key={st.id} type="button" className={st.id === s.stance ? "selected" : ""} onClick={() => onCommand(`companion ${st.word}`)}>
                {st.label}
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Pack">
        <p className="panel-note">
          {s.packCount ? `${s.packCount} ${s.packCount === 1 ? "thing" : "things"}, bulk ${s.packBulk} of ${s.bulkMax}` : `Empty; it carries as much as you can (${s.bulkMax}).`}
        </p>
        <div className="panel-row wrap">
          <Button disabled={!here} onClick={onGive} title="Things into its pack (or double-click it)">
            Give…
          </Button>
          <Button disabled={!here || !s.packCount} onClick={onTake} title="Things back out of its pack">
            Take…
          </Button>
          <Button onClick={onLooks}>Appearance…</Button>
        </div>
      </PanelSection>

      <PanelSection title="Service">
        <div className="panel-row wrap">
          {active && <Button onClick={() => onCommand("companion dismiss")}>Dismiss for now</Button>}
          {(away || (active && !here)) && <Button onClick={() => onCommand("companion come")}>Call back</Button>}
          {s.state === COMPANION_STATE.RECOVERING && s.secondsLeft > 0 && <Button onClick={() => onCommand("companion pay")}>Pay {s.fee}</Button>}
          {!confirm && !armed && s.state !== COMPANION_STATE.FALLEN && (
            <Button
              onClick={() => {
                setConfirm(true);
                onCommand("companion dismiss forever");
              }}
            >
              Dismiss forever…
            </Button>
          )}
        </div>
        {(confirm || armed) && (
          <div className="companion-confirm">
            <p className="panel-note">Dismiss {s.name} for good? The bond is lost, and its pack must be empty.</p>
            <div className="panel-row">
              <Button
                onClick={() => {
                  setConfirm(false);
                  onCommand("companion dismiss forever confirm");
                }}
              >
                Yes, for good
              </Button>
              <Button onClick={() => setConfirm(false)}>Keep it</Button>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}
