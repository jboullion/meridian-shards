// The dashboard's Quests tab (docs/adr/0009-quests.md): write quests and place their givers,
// then try them out on your own character. Saving writes shards-server's quests/<key>.json;
// applying runs the generator, builds the Kod and reloads the server (tools/dev/questApi.ts).

import { useEffect, useMemo, useState } from "react";
import {
  applyQuests, deleteGiver, loadQuests, questPlayer, retireQuest, saveGiver, saveQuest, travelHere,
  type Catalog, type FactionName, type GameReport, type GiverFile, type InsigniaName, type NpcRef, type PlayerQuests, type QuestFile, type QuestList, type QuestRewardsFile,
  type QuestStepFile, type SchoolName,
} from "./api.ts";

type Act = (what: string, fn: () => Promise<string | void>) => () => void;

const KINDS: QuestStepFile["kind"][] = ["kill", "collect", "talk", "deliver", "visit", "cast", "deposit", "stash", "buy", "equip", "health", "hometown", "nodes", "companion", "convey", "learn", "attune", "arena"];

/** The kinds that happen once by doing something: done by themselves unless Auto is unticked */
const ACTION_KINDS: QuestStepFile["kind"][] = ["cast", "deposit", "stash", "buy", "equip", "health", "hometown", "nodes", "companion", "convey", "learn", "attune", "arena"];

const TIER_LABEL = { main: "Main (gold)", story: "Story (silver)", errand: "Errand (bronze)" } as const;

const FACTION_LABEL: Record<FactionName, string> = { neutral: "Neutral only", duke: "The Duke's", princess: "The Princess's", rebel: "The rebels'", any: "Any faction" };
const SCHOOLS: SchoolName[] = ["shalille", "qor", "kraanan", "faren", "riija", "jala"];
const INSIGNIA: InsigniaName[] = [...SCHOOLS, "duke", "princess", "rebel"];

/** What a quest asks of the player besides health, quests done and karma: [ field, label ] */
const NEEDS = [
  ["intriguing", "Of interest to the court (can join a faction)"],
  ["guildMaster", "A guild master (guild with colours)"],
  ["guildShield", "Carries a guild shield"],
  ["noGuild", "In no guild"],
] as const;

