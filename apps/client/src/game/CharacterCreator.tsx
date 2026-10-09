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

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ANIMATE, GENDER, type CharInfo, type CreatorChoice } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { IconRenderer } from "./icons.ts";
import {
  Backdrop, Button, Check, Fixed, FlowPage, FlowText, GraphBar, GroupBox, ListBox, MessageBox, Spacer, Tabs, Text, TextArea, TextField, Trackbar, Window, at,
  type Rect,
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
/**
 * charstat.c suggested_stats and CharStatsCommand; the notes are char.rc IDD_CHARSTATS's. The
 * original only sets the stats; ours also picks spells and skills to start with (English names,
 * 45 points each set), replacing any chosen.
 */
const FIGHTER_SKILLS = ["mace fighting", "slash", "dodge"];
const PRESETS: { label: string; note: string; stats: number[]; spells: string[]; skills: string[] }[] = [
  { label: "Mage", note: "Pure mage", stats: [40, 50, 45, 15, 45, 25], spells: ["illuminate", "mystic touch", "touch of flame"], skills: [] },
  { label: "Warrior", note: "Pure fighter", stats: [40, 10, 50, 50, 20, 50], spells: [], skills: FIGHTER_SKILLS },
  { label: "Hybrid", note: "Three school bower", stats: [35, 25, 40, 30, 45, 45], spells: [], skills: FIGHTER_SKILLS },
  { label: "Trickster", note: "Riija pure fighter", stats: [35, 35, 40, 30, 30, 50], spells: [], skills: FIGHTER_SKILLS },
];
/** char.rc IDD_CHARSTATS: each stat's description (two lines there, wrapped here) */
const STAT_TEXT = [
  "Might affects how much you can carry and the damage you inflict. Important for warriors.",
  "With a high intellect, you can learn more spells and skills faster than others. Used for advanced magics.",
  "Stamina helps you weather the rough times when you are hurt and tired. Used for Kraanan spells.",
  "An agile fighter dodges his opponent's attacks and is more skilled in certain fighting and defensive arts.",
  "Mysticism is important for gaining and restoring your magical energy. Used for Faren, Shal'ille, and Qor.",
  "A true aim guides an attack to its target. Vital for high skill with ranged weapons.",
];
/** In the template the stat rows start here, 19 DLU apart, ending at STAT_ROWS_END (later when they wrap further) */
export const STAT_ROWS_Y = 23;
export const STAT_ROWS_END = STAT_ROWS_Y + 6 * 19;
/** The sheet: tabs over a 316 x 232 DLU page, OK and Cancel under it */
const SHEET: readonly [number, number] = [320, 278];
const PAGE: Rect = [2, 22, 316, 236];
/** Where each page's template goes in PAGE */
const INNER: Rect = [0, 2, 316, 232];
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

/**
 * The six stats, a row each: the name, its bar (charstat.c's BlakGraph) and the description, laid
 * out as char.rc IDD_CHARSTATS has them; a row grows when its description wraps further. For a
 * FlowPage (the creator's Statistics page, Adjust your character).
 */
export function StatRows({ stats, onChange }: { stats: readonly number[]; onChange: (i: number, v: number) => void }) {
  return (
    <div className="mk-stat-rows">
      {STAT_NAMES.map((name, i) => (
        <Fragment key={name}>
          <Text className="mk-stat-name right">{name}</Text>
          <div className="mk-stat-bar">
            <GraphBar at={[0, 0, 102, 14]} label={name} min={STAT_MIN} max={STAT_MAX} value={stats[i]} onChange={(v) => onChange(i, v)} />
          </div>
          <Text className="mk-stat-text" wrap>
            {STAT_TEXT[i]}
          </Text>
        </Fragment>
      ))}
    </div>
  );
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
  /** A preset: its stats, and its spells and skills that this server offers, as far as the points go */
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setStats(p.stats);
    let left = SPELL_POINTS;
    const pick = (list: CreatorChoice[], names: string[]) =>
      names.flatMap((n) => {
        const c = list.find((c) => session.englishResource(c.nameRes)?.toLowerCase() === n);
        if (!c || c.cost > left) return [];
        left -= c.cost;
        return [c.id];
      });
    setSpells(pick(info.spells, p.spells));
    setSkills(pick(info.skills, p.skills));
  };
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
  /** Every page's Prev and Next (charmake.c CharTabPageCommand) */
  const prevNext = (y: number) => (
    <>
      <Button at={[231, y, 34, 12]} disabled={ti === 0} onClick={() => setTab(TABS[ti - 1])}>
        Prev
      </Button>
      <Button at={[270, y, 34, 12]} disabled={ti === TABS.length - 1} onClick={() => setTab(TABS[ti + 1])}>
        Next
      </Button>
    </>
  );

  let page: ReactNode;
  if (tab === "Name") {
    // char.rc IDD_CHARNAME
    page = (
      <FlowPage at={INNER}>
        <FlowText x={2} w={312} top={2} minH={26}>
          <div>Choose your character's name. It must be from 3 to 30 letters long.</div>
          <div>You may use upper- or lowercase letters, numbers, spaces, or these symbols: {"!@$^&*+=:()[]{}<>;/?|"}</div>
        </FlowText>
        <Fixed y={28} h={174}>
          <TextField at={[2, 30, 108, 16]} value={name} onChange={setName} maxLength={30} autoFocus />
          <Text at={[2, 54, 200, 8]}>Enter a description of your character here:</Text>
          <TextArea at={[2, 66, 302, 136]} value={desc} onChange={setDesc} maxLength={1000} />
        </Fixed>
        <Spacer />
        <Fixed y={212} h={16}>
          {prevNext(214)}
        </Fixed>
      </FlowPage>
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
      <div style={at(INNER)}>
        <GroupBox at={[3, 0, 150, 158]} label="Face" />
        <div className="mk-face" style={at([14, 18, 127, 127])}>
          <ObjIcon icons={icons} object={faceObject} className="face" />
        </div>
        <Text at={[175, 3, 135, 18]} wrap>
          Choose your character's appearance.
        </Text>
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
      </div>
    );
  } else if (tab === "Statistics") {
    // char.rc IDD_CHARSTATS
    page = (
      <FlowPage at={INNER}>
        <FlowText x={21} w={290} top={6} minH={STAT_ROWS_Y - 6}>
          Set your character's statistics. Choose wisely; changing them is possible but difficult.
        </FlowText>
        <StatRows stats={stats} onChange={setStat} />
        <Fixed y={STAT_ROWS_END} h={209 - STAT_ROWS_END}>
          <GroupBox at={[24, 139, 269, 68]} label="Suggestions for newcomers" />
          {PRESETS.map((p, i) => [
            <Button key={`b${p.label}`} at={[43, 150 + i * 14, 50, 11]} onClick={() => applyPreset(p)}>
              {p.label}
            </Button>,
            <Text key={`t${p.label}`} at={[98, 150 + i * 14, 168, 8]}>
              {p.note}
            </Text>,
          ])}
        </Fixed>
        <Spacer />
        <Fixed y={212} h={16}>
          <Text at={[24, 215, 60, 8]}>Stat points left</Text>
          <GraphBar at={[87, 214, 98, 11]} kind="points" label="Stat points left" min={0} max={STAT_POINTS} value={statPoints} />
          {prevNext(214)}
        </Fixed>
      </FlowPage>
    );
  } else {
    page = (
      <ChoiceLists
        key={tab}
        kind={tab}
        list={tab === "Spells" ? info.spells : info.skills}
        chosen={tab === "Spells" ? spells : skills}
        setChosen={tab === "Spells" ? setSpells : setSkills}
        points={spellPoints}
        rs={rs}
      >
        {prevNext(214)}
      </ChoiceLists>
    );
  }

  return (
    <Backdrop>
      <Window title="Customize your character" showTitle={false} closeButton={false} wide dlu={SHEET} onClose={onCancel}>
        <Tabs at={[2, 0, 316, 22]} tabs={TABS} active={tab} onChange={setTab} />
        <div className="mk-page" style={at(PAGE, "h")}>
          {page}
        </div>
        <div style={at([214, 263, 104, 14], "y")}>
          <Button at={[0, 0, 50, 14]} isDefault onClick={() => done()}>
            OK
          </Button>
          <Button at={[54, 0, 50, 14]} onClick={onCancel}>
            Cancel
          </Button>
        </div>
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
  kind, list, chosen, setChosen, points, rs, children,
}: {
  kind: "Spells" | "Skills";
  list: CreatorChoice[];
  chosen: number[];
  setChosen: (ids: number[]) => void;
  points: number;
  rs: (id: number) => string;
  /** Prev and Next, beside the points */
  children: ReactNode;
}) {
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
    <FlowPage at={INNER}>
      <FlowText x={kind === "Spells" ? 75 : 87} w={kind === "Spells" ? 200 : 180} top={3} minH={16}>
        {kind === "Spells" ? "Select the spells that you will be able to cast initially." : "Select the skills that you will initially possess."}
      </FlowText>
      <Fixed y={19} h={180}>
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
          Add &gt;&gt;
        </Button>
        <Button at={[127, 78, 58, 14]} disabled={!cur2} onClick={() => remove()}>
          &lt;&lt; Remove
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
      </Fixed>
      {kind === "Spells" && (
        <FlowText x={57} w={210} minH={13}>
          Shal'ille (good) and Qor (evil) spells cannot be chosen together.
        </FlowText>
      )}
      <Spacer />
      <Fixed y={212} h={16}>
        <Text at={[13, 215, 72, 8]}>Spell/skill points left</Text>
        <GraphBar at={[87, 214, 98, 11]} kind="points" label="Spell/skill points left" min={0} max={SPELL_POINTS} value={points} />
        {children}
      </Fixed>
    </FlowPage>
  );
}
