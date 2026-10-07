// The character creator (module/char: charmake.c, charname.c, charface.c, charstat.c,
// charspel.c, charskil.c). Five tabs like the original's "Customize your character":
//   Name: 3 to 30 legal characters, and a description
//   Appearance: gender, hair, eyes, nose, mouth, hair colour and skin colour, with the face
//     drawn from the server's parts (head plus overlays on hotspots 12, 11, 14, 13)
//   Statistics: six stats from 1 to 50, starting at 25, with 70 points to spend
//   Spells and Skills: 45 points shared; Shal'ille and Qor spells can't be mixed
// Done sends BP_NEW_CHARINFO; the server answers CHARINFO_OK or CHARINFO_NOT_OK.

import { useMemo, useState } from "react";
import { ANIMATE, GENDER, type CharInfo, type CreatorChoice } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { IconRenderer } from "./icons.ts";
import { ObjIcon } from "./ui/Sidebar.tsx";

const TABS = ["Name", "Appearance", "Statistics", "Spells", "Skills"] as const;
type TabName = (typeof TABS)[number];

const STAT_NAMES = ["Might", "Intellect", "Stamina", "Agility", "Mysticism", "Aim"];
const STAT_MIN = 1,
  STAT_MAX = 50,
  STAT_START = 25;
const STAT_POINTS = 70; // char.h STAT_POINTS_INITIAL
const SPELL_POINTS = 45; // char.h SPELL_POINTS_INITIAL
/** charstat.c suggested_stats */
const PRESETS: { label: string; note: string; stats: number[] }[] = [
  { label: "Mage", note: "Pure mage", stats: [40, 50, 45, 15, 45, 25] },
  { label: "Warrior", note: "Pure fighter", stats: [40, 10, 50, 50, 20, 50] },
  { label: "Hybrid", note: "Three school bower", stats: [35, 25, 40, 30, 45, 45] },
  { label: "Trickster", note: "Riija warrior", stats: [35, 35, 40, 30, 30, 50] },
];
/** char.h School / char.rc school names */
const SCHOOLS: Record<number, string> = {
  1: "Shal'ille", 2: "Qor", 3: "Kraanan", 4: "Faren", 5: "Riija", 6: "Jala", 7: "Crafting", 8: "DMSchool",
  10: "Weaponcraft", 11: "Brawling", 12: "Thievery",
};
const SS_SHALILLE = 1,
  SS_QOR = 2;
