// The character creator (module/char: charmake.c, charname.c, charface.c, charstat.c,
// charspel.c, charskil.c). Five tabs like the original's "Customize your character":
//   Name: 3 to 30 legal characters, and a description
//   Appearance: gender, hair, eyes, nose, mouth, hair colour and skin colour, with the face
//     drawn from the server's parts (head plus overlays on hotspots 12, 11, 14, 13)
//   Statistics: six stats from 1 to 50, starting at 25, with 70 points to spend
//   Spells and Skills: 45 points shared; Shal'ille and Qor spells can't be mixed
// OK sends BP_NEW_CHARINFO; the server answers CHARINFO_OK or CHARINFO_NOT_OK.
// Drawn as the property sheet (charmake.c MakeChar) with each page laid out from its char.rc
// template, in dialog units, with the Meridian dialog kit.

import { useMemo, useState, type ReactNode } from "react";
import { ANIMATE, GENDER, type CharInfo, type CreatorChoice } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { IconRenderer } from "./icons.ts";
import {
  Backdrop, Button, Check, GraphBar, GroupBox, ListBox, MessageBox, Tabs, Text, TextArea, TextField, Trackbar, Window, at, type Rect,
} from "./ui/kit.tsx";
import { ObjIcon } from "./ui/Sidebar.tsx";

const TABS = ["Name", "Appearance", "Statistics", "Spells", "Skills"] as const;
type TabName = (typeof TABS)[number];

export const STAT_NAMES = ["Might", "Intellect", "Stamina", "Agility", "Mysticism", "Aim"];
const STAT_MIN = 1,
  STAT_MAX = 50,
  STAT_START = 25;
const STAT_POINTS = 70; // char.h STAT_POINTS_INITIAL
const SPELL_POINTS = 45; // char.h SPELL_POINTS_INITIAL
/** charstat.c suggested_stats and CharStatsCommand; the notes are char.rc IDD_CHARSTATS's */
const PRESETS: { label: string; note: string; stats: number[] }[] = [
  { label: "Mage", note: "Pure mage", stats: [40, 50, 45, 15, 45, 25] },
  { label: "Warrior", note: "Pure fighter", stats: [40, 10, 50, 50, 20, 50] },
  { label: "Hybrid", note: "Three school bower", stats: [35, 25, 40, 30, 45, 45] },
  { label: "Trickster", note: "Riija pure fighter", stats: [35, 35, 40, 30, 30, 50] },
];
/** char.rc IDD_CHARSTATS: each stat's label row, bar row, and its two description lines */
export const STAT_ROWS: { y: number; bar: number; textY: number; text: [string, string] }[] = [
  { y: 26, bar: 24, textY: 23, text: ["Might affects how much you can carry and the", "damage you inflict. Important for warriors."] },
  { y: 44, bar: 43, textY: 42, text: ["With a high intellect, you can learn more spells and", "skills faster than others. Used for advanced magics."] },
  { y: 64, bar: 62, textY: 61, text: ["Stamina helps you weather the rough times when", "you are hurt and tired. Used for Kraanan spells."] },
  { y: 83, bar: 81, textY: 80, text: ["An agile fighter dodges his opponent's attacks and", "is more skilled in certain fighting and defensive arts."] },
  { y: 101, bar: 100, textY: 99, text: ["Mysticism is important for gaining and restoring your", "magical energy. Used for Faren, Shal'ille, and Qor."] },
  { y: 122, bar: 120, textY: 119, text: ["A true aim guides an attack to its target. Vital for", "high skill with ranged weapons."] },
];
/** The sheet: tabs over a 316 x 232 DLU page, OK and Cancel under it */
const SHEET: readonly [number, number] = [320, 278];
const PAGE: Rect = [2, 22, 316, 236];
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

/** A right-aligned label (the .rc LTEXTs that end at their control). */
function Label({ at: r, children }: { at: Rect; children: ReactNode }) {
  return (
    <Text at={r} className="right">
      {children}
    </Text>
  );
}

