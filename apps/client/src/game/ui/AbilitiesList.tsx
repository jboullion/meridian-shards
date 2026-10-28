// Ours (docs/adr/0028-abilities-tab.md): the Abilities tab, the original's Spells and Skills
// lists (statlist.c) together, by school. Each school we know folds to a summary: its level and
// how far its next level is ("Faren 4: 168 of 213"), as our server reckons it (UC_SCHOOLS,
// @shards/world schools.ts, the trainers' own reckoning). Open, it lists that school's spells or
// skills, lowest level first, with a mark on the three that count toward the next level. Which
// schools are open is kept for each character. The rows behave as the old lists' did: a click
// selects, a double click casts a spell (or looks at a skill), a right click looks, spells drag
// to the quick slots and show their range ring, and every spell has its own Cast. (Study mode is
// under the ☰ menu's Actions.)

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { STAT_GROUP, type Statistic } from "@shards/protocol";
import { SCHOOL_STATE, SCHOOL_WEAPONCRAFT, schoolsCommand, type GameSession, type SchoolProgress } from "@shards/world";
import { gameSocketUrl } from "../../host.ts";
import { bareIcon, type IconRenderer } from "../icons.ts";
import { DRAG_SPELL } from "../quickSlots.ts";
import { useWorld } from "./hooks.ts";
import { ObjIcon } from "./Sidebar.tsx";

/** blakston.khd SS_* and SKS_*: the schools' names, in the order the tab shows them */
const SCHOOL_NAMES: [number, string][] = [
  [SCHOOL_WEAPONCRAFT, "Weaponcraft"],
  [1, "Shal'ille"],
  [2, "Qor"],
  [3, "Kraanan"],
  [4, "Faren"],
  [5, "Riija"],
  [6, "Jala"],
];
/** Brawling, thievery and anything else: one group, with no next level */
const OTHER = -1;

interface Row {
  stat: Statistic;
  id: number;
  spell: boolean;
  level: number;
  counts: boolean;
}

const storageKey = (character: string) => `shards.abilities.${gameSocketUrl()}.${character.toLowerCase()}`;

function loadOpen(character: string): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(character));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((n): n is number => typeof n === "number") : []);
  } catch {
    return new Set();
  }
}

function saveOpen(character: string, open: Set<number>): void {
  try {
    localStorage.setItem(storageKey(character), JSON.stringify([...open]));
  } catch {
    // storage unavailable: kept for this session
  }
}

/** The summary's words for a school's next level */
function progressText(name: string, p: SchoolProgress, spells: boolean): { label: string; line: string; tip: string; tone: "" | " ready" | " stuck" } {
  const below = `your three best ${name} ${p.level} ${spells ? "spells" : "skills"}`;
  switch (p.state) {
    case SCHOOL_STATE.READY:
      return { label: `${name} ${p.next} ready`, line: "Find a trainer to learn it", tip: `You can learn ${name} ${p.next} from a trainer now.`, tone: " ready" };
    case SCHOOL_STATE.SHORT:
      return {
        label: `${name} ${p.next}: ${p.have} of ${p.need}`,
        line: `${p.need - p.have} more in ${below}`,
        tip: `${below[0].toUpperCase()}${below.slice(1)} add up to ${p.have}. Raise them to ${p.need} to learn ${name} ${p.next}: use them, or train them. Higher Intellect lowers this; new levels in other schools raise it.`,
        tone: "",
      };
    case SCHOOL_STATE.IMPOSSIBLE:
      return {
        label: "Out of reach",
        line: `${name} ${p.next} needs ${p.need}, more than ${below} can reach`,
        tip: `Your levels in other schools have put ${name} ${p.next} out of reach. Higher Intellect lowers what it needs.`,
        tone: " stuck",
      };
    default:
      return { label: "Mastered", line: "", tip: `You know ${name}'s highest level.`, tone: " ready" };
  }
}

