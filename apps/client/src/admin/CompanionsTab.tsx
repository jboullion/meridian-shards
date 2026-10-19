// The admin dashboard's Companions tab (docs/adr/0010-followers.md): trying companions out on
// the player in the game tab, whatever the rules: give one of any kind, set its bond to see its
// tiers and gear, kill it and bring it back, fetch it, take it away. The server side is
// tools/dev/companionApi.ts, which sends shards-server util/companionbook.kod's Admin* messages.

import { useEffect, useState } from "react";
import { companionPlayer, type GameReport, type PlayerCompanion } from "./api.ts";

type Act = (what: string, fn: () => Promise<string | void>) => () => void;

/** blakston.khd COMPANION_* */
const KINDS = ["The Duke's battle-mage", "The Princess's spellsword", "A rebel war-priest"];
/** blakston.khd COMP_* */
const STATES = ["none", "with its owner", "waiting at its hall", "fallen", "recovering at its hall"];
/** companionkinds.kod TierFloor */
const TIERS = [0, 300, 1000, 2500, 5000];

export function CompanionsTab({ act, me }: { act: Act; me: GameReport | null }) {
  const [kind, setKind] = useState(1);
  const [points, setPoints] = useState(300);
  const [state, setState] = useState<PlayerCompanion | null>(null);
  const playerId = me?.playerId;
  useEffect(() => {
    if (!playerId) return;
    let live = true;
    void companionPlayer(playerId, "state").then((s) => live && setState(s), () => {});
    return () => {
      live = false;
    };
  }, [playerId]);
  const action = (what: string, name: string, extra: { kind?: number; points?: number } = {}) =>
    act(what, async () => {
      if (!playerId) throw new Error("No game tab is in the game");
      setState(await companionPlayer(playerId, name, extra));
    });
  const has = !!state?.state;

  return (
    <section>
      <h2>Your companion</h2>
      {!me ? (
        <p className="dim">No game tab in the game: log in at http://localhost:5173 first.</p>
      ) : (
        <>
          {state && (
            <p>
              {has
                ? `${KINDS[state.kind - 1] ?? `Kind ${state.kind}`}, ${STATES[state.state] ?? state.state}${state.rid ? ` (room ${state.rid})` : ""}; health ${state.hp}/${state.maxHp}; bond ${state.bond} (tier ${state.tier}); ${state.pack} in its pack.`
                : `${me.character} has no companion.`}
            </p>
          )}
          <div className="row3">
            <label>
              Kind{" "}
              <select value={kind} onChange={(e) => setKind(Number(e.target.value))}>
                {KINDS.map((k, i) => (
                  <option key={k} value={i + 1}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bond <input type="number" min={0} step={50} value={points} onChange={(e) => setPoints(Math.max(0, Number(e.target.value) || 0))} />
            </label>
          </div>
          <div className="buttons">
            <button disabled={has} onClick={action(`Give me ${KINDS[kind - 1]}`, "grant", { kind })}>
              Give me one
            </button>
            <button disabled={!has} onClick={action(`Set the bond to ${points}`, "setBond", { points })}>
              Set bond
            </button>
            {TIERS.map((t, i) => (
              <button key={t} disabled={!has} title={`Bond ${t}`} onClick={action(`Bond tier ${i + 1}`, "setBond", { points: t })}>
                Tier {i + 1}
              </button>
            ))}
          </div>
          <div className="buttons">
            <button disabled={!has} onClick={action("Bring it here", "bringHere")}>
              Bring here
            </button>
            <button disabled={!has} onClick={action("Kill it (its corpse lasts 10 minutes)", "kill")}>
              Kill it
            </button>
            <button disabled={!has} onClick={action("Revive it beside me", "revive")}>
              Revive
            </button>
            <button disabled={!has} onClick={action("Recovered now (fetch it at its hall)", "recoverNow")}>
              Recover now
            </button>
            <button
              disabled={!has}
              onClick={act("Take it away", async () => {
                if (!playerId) throw new Error("No game tab is in the game");
                if (!window.confirm("Take your companion away for good? Its pack comes to you; the bond is lost.")) return "not done";
                setState(await companionPlayer(playerId, "remove"));
              })}
            >
              Remove
            </button>
            <button onClick={action("My companion", "state")}>Refresh</button>
          </div>
          <p className="dim">
            Give me one skips the rules (health, faction). Its spells come with your health (more at 70 and 90): the Duke's Splash of Acid, Blind, Shadow Form, Unholy Weapon, Reflection; the Princess's Fireball/Ice Shard, Lightning Bolt, Minor Heal, Holy Weapon, Umbrella; Jonas's Bless, Magic Shield, Armor of Gort and the Jala songs (out of combat). Kill it leaves a corpse for Restore Companion (Shal'ille) for 10 minutes, then it recovers at its leader's hall for an hour; Recover now ends the hour.
          </p>
        </>
      )}
    </section>
  );
}