const blank = (id: number): QuestFile => ({
  id,
  key: "",
  name: "",
  giver: { class: "" },
  band: { min: 0, max: 30 },
  requires: { quests: [] },
  repeat: null,
  timeLimitMinutes: null,
  text: { offer: "", progress: "", complete: "" },
  steps: [{ kind: "kill", target: "", count: 10 }],
  rewards: { xp: 0, shillings: 0, items: [] },
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const refValue = (r: NpcRef | undefined) => (!r ? "" : "placed" in r ? `placed:${r.placed}` : `class:${r.class}`);
const refFrom = (v: string): NpcRef | undefined => (v.startsWith("placed:") ? { placed: v.slice(7) } : v.startsWith("class:") ? { class: v.slice(6) } : undefined);

/** A whole number from an input, or null for empty */
const num = (v: string): number | null => (v.trim() === "" ? null : Math.round(Number(v)));
/** A number with a fraction (xpPoints), or undefined when empty */
const frac = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

export function QuestsTab({ act, needMe, me, catalog }: { act: Act; needMe: () => GameReport; me: GameReport | null; catalog: Catalog | null }) {
  const [list, setList] = useState<QuestList | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuestFile | null>(null);
  const [giver, setGiver] = useState<(Partial<GiverFile> & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () =>
    loadQuests().then(
      (l) => {
        setList(l);
        setProblem(null);
      },
      (e: unknown) => setProblem((e as Error).message),
    );
  useEffect(() => {
    void reload();
  }, []);

  /** An action that changes the server: busy meanwhile, the list read again after */
  const run = (what: string, fn: () => Promise<string | void>) =>
    act(what, async () => {
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
        void reload();
      }
    });

  const npcName = (r: NpcRef | undefined): string => {
    if (!r || !list) return "?";
    if ("placed" in r) return list.givers.find((g) => g.key === r.placed)?.name ?? `${r.placed} (missing)`;
    return list.npcs.find((n) => n.className === r.class)?.name ?? r.class;
  };

  return (
    <section className="cols quests">
      <div>
        <h2>Quests</h2>
        {problem && <p className="error">{problem}</p>}
        {!list ? (
          <p className="dim">Reading the quests…</p>
        ) : (
          <>
            <table>
              <tbody>
                {list.quests.map((q) => (
                  <tr key={q.id} className={editing?.id === q.id ? "on" : ""}>
                    <td className="dim">{q.id}</td>
                    <td>
                      <span className={`tier-dot ${q.tier ?? "story"}`} title={TIER_LABEL[q.tier ?? "story"]} /> {q.name}
                    </td>
                    <td className="dim">
                      {npcName(q.giver)}, {q.band.min}-{q.band.max} hp, {q.steps.length} step{q.steps.length === 1 ? "" : "s"}
                    </td>
                    <td className="buttons">
                      <button onClick={() => setEditing(structuredClone(q))}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="buttons">
              <button onClick={() => setEditing(blank(0))}>New quest</button>
              <button disabled={busy} onClick={run("Apply the quests to the server", async () => (await applyQuests()).steps.join(", "))}>
                Apply to the server
              </button>
            </div>
            {list.errors.length > 0 && (
              <>
                <h2>Problems</h2>
                {list.errors.map((e) => (
                  <p key={e} className="error">
                    {e}
                  </p>
                ))}
              </>
            )}
            <h2>Placed givers</h2>
            <table>
              <tbody>
                {list.givers.map((g) => (
                  <tr key={g.key}>
                    <td className="dim">{g.id}</td>
                    <td>{g.name}</td>
                    <td className="dim">
                      {g.key}, looks like {list.npcs.find((n) => n.className === g.look)?.name ?? g.look}; {list.rooms.find((r) => r.rid === g.rid || r.ridName === g.rid)?.name ?? g.rid} row {g.row}, col {g.col}
                    </td>
                    <td className="buttons">
                      <button onClick={() => setGiver({ ...g })}>Edit</button>
                      <button
                        disabled={busy || !me}
                        onClick={run(`Move ${g.name} here`, async () => {
                          if (!window.confirm(`Move ${g.name} to your square? This builds the Kod, reloads the server (saving the game) and rebuilds the rooms involved.`)) return "not done";
                          return (await saveGiver({ key: g.key }, needMe().playerId, true)).steps.join(", ");
                        })}
                      >
                        Move here
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="buttons">
              <button onClick={() => setGiver({ key: "", name: "", look: "TosInnKeeper" })}>New giver</button>
            </div>
            {giver && <GiverForm giver={giver} setGiver={setGiver} list={list} busy={busy} run={run} needMe={needMe} />}
          </>
        )}
        <Playtest act={act} me={me} list={list} />
      </div>
      <div>
        {editing && list ? (
          <QuestForm quest={editing} setQuest={setEditing} list={list} catalog={catalog} busy={busy} run={run} me={me} />
        ) : (
          <p className="dim">
            Pick a quest to edit, or make a new one. Saving writes shards-server quests/&lt;key&gt;.json (commit it there). Applying builds the Kod and runs reload system,
            which saves the game: a few seconds.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- one quest

function QuestForm({
  quest: q,
  setQuest,
  list,
  catalog,
  busy,
  run,
  me,
}: {
  quest: QuestFile;
  setQuest: (q: QuestFile | null) => void;
  list: QuestList;
  catalog: Catalog | null;
  busy: boolean;
  run: Act;
  me: GameReport | null;
}) {
  const set = (patch: Partial<QuestFile>) => setQuest({ ...q, ...patch });
  const setStep = (i: number, patch: Partial<QuestStepFile>) => set({ steps: q.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const isNew = q.id === 0;
  const key = q.key || slug(q.name);
  const save = (apply: boolean) =>
    run(apply ? `Save and apply ${q.name}` : `Save ${q.name}`, async () => {
      const r = await saveQuest(clean({ ...q, key }), apply);
      setQuest({ ...q, key, id: r.id });
      return r.steps.join(", ");
    });

  return (
    <div className="quest-form">
      <h2>{isNew ? "New quest" : `Quest ${q.id}`}</h2>
      <NpcLists list={list} catalog={catalog} />
      <label>
        Name <input value={q.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>
        File key{" "}
        <input value={q.key} placeholder={slug(q.name) || "made from the name"} onChange={(e) => set({ key: slug(e.target.value) })} />
      </label>
      <label>
        Giver <NpcSelect value={q.giver} list={list} onChange={(giver) => giver && set({ giver })} />
      </label>
      <div className="row3">
        <label>
          Tier (the markers' colour){" "}
          <select value={q.tier ?? "story"} onChange={(e) => set({ tier: e.target.value as keyof typeof TIER_LABEL })}>
            {Object.entries(TIER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Replaces from before{" "}
          <input
            value={(q.replaces ?? []).join(" ")}
            placeholder="QST_ID_ or HP*_CHAIN names"
            onChange={(e) => set({ replaces: e.target.value.split(/\s+/).filter(Boolean) })}
          />
        </label>
      </div>
      <div className="row3">
        <label>
          Health from <input type="number" value={q.band.min} onChange={(e) => set({ band: { ...q.band, min: num(e.target.value) ?? 0 } })} />
        </label>
        <label>
          to <input type="number" value={q.band.max} onChange={(e) => set({ band: { ...q.band, max: num(e.target.value) ?? 0 } })} />
        </label>
        <label>
          Offered below health{" "}
          <input
            type="number"
            value={q.requires?.healthBelow ?? ""}
            placeholder="always"
            onChange={(e) => set({ requires: { ...q.requires, healthBelow: num(e.target.value) ?? undefined } })}
          />
        </label>
        <label>
          Time limit (minutes) <input type="number" value={q.timeLimitMinutes ?? ""} placeholder="none" onChange={(e) => set({ timeLimitMinutes: num(e.target.value) })} />
        </label>
      </div>
      <div className="row3">
        <label>
          Repeats every (hours){" "}
          <input type="number" value={q.repeat?.cooldownHours ?? ""} placeholder="once only" onChange={(e) => set({ repeat: num(e.target.value) === null ? null : { cooldownHours: Number(e.target.value) } })} />
        </label>
        <label>
          Needs quests done first{" "}
          <select multiple value={(q.requires?.quests ?? []).map(String)} onChange={(e) => set({ requires: { ...q.requires, quests: [...e.target.selectedOptions].map((o) => Number(o.value)) } })}>
            {list.quests
              .filter((x) => x.id !== q.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id} {x.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Not offered once any of these is done or going{" "}
          <select
            multiple
            value={(q.requires?.notQuests ?? []).map(String)}
            onChange={(e) => set({ requires: { ...q.requires, notQuests: [...e.target.selectedOptions].map((o) => Number(o.value)) } })}
          >
            {list.quests
              .filter((x) => x.id !== q.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id} {x.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="row3">
        <label>
          Faction{" "}
          <select
            value={q.requires?.faction ?? ""}
            onChange={(e) => set({ requires: { ...q.requires, faction: (e.target.value || undefined) as FactionName | undefined } })}
          >
            <option value="">Anyone</option>
            {(Object.keys(FACTION_LABEL) as FactionName[]).map((f) => (
              <option key={f} value={f}>
                {FACTION_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        {NEEDS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={!!q.requires?.[k]} onChange={(e) => set({ requires: { ...q.requires, [k]: e.target.checked || undefined } })} /> {label}
          </label>
        ))}
        <label className="check" title="Never offered while paused; a player who has it going can still finish it">
          <input type="checkbox" checked={!!q.paused} onChange={(e) => set({ paused: e.target.checked || undefined })} /> Paused (not offered)
        </label>
      </div>
      <label>
        Offer: what the giver says <textarea rows={3} value={q.text.offer} onChange={(e) => set({ text: { ...q.text, offer: e.target.value } })} />
      </label>
      <label>
        While it's going <textarea rows={2} value={q.text.progress ?? ""} onChange={(e) => set({ text: { ...q.text, progress: e.target.value } })} />
      </label>
      <label>
        On completing it <textarea rows={2} value={q.text.complete} onChange={(e) => set({ text: { ...q.text, complete: e.target.value } })} />
      </label>

      <h2>Steps</h2>
      {q.steps.map((s, i) => (
        <div key={i} className="step">
          <div className="row3">
            <label>
              Step {i + 1}{" "}
              <select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as QuestStepFile["kind"] })}>
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            {(s.kind === "kill" || s.kind === "collect") && (
              <label>
                How many <input type="number" value={s.count ?? 1} onChange={(e) => setStep(i, { count: num(e.target.value) ?? 1 })} />
              </label>
            )}
            <label>
              Handed in to{" "}
              <NpcSelect value={s.turnin} list={list} allowGiver onChange={(turnin) => setStep(i, { turnin })} />
            </label>
          </div>
          {s.kind === "kill" && (
            <div className="row3">
              <label>
                Monster <input list="quest-monsters" value={s.target ?? ""} onChange={(e) => setStep(i, { target: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={!!s.exact} onChange={(e) => setStep(i, { exact: e.target.checked })} /> This class only, not its kinds
              </label>
              <label className="check">
                <input type="checkbox" checked={!!s.inRooms} onChange={(e) => setStep(i, { inRooms: e.target.checked || undefined })} /> Only kills in its rooms count
                (set the rooms below)
              </label>
            </div>
          )}
          {s.kind === "collect" && (
            <label>
              Item <input list="quest-items" value={s.item ?? ""} onChange={(e) => setStep(i, { item: e.target.value })} />
            </label>
          )}
          {s.kind === "deliver" && (
            <label>
              The parcel is called <input value={s.parcel ?? ""} placeholder="a sealed letter" onChange={(e) => setStep(i, { parcel: e.target.value })} />
            </label>
          )}
          {s.kind === "cast" && (
            <label>
              Spell <input list="quest-spells" value={s.spell ?? ""} onChange={(e) => setStep(i, { spell: e.target.value })} />
            </label>
          )}
          {(s.kind === "deposit" || s.kind === "stash" || s.kind === "buy") && (
            <div className="row3">
              <label>
                With (an NPC class) <input list="quest-npcs" value={s.with ?? ""} placeholder={s.kind === "buy" ? "anyone" : ""} onChange={(e) => setStep(i, { with: e.target.value || undefined })} />
              </label>
              {s.kind === "deposit" ? (
                <label>
                  At least (shillings) <input type="number" value={s.amount ?? 1} onChange={(e) => setStep(i, { amount: num(e.target.value) ?? 1 })} />
                </label>
              ) : (
                <label>
                  Item <input list="quest-items" value={s.item ?? ""} placeholder="anything" onChange={(e) => setStep(i, { item: e.target.value || undefined })} />
                </label>
              )}
            </div>
          )}
          {s.kind === "equip" && (
            <label>
              Any one of these items{" "}
              <input list="quest-items" value={(s.items ?? []).join(" ")} placeholder="item classes, spaces between" onChange={(e) => setStep(i, { items: e.target.value.split(/\s+/).filter(Boolean) })} />
            </label>
          )}
          {s.kind === "learn" && (
            <label>
              Any one of these skills{" "}
              <input value={(s.skills ?? []).join(" ")} placeholder="skill classes, spaces between (Block Punch)" onChange={(e) => setStep(i, { skills: e.target.value.split(/\s+/).filter(Boolean) })} />
            </label>
          )}
          {s.kind === "attune" && (
            <label>
              Travel point{" "}
              <input type="number" value={s.point ?? 1} onChange={(e) => setStep(i, { point: num(e.target.value) ?? 1 })} />
            </label>
          )}
          {s.kind === "arena" && (
            <label>
              Arena{" "}
              <select value={s.arena ?? "kraanan"} onChange={(e) => setStep(i, { arena: e.target.value as "kraanan" | "death" })}>
                <option value="kraanan">Kraanan (melee)</option>
                <option value="death">Death (duel)</option>
              </select>{" "}
              <input type="checkbox" checked={!!s.win} onChange={(e) => setStep(i, { win: e.target.checked || undefined })} /> only a bout won
            </label>
          )}
          {(s.kind === "health" || s.kind === "nodes") && (
            <label>
              {s.kind === "health" ? "Base health to reach" : "Mana nodes"}{" "}
              <input type="number" value={s.amount ?? (s.kind === "nodes" ? 12 : 50)} onChange={(e) => setStep(i, { amount: num(e.target.value) ?? 1 })} />
            </label>
          )}
          {s.kind !== "talk" && s.kind !== "deliver" && (
            <label className="check">
              <input type="checkbox" checked={s.auto ?? ACTION_KINDS.includes(s.kind)} onChange={(e) => setStep(i, { auto: e.target.checked })} /> Done by itself (no handing in)
            </label>
          )}
          <div className="row3">
            <label>
              Step reward: experience <input type="number" value={s.rewards?.xp ?? 0} onChange={(e) => setStep(i, { rewards: { ...s.rewards, xp: num(e.target.value) ?? 0 } })} />
            </label>
            <label>
              shillings <input type="number" value={s.rewards?.shillings ?? 0} onChange={(e) => setStep(i, { rewards: { ...s.rewards, shillings: num(e.target.value) ?? 0 } })} />
            </label>
            <label>
              training points <input type="number" value={s.rewards?.trainingPoints ?? 0} onChange={(e) => setStep(i, { rewards: { ...s.rewards, trainingPoints: num(e.target.value) ?? 0 } })} />
            </label>
          </div>
          {s.kind === "visit" && <RoomsInput label="Rooms (any one)" value={s.rooms} onChange={(rooms) => setStep(i, { rooms })} me={me} run={run} />}
          {(s.kind === "kill" || s.kind === "collect") && (
            <RoomsInput
              label="Where (for the map's area)"
              placeholder={s.kind === "kill" ? "empty: where it spawns" : "empty: no area"}
              value={s.rooms}
              onChange={(rooms) => setStep(i, { rooms })}
              me={me}
              run={run}
            />
          )}
          {s.kind === "kill" && !s.rooms?.length && (
            <RoomsInput label="Leave out of the area" placeholder="none" value={s.exclude} onChange={(exclude) => setStep(i, { exclude })} me={me} run={run} />
          )}
          {list.areas[q.id]?.[i]?.length ? <p className="dim">Area on the map: {list.areas[q.id]![i]!.join(", ")}</p> : null}
          <label>
            Tracker line <input value={s.objective ?? ""} placeholder="made up from the step" onChange={(e) => setStep(i, { objective: e.target.value || undefined })} />
          </label>
          {i > 0 && (
            <label>
              What the giver says as it starts <textarea rows={2} value={s.brief ?? ""} onChange={(e) => setStep(i, { brief: e.target.value || undefined })} />
            </label>
          )}
          <div className="buttons">
            <button disabled={i === 0} onClick={() => set({ steps: move(q.steps, i, i - 1) })}>Up</button>
            <button disabled={i === q.steps.length - 1} onClick={() => set({ steps: move(q.steps, i, i + 1) })}>Down</button>
            <button disabled={q.steps.length === 1} onClick={() => set({ steps: q.steps.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        </div>
      ))}
      <div className="buttons">
        <button onClick={() => set({ steps: [...q.steps, { kind: "kill", target: "", count: 10 }] })}>Add a step</button>
      </div>

      <h2>Rewards</h2>
      <div className="row3">
        <label>
          XP worth (points of health at the band minimum){" "}
          <input
            type="number"
            step={0.05}
            value={q.rewards.xpPoints ?? ""}
            placeholder="none"
            onChange={(e) => set({ rewards: { ...q.rewards, xpPoints: frac(e.target.value) } })}
          />
        </label>
        <p className="dim">
          {q.rewards.xpPoints ? `= ${Math.round(q.rewards.xpPoints * (q.band.min + 1) ** 2).toLocaleString("en")} XP at ${q.band.min} health. ` : ""}A main quest gives XP; a hub's main quests come to about a third of its band's levelling.
        </p>
      </div>
      <div className="row3">
        <label>
          Experience <input type="number" value={q.rewards.xp ?? 0} onChange={(e) => set({ rewards: { ...q.rewards, xp: num(e.target.value) ?? 0 } })} />
        </label>
        <label>
          Shillings <input type="number" value={q.rewards.shillings ?? 0} onChange={(e) => set({ rewards: { ...q.rewards, shillings: num(e.target.value) ?? 0 } })} />
        </label>
        <label>
          Training points <input type="number" value={q.rewards.trainingPoints ?? 0} onChange={(e) => set({ rewards: { ...q.rewards, trainingPoints: num(e.target.value) ?? 0 } })} />
        </label>
      </div>
      {(q.rewards.items ?? []).map((it, i) => (
        <div key={i} className="row3">
          <label>
            Item <input list="quest-items" value={it.class} onChange={(e) => set({ rewards: { ...q.rewards, items: (q.rewards.items ?? []).map((x, j) => (j === i ? { ...x, class: e.target.value } : x)) } })} />
          </label>
          <label>
            How many{" "}
            <input
              type="number"
              value={it.count ?? 1}
              onChange={(e) => set({ rewards: { ...q.rewards, items: (q.rewards.items ?? []).map((x, j) => (j === i ? { ...x, count: num(e.target.value) ?? 1 } : x)) } })}
            />
          </label>
          <label>
            Made for{" "}
            <select
              value={it.school ?? ""}
              onChange={(e) =>
                set({ rewards: { ...q.rewards, items: (q.rewards.items ?? []).map((x, j) => (j === i ? { ...x, school: (e.target.value || undefined) as SchoolName | undefined } : x)) } })
              }
            >
              <option value="">(no school)</option>
              {SCHOOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="buttons">
            <button onClick={() => set({ rewards: { ...q.rewards, items: (q.rewards.items ?? []).filter((_, j) => j !== i) } })}>Remove</button>
          </div>
        </div>
      ))}
      <div className="buttons">
        <button onClick={() => set({ rewards: { ...q.rewards, items: [...(q.rewards.items ?? []), { class: "", count: 1 }] } })}>Add an item</button>
      </div>
      {!!q.rewards.oneOf?.length && <p className="dim">And one of {q.rewards.oneOf.length} more, at random (edit `oneOf` in the file).</p>}
      <div className="row3">
        <label>
          Joins the faction{" "}
          <select
            value={q.rewards.joinFaction ?? ""}
            onChange={(e) => set({ rewards: { ...q.rewards, joinFaction: (e.target.value || undefined) as QuestRewardsFile["joinFaction"] } })}
          >
            <option value="">(no)</option>
            <option value="duke">The Duke's</option>
            <option value="princess">The Princess's</option>
            <option value="rebel">The rebels'</option>
          </select>
        </label>
        <label>
          Insignia on their guild shield{" "}
          <select value={q.rewards.insignia ?? ""} onChange={(e) => set({ rewards: { ...q.rewards, insignia: (e.target.value || undefined) as InsigniaName | undefined } })}>
            <option value="">(none)</option>
            {INSIGNIA.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={!!q.rewards.necroGuild} onChange={(e) => set({ rewards: { ...q.rewards, necroGuild: e.target.checked || undefined } })} /> Raises the
          necromancer guild, with them its master
        </label>
      </div>

      <div className="buttons stick-bottom">
        <button disabled={busy} onClick={save(false)}>Save</button>
        <button disabled={busy} onClick={save(true)}>Save and apply</button>
        {!isNew && (
          <button
            disabled={busy}
            onClick={run(`Retire ${q.name}`, async () => {
              if (!window.confirm(`Retire quest ${q.id}? Its file goes and its id is never used again; players who have it lose it at their next logon.`)) return "not done";
              const r = await retireQuest(q.id);
              setQuest(null);
              return r.steps.join(", ");
            })}
          >
            Retire
          </button>
        )}
        <button onClick={() => setQuest(null)}>Close</button>
      </div>
      <details>
        <summary className="dim">The file</summary>
        <pre className="out">{JSON.stringify(clean({ ...q, key }), null, 2)}</pre>
      </details>
    </div>
  );
}

/** Rooms as RID_ names or numbers, with This room for the one you stand in */
function RoomsInput({
  label, placeholder = "RID_ names or numbers, spaces between", value, onChange, me, run,
}: {
  label: string;
  placeholder?: string;
  value: (string | number)[] | undefined;
  onChange: (rooms: (string | number)[]) => void;
  me: GameReport | null;
  run: Act;
}) {
  return (
    <label>
      {label}{" "}
      <span className="inline">
        <input
          list="quest-rooms"
          value={(value ?? []).join(" ")}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.split(/\s+/).filter(Boolean).map((r) => (/^\d+$/.test(r) ? Number(r) : r)))}
        />
        <button
          disabled={!me}
          onClick={run("This room", async () => {
            const here = await travelHere(me!.playerId);
            onChange([...new Set([...(value ?? []), here.rid])]);
            return `RID ${here.rid}`;
          })}
        >
          This room
        </button>
      </span>
    </label>
  );
}

function move<T>(xs: T[], from: number, to: number): T[] {
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** Leaves out what's empty, so files stay short */
function clean(q: QuestFile): QuestFile {
  return {
    ...q,
    paused: q.paused || undefined,
    requires: cleanRequires(q.requires),
    text: { offer: q.text.offer, ...(q.text.progress ? { progress: q.text.progress } : {}), complete: q.text.complete },
    steps: q.steps.map((s) => {
      const out: QuestStepFile = { kind: s.kind };
      if (s.kind === "kill") Object.assign(out, { target: s.target, count: s.count ?? 1 }, s.exact ? { exact: true } : {}, s.inRooms && s.rooms?.length ? { inRooms: true } : {});
      if (s.kind === "collect") Object.assign(out, { item: s.item, count: s.count ?? 1 });
      if (s.kind === "deliver") out.parcel = s.parcel;
      if (s.kind === "cast") out.spell = s.spell;
      if ((s.kind === "deposit" || s.kind === "stash" || s.kind === "buy") && s.with) out.with = s.with;
      if ((s.kind === "stash" || s.kind === "buy") && s.item) out.item = s.item;
      if (s.kind === "equip") out.items = s.items;
      if (s.kind === "learn") out.skills = s.skills;
      if (s.kind === "attune") out.point = s.point ?? 1;
      if (s.kind === "arena") Object.assign(out, { arena: s.arena ?? "kraanan" }, s.win ? { win: true } : {});
      if (s.kind === "deposit" || s.kind === "health" || (s.kind === "nodes" && s.amount !== undefined && s.amount !== 12)) out.amount = s.amount ?? (s.kind === "health" ? 50 : 1);
      if (s.auto !== undefined && s.auto !== ACTION_KINDS.includes(s.kind) && s.kind !== "talk" && s.kind !== "deliver") out.auto = s.auto;
      const sr = cleanRewards(s.rewards ?? {});
      if (Object.keys(sr).length) out.rewards = sr;
      if (s.kind === "visit" || ((s.kind === "kill" || s.kind === "collect") && s.rooms?.length)) out.rooms = s.rooms;
      if (s.kind === "kill" && !s.rooms?.length && s.exclude?.length) out.exclude = s.exclude;
      if (s.turnin) out.turnin = s.turnin;
      if (s.objective) out.objective = s.objective;
      if (s.brief) out.brief = s.brief;
      return out;
    }),
    tier: q.tier && q.tier !== "story" ? q.tier : undefined,
    replaces: q.replaces?.length ? q.replaces : undefined,
    rewards: cleanRewards(q.rewards),
  };
}

function cleanRequires(r: QuestFile["requires"]): QuestFile["requires"] {
  if (!r) return undefined;
  const out: NonNullable<QuestFile["requires"]> = {
    ...(r.quests?.length ? { quests: r.quests } : {}),
    ...(r.notQuests?.length ? { notQuests: r.notQuests } : {}),
    ...(r.healthBelow ? { healthBelow: r.healthBelow } : {}),
    ...(r.karmaMin != null ? { karmaMin: r.karmaMin } : {}),
    ...(r.karmaMax != null ? { karmaMax: r.karmaMax } : {}),
    ...(r.faction ? { faction: r.faction } : {}),
  };
  for (const [k] of NEEDS) if (r[k]) out[k] = true;
  return Object.keys(out).length ? out : undefined;
}

function cleanRewards(r: QuestRewardsFile): QuestRewardsFile {
  return {
    ...(r.xpPoints ? { xpPoints: r.xpPoints } : {}),
    ...(r.xp ? { xp: r.xp } : {}),
    ...(r.trainingPoints ? { trainingPoints: r.trainingPoints } : {}),
    ...(r.shillings ? { shillings: r.shillings } : {}),
    ...(r.items?.length ? { items: r.items.map((it) => (it.school ? it : { class: it.class, ...(it.count && it.count !== 1 ? { count: it.count } : {}) })) } : {}),
    ...(r.oneOf?.length ? { oneOf: r.oneOf } : {}),
    ...(r.joinFaction ? { joinFaction: r.joinFaction } : {}),
    ...(r.insignia ? { insignia: r.insignia } : {}),
    ...(r.necroGuild ? { necroGuild: true } : {}),
  };
}

/** The datalists the form's class inputs offer */
function NpcLists({ list, catalog }: { list: QuestList; catalog: Catalog | null }) {
  return (
    <>
      <datalist id="quest-monsters">
        {catalog?.monsters.map((m) => (
          <option key={m.className} value={m.className}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="quest-items">
        {catalog?.items.map((m) => (
          <option key={m.className} value={m.className}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="quest-spells">
        {catalog?.spells.map((m) => (
          <option key={m.className} value={m.className}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="quest-npcs">
        {list.npcs.map((m) => (
          <option key={m.className} value={m.className}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="quest-rooms">
        {list.rooms.map((r) => (
          <option key={r.rid} value={r.ridName ?? r.rid}>
            {r.name}
          </option>
        ))}
      </datalist>
    </>
  );
}

function NpcSelect({ value, list, onChange, allowGiver }: { value: NpcRef | undefined; list: QuestList; onChange: (r: NpcRef | undefined) => void; allowGiver?: boolean }) {
  const [find, setFind] = useState("");
  const npcs = useMemo(() => {
    const f = find.trim().toLowerCase();
    return list.npcs.filter((n) => !f || n.name.toLowerCase().includes(f) || n.className.toLowerCase().includes(f) || n.rooms.some((r) => r.name.toLowerCase().includes(f)));
  }, [list.npcs, find]);
  const current = refValue(value);
  return (
    <span className="inline">
      <input className="find" placeholder="find" value={find} onChange={(e) => setFind(e.target.value)} />
      <select value={current} onChange={(e) => onChange(refFrom(e.target.value))}>
        {allowGiver ? <option value="">the quest's giver</option> : <option value="">(pick one)</option>}
        <optgroup label="Placed givers">
          {list.givers.map((g) => (
            <option key={g.key} value={`placed:${g.key}`}>
              {g.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="NPCs">
          {/* The chosen one stays listed whatever the search */}
          {[...npcs, ...list.npcs.filter((n) => `class:${n.className}` === current && !npcs.includes(n))].map((n) => (
            <option key={n.className} value={`class:${n.className}`}>
              {n.name} ({n.className}
              {n.rooms.length ? `, ${n.rooms.map((r) => r.name).join(", ")}` : ""})
            </option>
          ))}
        </optgroup>
      </select>
    </span>
  );
}

// ---------------------------------------------------------------- a placed giver

function GiverForm({
  giver: g,
  setGiver,
  list,
  busy,
  run,
  needMe,
}: {
  giver: Partial<GiverFile> & { key: string };
  setGiver: (g: (Partial<GiverFile> & { key: string }) | null) => void;
  list: QuestList;
  busy: boolean;
  run: Act;
  needMe: () => GameReport;
}) {
  const isNew = !list.givers.some((x) => x.key === g.key) || !g.id;
  const key = g.key || slug(g.name ?? "");
  return (
    <div className="step">
      <h2>{isNew ? "New giver" : `Giver ${g.id}`}</h2>
      <label>
        Name <input value={g.name ?? ""} onChange={(e) => setGiver({ ...g, name: e.target.value })} />
      </label>
      {isNew && (
        <label>
          Key <input value={g.key} placeholder={slug(g.name ?? "") || "made from the name"} onChange={(e) => setGiver({ ...g, key: slug(e.target.value) })} />
        </label>
      )}
      <label>
        Looks like{" "}
        <select value={g.look} onChange={(e) => setGiver({ ...g, look: e.target.value })}>
          {list.npcs.map((n) => (
            <option key={n.className} value={n.className}>
              {n.name} ({n.className})
            </option>
          ))}
        </select>
      </label>
      <label>
        Description <textarea rows={2} value={g.desc ?? ""} placeholder="A traveller with work for those willing to do it." onChange={(e) => setGiver({ ...g, desc: e.target.value })} />
      </label>
      <div className="buttons">
        <button
          disabled={busy}
          onClick={run(isNew ? `Place ${g.name} here` : `Save ${g.name}`, async () => {
            if (!key) throw new Error("A name first");
            const r = await saveGiver({ ...g, key }, isNew ? needMe().playerId : undefined, isNew);
            setGiver(null);
            return r.steps.join(", ");
          })}
        >
          {isNew ? "Place giver here" : "Save"}
        </button>
        {!isNew && (
          <button
            disabled={busy}
            onClick={run(`Remove ${g.name}`, async () => {
              if (!window.confirm(`Remove ${g.name}?`)) return "not done";
              const r = await deleteGiver(g.key);
              setGiver(null);
              return r.steps.join(", ");
            })}
          >
            Remove
          </button>
        )}
        <button onClick={() => setGiver(null)}>Close</button>
      </div>
      {isNew && <p className="dim">A new giver stands on your square, facing the way you face.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- trying them out

function Playtest({ act, me, list }: { act: Act; me: GameReport | null; list: QuestList | null }) {
  const [id, setId] = useState(0);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<PlayerQuests | null>(null);
  const playerId = me?.playerId;
  const quest = list?.quests.find((q) => q.id === id) ?? list?.quests[0];
  const qid = quest?.id ?? 0;
  useEffect(() => {
    if (!playerId) return;
    let live = true;
    void questPlayer(playerId, "state").then((s) => live && setState(s), () => {});
    return () => {
      live = false;
    };
  }, [playerId]);
  const action = (what: string, name: string, extra?: number) =>
    act(`${what}${qid ? ` (quest ${qid})` : ""}`, async () => {
      if (!playerId) throw new Error("No game tab is in the game");
      setState(await questPlayer(playerId, name, qid, extra));
    });
  const nameOf = (n: number) => list?.quests.find((q) => q.id === n)?.name ?? `quest ${n}`;
  return (
    <>
      <h2>Try it out (you)</h2>
      {!me ? (
        <p className="dim">No game tab in the game.</p>
      ) : (
        <>
          <div className="row3">
            <label>
              Quest{" "}
              <select value={qid} onChange={(e) => setId(Number(e.target.value))}>
                {list?.quests.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.id} {q.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Step <input type="number" min={1} max={quest?.steps.length ?? 1} value={step} onChange={(e) => setStep(Number(e.target.value) || 1)} />
            </label>
          </div>
          <div className="buttons">
            <button onClick={action("Give me the quest", "grant")}>Give me it</button>
            <button onClick={action(`Put me at step ${step}`, "step", step)}>Go to step</button>
            <button onClick={action("Count this step done", "finish")}>Count step done</button>
            <button onClick={action("Complete it, with its rewards", "complete")}>Complete it</button>
            <button onClick={action("Forget it", "reset")}>Forget it</button>
            <button onClick={action("Forget all my quests", "resetAll")}>Forget all</button>
            <button onClick={action("My quests", "state")}>Refresh</button>
          </div>
          {state && (
            <p className="dim">
              Going: {state.log.length ? state.log.map((l) => `${nameOf(l.id)} (step ${l.step}, count ${l.count})`).join("; ") : "none"}. Done:{" "}
              {state.done.length ? state.done.map((d) => `${nameOf(d.id)}${d.times > 1 ? ` ×${d.times}` : ""}`).join(", ") : "none"}.
            </p>
          )}
          <p className="dim">Count step done fills a kill count or a visit (a collect step counts what you carry). You still hand it in at the NPC: activate them in the game.</p>
        </>
      )}
    </>
  );
}