/** charface.c: hotspots for the mouth, eyes, nose and hair */
const HS = { mouth: 12, eyes: 11, nose: 14, hair: 13 };
/** charname.c legal_chars (the Latin-1 letters at the end are accented letters) */
const LEGAL_NAME = /^[A-Za-z0-9_ '!@$^&*()+=:[\]{};/?|<>À-ÿ]+$/;

const rand = (n: number) => Math.floor(Math.random() * n);

/** charname.c VerifyCharName: trimmed, 3..30 characters, legal characters only. */
export function verifyCharName(name: string): string | null {
  const n = name.replace(/^ +| +$/g, "");
  return n.length >= 3 && n.length <= 30 && LEGAL_NAME.test(n) ? n : null;
}

export function CharacterCreator({
  info, slotId, session, icons, error, onCancel,
}: {
  info: CharInfo;
  slotId: number;
  session: GameSession;
  icons: IconRenderer;
  error: string | null;
  onCancel: () => void;
}) {
  const rs = (id: number) => session.resource(id) ?? "";
  const [tab, setTab] = useState<TabName>("Name");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  // charface.c CharFaceInit: random starting looks
  const [face, setFace] = useState(() => {
    const gender = rand(2);
    const p = info.parts[gender];
    return {
      gender, hair: rand(p.hair.length), eyes: rand(p.eyes.length), nose: rand(p.noses.length), mouth: rand(p.mouths.length),
      hairT: rand(info.hairTranslations.length), faceT: rand(info.faceTranslations.length),
    };
  });
  const [stats, setStats] = useState<number[]>(() => STAT_NAMES.map(() => STAT_START));
  const [spells, setSpells] = useState<number[]>([]);
  const [skills, setSkills] = useState<number[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const parts = info.parts[face.gender];
  // CharRecomputeFace: keep choices in range when the gender changes
  const pick = (i: number, n: number) => (n ? ((i % n) + n) % n : 0);
  const sel = {
    hair: parts.hair[pick(face.hair, parts.hair.length)],
    eyes: parts.eyes[pick(face.eyes, parts.eyes.length)],
    nose: parts.noses[pick(face.nose, parts.noses.length)],
    mouth: parts.mouths[pick(face.mouth, parts.mouths.length)],
  };
  const hairT = info.hairTranslations[face.hairT] ?? 0;
  const faceT = info.faceTranslations[face.faceT] ?? 0;
  const none = { type: ANIMATE.NONE, group: 1 };
  const faceObject = useMemo(
    () => ({
      iconRes: parts.head, animation: none, translation: faceT,
      overlays: [
        { iconRes: sel.mouth, hotspot: HS.mouth, translation: faceT, effect: 0, animation: none },
        { iconRes: sel.eyes, hotspot: HS.eyes, translation: faceT, effect: 0, animation: none },
        { iconRes: sel.nose, hotspot: HS.nose, translation: faceT, effect: 0, animation: none },
        { iconRes: sel.hair, hotspot: HS.hair, translation: hairT, effect: 0, animation: none },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts.head, sel.mouth, sel.eyes, sel.nose, sel.hair, faceT, hairT],
  );

  const statPoints = STAT_POINTS - stats.reduce((a, v) => a + (v - STAT_START), 0);
  const costOf = (list: CreatorChoice[], ids: number[]) => ids.reduce((a, id) => a + (list.find((c) => c.id === id)?.cost ?? 0), 0);
  const spellPoints = SPELL_POINTS - costOf(info.spells, spells) - costOf(info.skills, skills);

  /** charstat.c StatGraphProc: never spend more than is left */
  const setStat = (i: number, v: number) => {
    const cur = stats[i];
    let next = Math.max(STAT_MIN, Math.min(STAT_MAX, v));
    if (next - cur > statPoints) next = cur + statPoints;
    setStats(stats.map((s, j) => (j === i ? next : s)));
  };

  const step = (key: "hair" | "eyes" | "nose" | "mouth" | "hairT", d: number) => setFace({ ...face, [key]: face[key] + d });

  const done = () => {
    const n = verifyCharName(name);
    if (!n) {
      setProblem("Your name must be at least 3 characters long, and must consist of legal characters.");
      setTab("Name");
      return;
    }
    if (!confirm && statPoints > 0) {
      setConfirm("You have some points remaining to allocate to statistics; are you sure you want to discard these points?");
      return;
    }
    if (!confirm?.includes("spells") && spellPoints > 0) {
      setConfirm("You have some points remaining to allocate to spells and skills; are you sure you want to discard these points?");
      return;
    }
    setConfirm(null);
    setProblem(null);
    session.createCharacter({
      id: slotId, name: n, description: desc, gender: face.gender === 0 ? GENDER.MALE : GENDER.FEMALE,
      faceParts: [parts.head, sel.hair, sel.eyes, sel.nose, sel.mouth],
      hairTranslation: hairT, skinTranslation: faceT, stats, spells, skills,
    });
  };

  const ti = TABS.indexOf(tab);
  return (
    <div className="screen">
      <div className="card creator">
        <h1>Customize your character</h1>
        <div className="creator-tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === "Name" && (
          <div className="creator-page">
            <p className="sub">Choose your character's name. It must be from 3 to 30 letters long.</p>
            <p className="sub">You may use upper- or lowercase letters, numbers, spaces, or these symbols: !@$^&*+=:()[]{"{}"}&lt;&gt;;/?|</p>
            <label>
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </label>
            <label>
              Enter a description of your character here:
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} rows={5} />
            </label>
          </div>
        )}

        {tab === "Appearance" && (
          <div className="creator-page appearance">
            <div className="face-preview">
              <ObjIcon icons={icons} object={faceObject} className="face" />
            </div>
            <div className="face-controls">
              <div className="row">
                <label className="radio">
                  <input type="radio" checked={face.gender === 0} onChange={() => setFace({ ...face, gender: 0 })} /> Male
                </label>
                <label className="radio">
                  <input type="radio" checked={face.gender === 1} onChange={() => setFace({ ...face, gender: 1 })} /> Female
                </label>
              </div>
              {(
                [
                  ["Hair", "hair"],
                  ["Eyes", "eyes"],
                  ["Nose", "nose"],
                  ["Mouth", "mouth"],
                  ["Hair color", "hairT"],
                ] as const
              ).map(([label, key]) => (
                <div className="row" key={key}>
                  <button onClick={() => step(key, -1)}>&lt;</button>
                  <span>{label}</span>
                  <button onClick={() => step(key, 1)}>&gt;</button>
                </div>
              ))}
              <label className="slider">
                Skin color
                <input
                  type="range"
                  min={0}
                  max={info.faceTranslations.length - 1}
                  value={face.faceT}
                  onChange={(e) => setFace({ ...face, faceT: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        )}

        {tab === "Statistics" && (
          <div className="creator-page">
            <p className="sub">Set your character's statistics. Choose wisely; changing them is possible but difficult.</p>
            {STAT_NAMES.map((n, i) => (
              <label className="stat-slider" key={n}>
                <span>{n}</span>
                <input type="range" min={STAT_MIN} max={STAT_MAX} value={stats[i]} onChange={(e) => setStat(i, Number(e.target.value))} />
                <span className="val">{stats[i]}</span>
              </label>
            ))}
            <p className="points">Points left: {statPoints}</p>
            <fieldset>
              <legend>Suggestions for newcomers</legend>
              {PRESETS.map((p) => (
                <div className="row" key={p.label}>
                  <button onClick={() => setStats(p.stats)}>{p.label}</button>
                  <span className="sub">{p.note}</span>
                </div>
              ))}
            </fieldset>
          </div>
        )}

        {(tab === "Spells" || tab === "Skills") && (
          <ChoiceLists
            kind={tab}
            list={tab === "Spells" ? info.spells : info.skills}
            chosen={tab === "Spells" ? spells : skills}
            setChosen={tab === "Spells" ? setSpells : setSkills}
            points={spellPoints}
            rs={rs}
          />
        )}

        {(problem || error) && <p className="error">{problem ?? error}</p>}
        {confirm && (
          <div className="confirm">
            <p>{confirm}</p>
            <button onClick={done}>Yes</button>
            <button onClick={() => setConfirm(null)}>No</button>
          </div>
        )}
        <div className="creator-nav">
          <button disabled={ti === 0} onClick={() => setTab(TABS[ti - 1])}>
            &lt;&lt; Prev
          </button>
          <button disabled={ti === TABS.length - 1} onClick={() => setTab(TABS[ti + 1])}>
            Next &gt;&gt;
          </button>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** charspel.c / charskil.c: available and chosen lists, the cost and description of the selection. */
function ChoiceLists({
  kind, list, chosen, setChosen, points, rs,
}: {
  kind: "Spells" | "Skills";
  list: CreatorChoice[];
  chosen: number[];
  setChosen: (ids: number[]) => void;
  points: number;
  rs: (id: number) => string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const label = (c: CreatorChoice) => `${SCHOOLS[c.school] ?? "?"} ${c.cost < 25 ? 1 : 2}: ${rs(c.nameRes)}`;
  // charspel.c: a chosen Shal'ille spell rules out Qor ones and the reverse
  const school = kind === "Spells" ? list.find((c) => chosen.includes(c.id) && (c.school === SS_QOR || c.school === SS_SHALILLE))?.school : undefined;
  const blocked = (c: CreatorChoice) =>
    (school === SS_QOR && c.school === SS_SHALILLE) || (school === SS_SHALILLE && c.school === SS_QOR) || c.cost > points;
  const sel = list.find((c) => c.id === selected);
  const available = list.filter((c) => !chosen.includes(c.id));
  const mine = list.filter((c) => chosen.includes(c.id));
  const add = () => sel && !chosen.includes(sel.id) && !blocked(sel) && setChosen([...chosen, sel.id]);
  const remove = () => sel && setChosen(chosen.filter((id) => id !== sel.id));
  return (
    <div className="creator-page">
      <p className="sub">
        {kind === "Spells" ? "Select the spells that you will be able to cast initially." : "Select the skills that you will start with."}
      </p>
      <div className="choice-lists">
        <div>
          <h4>Available {kind.toLowerCase()}:</h4>
          <ul>
            {available.map((c) => (
              <li
                key={c.id}
                className={`${selected === c.id ? "selected" : ""}${blocked(c) ? " blocked" : ""}`}
                onClick={() => setSelected(c.id)}
                onDoubleClick={() => !blocked(c) && setChosen([...chosen, c.id])}
              >
                {label(c)}
              </li>
            ))}
          </ul>
        </div>
        <div className="choice-middle">
          <button onClick={add} disabled={!sel || chosen.includes(sel.id) || blocked(sel)}>
            Add {kind === "Spells" ? "spell" : "skill"} &gt;&gt;
          </button>
          <button onClick={remove} disabled={!sel || !chosen.includes(sel.id)}>
            &lt;&lt; Remove
          </button>
          {sel && (
            <>
              <p className="choice-info">{rs(sel.descRes)}</p>
              <p>Cost: {sel.cost}</p>
            </>
          )}
        </div>
        <div>
          <h4>{kind} you have:</h4>
          <ul>
            {mine.map((c) => (
              <li
                key={c.id}
                className={selected === c.id ? "selected" : ""}
                onClick={() => setSelected(c.id)}
                onDoubleClick={() => setChosen(chosen.filter((id) => id !== c.id))}
              >
                {label(c)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {kind === "Spells" && <p className="sub">Shal'ille (good) and Qor (evil) spells cannot be chosen together.</p>}
      <p className="points">Spell/skill points left: {points}</p>
    </div>
  );
}