export function AbilitiesList({
  session, icons, onLook, onCast,
}: {
  session: GameSession;
  icons: IconRenderer;
  onLook: (id: number) => void;
  onCast: (spell: number, numTargets: number) => void;
}) {
  const world = session.world;
  useWorld(world, ["stats", "spells", "skills", "schools"]);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const rs = (id: number) => session.resource(id) ?? "";
  const character = world.self ? rs(world.self.info.nameRes) : "";
  // The schools open, as this character left them (changed here, or read for a new character)
  const stored = useMemo(() => (character ? loadOpen(character) : new Set<number>()), [character]);
  const [changed, setChanged] = useState<{ character: string; open: Set<number> } | null>(null);
  const open = changed?.character === character ? changed.open : stored;
  // Sent at logon and after every change; ask if it hasn't come
  useEffect(() => {
    if (!world.schools) session.shardsCommand(schoolsCommand());
  }, [session, world]);

  const schools = world.schools;
  const spellFor = (id: number) => world.spells.find((s) => s.object.id === id);
  const placed = useMemo(() => new Map((schools?.abilities ?? []).map((a) => [a.id, a])), [schools]);
  const known = new Set(SCHOOL_NAMES.map(([n]) => n));

  // Each spell and skill, in its school
  const groups = new Map<number, Row[]>();
  const add = (stat: Statistic, spell: boolean) => {
    const id = stat.list?.id;
    if (!id) return;
    const at = placed.get(id);
    // Before UC_SCHOOLS arrives: spells by their school (BP_SPELLS, 0-based), skills under weaponcraft
    const school = at ? at.school : spell ? (spellFor(id)?.school ?? -2) + 1 : SCHOOL_WEAPONCRAFT;
    const key = known.has(school) ? school : OTHER;
    const list = groups.get(key) ?? [];
    list.push({ stat, id, spell, level: at?.level ?? 0, counts: !!at?.counts });
    groups.set(key, list);
  };
  for (const s of world.stats.get(STAT_GROUP.SPELLS) ?? []) add(s, true);
  for (const s of world.stats.get(STAT_GROUP.SKILLS) ?? []) add(s, false);

  const wanted = search.trim().toLowerCase();
  const matches = (r: Row) => !wanted || rs(r.stat.nameRes).toLowerCase().includes(wanted);
  const toggle = (key: number) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChanged({ character, open: next });
    if (character) saveOpen(character, next);
  };

  const row = (r: Row, marks: boolean): ReactNode => {
    const l = r.stat.list!;
    const name = rs(r.stat.nameRes);
    return (
      <div
        key={r.id}
        className={`stat-list-row ability-row${selected === r.id ? " selected" : ""}`}
        onClick={() => setSelected(r.id)}
        // A spell's range ring shows about us while the mouse is on it (the spell revamp, V5)
        onPointerEnter={(e) => {
          if (r.spell && e.pointerType === "mouse") session.pointAtSpell(r.id);
        }}
        onPointerLeave={() => r.spell && session.pointAtSpell(null)}
        // A spell dragged onto a quick slot fills it (QuickSlots.tsx Hotbar)
        draggable={r.spell}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_SPELL, String(r.id));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => (r.spell ? onCast(r.id, spellFor(r.id)?.numTargets ?? 0) : onLook(r.id))}
        // statlist.c StatsListRButton: look at it
        onContextMenu={(e) => {
          e.preventDefault();
          setSelected(r.id);
          onLook(r.id);
        }}
      >
        <span className={marks && r.counts ? "ability-counts" : "ability-counts none"} title={marks && r.counts ? "Counts toward this school's next level" : undefined} aria-hidden />
        <ObjIcon icons={icons} object={l.icon ? bareIcon(l.icon) : null} className="list-icon" />
        <span className="stat-list-name">{`${name} ${l.value}%`}</span>
        {r.spell ? (
          <button
            type="button"
            className="mk-btn spell-cast"
            title={`Cast ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onCast(r.id, spellFor(r.id)?.numTargets ?? 0);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            Cast
          </button>
        ) : null}
      </div>
    );
  };

  const order: [number, string][] = [...SCHOOL_NAMES, [OTHER, "Other skills"]];
  const shown: ReactNode[] = [];
  for (const [key, name] of order) {
    const rows = (groups.get(key) ?? []).filter(matches);
    if (!rows.length) continue;
    const p = schools?.schools.find((s) => s.school === key) ?? null;
    const isOpen = wanted ? true : open.has(key);
    const text = p ? progressText(name, p, key !== SCHOOL_WEAPONCRAFT) : null;
    const fill = p && p.need > 0 ? Math.min(100, Math.round((100 * p.have) / p.need)) : p?.state === SCHOOL_STATE.MAX ? 100 : 0;
    // Lowest level first, then by name
    rows.sort((a, b) => a.level - b.level || rs(a.stat.nameRes).localeCompare(rs(b.stat.nameRes)));
    // Levels and the counting three only where there's a next level to work toward (not Other)
    const marks = !!p && p.state !== SCHOOL_STATE.MAX;
    const body: ReactNode[] = [];
    let level = -1;
    for (const r of rows) {
      if (key !== OTHER && r.level !== level && r.level > 0) body.push(<div key={`level-${r.level}`} className="ability-level">Level {r.level}</div>);
      level = r.level;
      body.push(row(r, marks));
    }
    shown.push(
      <section key={key} className={`ability-school${isOpen ? " open" : ""}`}>
        <button type="button" className="ability-school-head" aria-expanded={isOpen} title={text?.tip} onClick={() => !wanted && toggle(key)}>
          <span className="ability-school-name">
            <span className="ability-chevron" aria-hidden>{isOpen ? "▾" : "▸"}</span>
            {p ? `${name} ${p.level}` : name}
          </span>
          {text && <span className={`ability-school-next${text.tone}`}>{text.label}</span>}
        </button>
        {p && p.state !== SCHOOL_STATE.MAX && (
          <div className={`ability-bar${text?.tone ?? ""}`} aria-hidden>
            <i style={{ width: `${fill}%` }} />
          </div>
        )}
        {text?.line && <div className="ability-school-line">{text.line}</div>}
        {isOpen && <div className="ability-school-body">{body}</div>}
      </section>,
    );
  }

  return (
    <div className="stat-list abilities-list">
      <div className="spell-search">
        <span className="mk-edit">
          <input
            type="search"
            value={search}
            placeholder="Search abilities"
            spellCheck={false}
            aria-label="Search abilities"
            onChange={(e) => setSearch(e.target.value)}
            // Esc empties it, then gives the keys back to the game
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              if (search) setSearch("");
              else e.currentTarget.blur();
            }}
          />
        </span>
      </div>
      {shown.length ? shown : <div className="stat-list-row muted">{wanted ? "No abilities match" : "—"}</div>}
      {schools && !wanted && (
        <div className="ability-footer">
          Learn points {schools.learnPoints} · your Intellect takes {schools.intellectHelp} off every need
        </div>
      )}
    </div>
  );
}