export function CharacterCreator({
  info, slotId, session, icons, error, onCancel, onClearError,
}: {
  info: CharInfo;
  slotId: number;
  session: GameSession;
  icons: IconRenderer;
  error: string | null;
  onCancel: () => void;
  onClearError: () => void;
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
  /** charmake.c VerifySettings: the question being asked, and whether the stat points were already accepted */
  const [confirm, setConfirm] = useState<{ text: string; statsOk: boolean } | null>(null);
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
  const hairT = info.hairTranslations[pick(face.hairT, info.hairTranslations.length)] ?? 0;
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

  /** charmake.c VerifySettings, then BP_NEW_CHARINFO */
  const done = (statsOk = false, spellsOk = false) => {
    const n = verifyCharName(name);
    if (!n) {
      setProblem("Your name must be at least 3 characters long,\nand must consist of legal characters.");
      setTab("Name");
      return;
    }
    if (!statsOk && statPoints > 0) {
      setConfirm({ text: "You have some points remaining to allocate to statistics; are you sure you want to discard these points?", statsOk: false });
      return;
    }
    if (!spellsOk && spellPoints > 0) {
      setConfirm({ text: "You have some points remaining to allocate to spells and skills; are you sure you want to discard these points?", statsOk: true });
      return;
    }
    session.createCharacter({
      id: slotId, name: n, description: desc, gender: face.gender === 0 ? GENDER.MALE : GENDER.FEMALE,
      faceParts: [parts.head, sel.hair, sel.eyes, sel.nose, sel.mouth],
      hairTranslation: hairT, skinTranslation: faceT, stats, spells, skills,
    });
  };

  const ti = TABS.indexOf(tab);
  /** Every page's << Prev and Next >> (charmake.c CharTabPageCommand) */
  const prevNext = (y: number) => (
    <>
      <Button at={[231, y, 34, 12]} disabled={ti === 0} onClick={() => setTab(TABS[ti - 1])}>
        &lt;&lt; Prev
      </Button>
      <Button at={[270, y, 34, 12]} disabled={ti === TABS.length - 1} onClick={() => setTab(TABS[ti + 1])}>
        Next &gt;&gt;
      </Button>
    </>
  );

  let page: ReactNode;
  if (tab === "Name") {
    // char.rc IDD_CHARNAME
    page = (
      <>
        <Text at={[2, 2, 300, 8]}>Choose your character's name. It must be from 3 to 30 letters long.</Text>
        <Text at={[2, 12, 312, 8]}>
          You may use upper- or lowercase letters, numbers, spaces, or these symbols: {"!@$^&*+=:()[]{}<>;/?|"}
        </Text>
        <TextField at={[2, 26, 108, 16]} value={name} onChange={setName} maxLength={30} autoFocus />
        <Text at={[2, 52, 200, 8]}>Enter a description of your character here:</Text>
        <TextArea at={[2, 64, 302, 138]} value={desc} onChange={setDesc} maxLength={1000} />
        {prevNext(214)}
      </>
    );
  } else if (tab === "Appearance") {
    // char.rc IDD_CHARAPPEARANCE
    const arrows = (y: number, text: string, key: "hair" | "eyes" | "nose" | "mouth" | "hairT") => (
      <>
        <Label at={[140, y + 1, 55, 8]}>{text}</Label>
        <Button at={[213, y, 17, 11]} onClick={() => step(key, -1)} title={`Previous ${text.slice(0, -1).toLowerCase()}`}>
          &lt;
        </Button>
        <Button at={[230, y, 17, 11]} onClick={() => step(key, 1)} title={`Next ${text.slice(0, -1).toLowerCase()}`}>
          &gt;
        </Button>
      </>
    );
    page = (
      <>
        <GroupBox at={[3, 0, 150, 158]} label="Face" />
        <div className="mk-face" style={at([14, 18, 127, 127])}>
          <ObjIcon icons={icons} object={faceObject} className="face" />
        </div>
        <Text at={[175, 5, 135, 8]}>Choose your character's appearance.</Text>
        <Label at={[140, 22, 55, 8]}>Gender:</Label>
        <Check at={[213, 21, 45, 10]} radio name="gender" label="Male" checked={face.gender === 0} onChange={() => setFace({ ...face, gender: 0 })} />
        <Check at={[263, 21, 45, 10]} radio name="gender" label="Female" checked={face.gender === 1} onChange={() => setFace({ ...face, gender: 1 })} />
        <Label at={[140, 42, 55, 8]}>Skin color:</Label>
        <Trackbar
          at={[213, 35, 90, 15]}
          label="Skin color"
          min={0}
          max={Math.max(0, info.faceTranslations.length - 1)}
          value={face.faceT}
          onChange={(v) => setFace({ ...face, faceT: v })}
        />
        <Text at={[215, 55, 20, 8]}>Light</Text>
        <Text at={[287, 55, 20, 8]}>Dark</Text>
        {arrows(69, "Hair:", "hair")}
        {arrows(84, "Hair color:", "hairT")}
        {arrows(99, "Eyes:", "eyes")}
        {arrows(114, "Nose:", "nose")}
        {arrows(129, "Mouth:", "mouth")}
        {prevNext(146)}
      </>
    );
  } else if (tab === "Statistics") {
    // char.rc IDD_CHARSTATS
    page = (
      <>
        <Text at={[21, 6, 290, 8]}>Set your character's statistics. Choose wisely; changing them is possible but difficult.</Text>
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
        <GroupBox at={[24, 139, 269, 68]} label="Suggestions for newcomers" />
        {PRESETS.map((p, i) => [
          <Button key={`b${p.label}`} at={[43, 150 + i * 14, 50, 11]} onClick={() => setStats(p.stats)}>
            {p.label}
          </Button>,
          <Text key={`t${p.label}`} at={[98, 150 + i * 14, 168, 8]}>
            {p.note}
          </Text>,
        ])}
        <Text at={[24, 215, 60, 8]}>Stat points left</Text>
        <GraphBar at={[87, 214, 98, 11]} kind="points" label="Stat points left" min={0} max={STAT_POINTS} value={statPoints} />
        {prevNext(214)}
      </>
    );
  } else {
    page = (
      <>
        <ChoiceLists
          key={tab}
          kind={tab}
          list={tab === "Spells" ? info.spells : info.skills}
          chosen={tab === "Spells" ? spells : skills}
          setChosen={tab === "Spells" ? setSpells : setSkills}
          points={spellPoints}
          rs={rs}
        />
        {prevNext(214)}
      </>
    );
  }

  return (
    <Backdrop>
      <Window title="Customize your character" dlu={SHEET} onClose={onCancel}>
        <Tabs at={[2, 0, 316, 22]} tabs={TABS} active={tab} onChange={setTab} />
        <div className="mk-page" style={at(PAGE)}>
          <div className="mk-page-inner" style={at([0, 2, 316, 232])}>
            {page}
          </div>
        </div>
        <Button at={[214, 263, 50, 14]} isDefault onClick={() => done()}>
          OK
        </Button>
        <Button at={[268, 263, 50, 14]} onClick={onCancel}>
          Cancel
        </Button>
      </Window>
      {confirm && (
        <MessageBox
          text={confirm.text}
          kind="yesno"
          onResult={(yes) => {
            const c = confirm;
            setConfirm(null);
            if (yes) done(true, c.statsOk);
          }}
        />
      )}
      {(problem ?? error) && !confirm && (
        <MessageBox
          text={problem ?? error}
          onResult={() => {
            setProblem(null);
            onClearError();
          }}
        />
      )}
    </Backdrop>
  );
}

/**
 * charspel.c / charskil.c: the available and chosen lists (sorted, LBS_SORT), each with its
 * own selection; Add moves the selection across and selects the next row; the info text and
 * cost show the last selected item. A chosen Shal'ille spell rules out Qor ones and the reverse.
 */
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
  const one = kind === "Spells" ? "spell" : "skill";
  // char.c: the list string is the school, the level and the name
  const label = (c: CreatorChoice) => `${SCHOOLS[c.school] ?? "?"} ${c.cost < 25 ? 1 : 2}: ${rs(c.nameRes)}`;
  const byLabel = (a: CreatorChoice, b: CreatorChoice) => label(a).localeCompare(label(b), undefined, { sensitivity: "base" });
  const available = list.filter((c) => !chosen.includes(c.id)).sort(byLabel);
  const mine = list.filter((c) => chosen.includes(c.id)).sort(byLabel);
  // charspel.c CharSpellsInit: ListBox_SetCurSel(hList1, 0)
  const [sel1, setSel1] = useState<number | null>(available[0]?.id ?? null);
  const [sel2, setSel2] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(available[0]?.id ?? null);
  // MaybeEnableAddButton: a chosen Qor or Shal'ille spell decides the school
  const school = kind === "Spells" ? mine.find((c) => c.school === SS_QOR || c.school === SS_SHALILLE)?.school : undefined;
  const conflicts = (c: CreatorChoice) => (school === SS_QOR && c.school === SS_SHALILLE) || (school === SS_SHALILLE && c.school === SS_QOR);
  const cur1 = available.find((c) => c.id === sel1);
  const cur2 = mine.find((c) => c.id === sel2);
  const info = list.find((c) => c.id === shown);

  const add = (id = sel1) => {
    const i = available.findIndex((c) => c.id === id);
    const c = available[i];
    // IDC_ADDSPELL: nothing happens without the points
    if (!c || conflicts(c) || c.cost > points) return;
    setChosen([...chosen, c.id]);
    const rest = available.filter((x) => x.id !== c.id);
    const next = rest[Math.min(i, rest.length - 1)]?.id ?? null;
    setSel1(next);
    setShown(next ?? c.id);
  };
  const remove = (id = sel2) => {
    const i = mine.findIndex((c) => c.id === id);
    const c = mine[i];
    if (!c) return;
    setChosen(chosen.filter((x) => x !== c.id));
    const rest = mine.filter((x) => x.id !== c.id);
    const next = rest[Math.min(i, rest.length - 1)]?.id ?? null;
    setSel2(next);
    setShown(next ?? c.id);
  };
  const items = (cs: CreatorChoice[], blocked: (c: CreatorChoice) => boolean) =>
    cs.map((c) => ({ key: c.id, label: label(c), className: blocked(c) ? "blocked" : "" }));

  return (
    <>
      <Text at={kind === "Spells" ? [75, 3, 200, 8] : [87, 3, 180, 8]}>
        {kind === "Spells" ? "Select the spells that you will be able to cast initially." : "Select the skills that you will initially possess."}
      </Text>
      <Text at={[13, 19, 80, 8]}>Available {kind.toLowerCase()}:</Text>
      <ListBox
        at={[13, 31, 105, 161]}
        label={`Available ${kind.toLowerCase()}`}
        items={items(available, (c) => conflicts(c) || c.cost > points)}
        selected={sel1}
        onSelect={(id) => {
          setSel1(id);
          setShown(id);
        }}
        onActivate={add}
      />
      <Button at={[127, 62, 58, 14]} disabled={!cur1 || conflicts(cur1)} onClick={() => add()}>
        Add {one} &gt;&gt;
      </Button>
      <Button at={[127, 78, 58, 14]} disabled={!cur2} onClick={() => remove()}>
        &lt;&lt; Remove {one}
      </Button>
      <Text at={[123, 112, 68, 70]} wrap className="mk-choice-info">
        {info ? rs(info.descRes) : ""}
      </Text>
      <Text at={[125, 184, 22, 8]}>Cost:</Text>
      <Text at={[149, 184, 20, 8]}>{info?.cost ?? ""}</Text>
      <Text at={[195, 19, 80, 8]}>{kind} you have:</Text>
      <ListBox
        at={[195, 31, 105, 161]}
        label={`${kind} you have`}
        items={items(mine, () => false)}
        selected={sel2}
        onSelect={(id) => {
          setSel2(id);
          setShown(id);
        }}
        onActivate={remove}
      />
      {kind === "Spells" && <Text at={[57, 199, 210, 8]}>Shal'ille (good) and Qor (evil) spells cannot be chosen together.</Text>}
      <Text at={[13, 215, 72, 8]}>Spell/skill points left</Text>
      <GraphBar at={[87, 214, 98, 11]} kind="points" label="Spell/skill points left" min={0} max={SPELL_POINTS} value={points} />
    </>
  );
}
