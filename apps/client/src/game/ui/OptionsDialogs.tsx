// The options windows behind the game's menu (GameView's ☰): Preferences, Configuration
// and Actions, each laid out like the original client's:
//   Preferences     client.rc IDD_SETTINGS (maindlg.c PreferencesDialogProc), without Web Browser
//   Configuration   the Bind Editor (m59bind.exe): six tabs of keys, Options, Restore Defaults
//   Actions         merintr actions.c without the emotes: Who (msgfiltr.c IDD_WHO), groups
//                   (groupdlg.c IDD_GROUP), hotkey and command aliases (alias.c IDD_ALIAS,
//                   IDD_CMDALIAS), guild configuration
// Options and Configuration edit a copy and apply it on OK, like the originals; Cancel
// keeps what was there.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CF } from "@shards/protocol";
import type { AmbientLevel, GameSession } from "@shards/world";
import {
  ACTION_LABELS, ACTION_TABS, DEFAULT_SETTINGS, PRESETS, bindingLabel, mouseCode, presetSettings,
  type Action, type ActionTab, type HaloColor, type HotkeyAlias, type KeyBinding, type Settings,
} from "../settings.ts";
import type { AudioPreview } from "../audio.ts";
import { MAX_PROFANE_TERM } from "@shards/world";
import { profanity, saveProfanity } from "../profanity.ts";
import { Button, Check, GroupBox, ListBox, Select, Tabs, Text, TextField, Trackbar, Window, at, type Rect } from "./kit.tsx";
import { DEFAULT_REST_REGEN, castsFromReagents, formatDuration, studyEstimate, type StudyConfig, type StudyMemory, type StudySpellInfo } from "../study.ts";

type Patch = Partial<Settings>;

/** Modal like the originals: over the whole window, and the game takes no keys meanwhile. */
function Modal({ children }: { children: ReactNode }) {
  return <div className="mk-modal options-modal">{children}</div>;
}

/** A dialog laid out in dialog units, scaled to fit the window. */
function DluDialog({
  title, size, wide, onClose, children,
}: {
  title: string;
  size: readonly [number, number];
  /** Wider on a phone (kit.tsx Window wide), whose wider font crowds the template */
  wide?: boolean | number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal>
      <Window title={title} dlu={size} wide={wide} onClose={onClose} className="options-dialog">
        {children}
      </Window>
    </Modal>
  );
}

/** The players logged on now (BP_ADD_PLAYER / BP_REMOVE_PLAYER), sorted by name. */
function usePlayers(session: GameSession): { id: number; name: string }[] {
  const [version, setVersion] = useState(0);
  useEffect(() => session.world.on((e) => e.type === "players" && setVersion((v) => v + 1)), [session]);
  return useMemo(
    () => [...session.world.players.values()].map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, version],
  );
}

// ---------------------------------------------------------------------------- Preferences

/** The game options the server keeps (IDD_SETTINGS Game Options and "Can attack innocent players"). */
const SERVER_OPTIONS = [
  ["Receive temporary angel on death", CF.TEMPSAFE, [15, 116, 123, 9]],
  ["Join building groups", CF.GROUPING, [192, 116, 75, 9]],
  ["Autoloot stackable items from kills", CF.AUTOLOOT, [15, 128, 123, 9]],
  ["Autocombine spell items", CF.AUTOCOMBINE, [192, 128, 90, 9]],
  ["Stash things into the appropriate bag automatically", CF.BAGS, [15, 140, 170, 9]],
  ["Display spellpower for spells cast", CF.SPELLPOWER, [192, 140, 119, 9]],
] as const;

/** Options the client keeps but doesn't do anything with yet (docs/missing-features.md). */
const NOT_YET = "Not in Meridian Shards yet; the setting is kept for when it is";

/**
 * client.rc IDD_SETTINGS (375 x 316 DLU) without the Web Browser group, so 288 tall.
 * `serverFlags` is the server's CF_* preferences (null until UC_RECEIVE_PREFERENCES).
 */
export function PreferencesDialog({
  settings, serverFlags, onApply, onPreview, onClose,
}: {
  settings: Settings;
  serverFlags: number | null;
  onApply: (patch: Patch, serverFlags: number | null) => void;
  /** Hear the Audio Effects choices while the window is open; null when it closes */
  onPreview?: (audio: AudioPreview | null) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Settings>(settings);
  // The music and sound change as you choose (the original waits for OK); Cancel undoes it
  const { music, musicVolume, sound, soundVolume, loopSounds, randomSounds } = d;
  useEffect(() => {
    onPreview?.({ music, musicVolume, sound, soundVolume, loopSounds, randomSounds });
  }, [onPreview, music, musicVolume, sound, soundVolume, loopSounds, randomSounds]);
  useEffect(() => () => onPreview?.(null), [onPreview]);
  const [flags, setFlags] = useState(serverFlags ?? 0);
  const [profanityOpen, setProfanityOpen] = useState(false);
  const set = (patch: Patch) => setD((s) => ({ ...s, ...patch }));
  const flag = (f: number, on: boolean) => setFlags((v) => (on ? v | f : v & ~f));
  const known = serverFlags !== null;
  const check = (label: string, r: Rect, key: keyof Settings, notYet = false) => (
    <Check at={r} label={label} title={notYet ? NOT_YET : undefined} className={notYet ? "not-yet" : undefined} checked={d[key] as boolean} onChange={(v) => set({ [key]: v } as Patch)} />
  );
  const halo = (label: string, color: HaloColor, r: Rect) => (
    <Check at={r} radio name="halo" label={label} checked={d.haloColor === color} onChange={() => set({ haloColor: color })} />
  );
  const ok = (e: FormEvent) => {
    e.preventDefault();
    onApply(d, known && flags !== serverFlags ? flags : null);
    onClose();
  };
  return (
    <>
      {/* On a phone, 30% wider: its font crowded the template's labels into each other */}
      <DluDialog title="Preferences" size={[375, 288]} wide={1.3} onClose={onClose}>
        <form onSubmit={ok}>
          <GroupBox at={[6, 3, 91, 67]} label="Targeting" />
          <Check
            at={[16, 14, 73, 17]}
            className="wrap"
            label="Can attack innocent players"
            title={known ? "Kept on the server" : "Waiting for the server"}
            disabled={!known}
            checked={(flags & CF.SAFETY_OFF) !== 0}
            onChange={(v) => flag(CF.SAFETY_OFF, v)}
          />
          {halo("Red Highlight", "red", [16, 34, 70, 10])}
          {halo("Blue Highlight", "blue", [16, 45, 70, 10])}
          {halo("Green Highlight", "green", [16, 56, 70, 10])}

          <GroupBox at={[108, 3, 262, 67]} label="Special Effects" />
          {check("Show your pain when you get hurt", [117, 16, 122, 9], "pain")}
          {check("Draw player names over their heads", [117, 28, 125, 9], "drawPlayerNames")}
          {check("Draw NPC names over their heads", [117, 40, 122, 9], "drawNpcNames")}
          {check("Draw sign headings on top of signs", [117, 52, 131, 9], "drawSignNames")}
          {check("Show amounts for inventory items", [247, 16, 120, 9], "inventoryNumbers")}
          {check('"Bounce" as you walk', [247, 28, 93, 9], "bounce")}
          {check("Show targeting light effect", [247, 40, 98, 9], "targetLight")}

          <GroupBox at={[6, 71, 364, 31]} label="Particle effects" />
          {check("Show weather effects", [18, 84, 91, 9], "weather")}
          <Text at={[121, 84, 56, 10]}>Particle density %</Text>
          <Trackbar at={[181, 78, 179, 18]} min={25} max={150} step={5} value={d.particleDensity} onChange={(v) => set({ particleDensity: v })} label="Particle density" />

          <GroupBox at={[6, 103, 364, 55]} label="Game Options" />
          {SERVER_OPTIONS.map(([label, f, r]) => (
            <Check
              key={f}
              at={r}
              label={label}
              title={known ? "Kept on the server" : "Waiting for the server"}
              disabled={!known}
              checked={(flags & f) !== 0}
              onChange={(v) => flag(f, v)}
            />
          ))}

          <GroupBox at={[6, 160, 364, 45]} label="Audio Effects" />
          {check("Music", [17, 173, 35, 9], "music")}
          {check("Sounds", [17, 188, 44, 9], "sound")}
          {/* maindlg.c: Steady and Atmospheric Sounds only with Sounds on */}
          <Check at={[61, 172, 64, 9]} label="Steady Sounds" disabled={!d.sound} checked={d.loopSounds} onChange={(v) => set({ loopSounds: v })} />
          <Check at={[61, 187, 80, 9]} label="Atmospheric Sounds" disabled={!d.sound} checked={d.randomSounds} onChange={(v) => set({ randomSounds: v })} />
          {/* The original has Sound volume on top; ours sit beside their checkboxes (Music, then Sounds) */}
          <Text at={[161, 173, 50, 10]}>Music volume</Text>
          <Trackbar at={[217, 170, 147, 15]} min={0} max={100} value={d.musicVolume} onChange={(v) => set({ musicVolume: v })} label="Music volume" ticks={false} />
          <Text at={[161, 189, 53, 10]}>Sound volume</Text>
          <Trackbar at={[217, 186, 147, 15]} min={0} max={100} value={d.soundVolume} onChange={(v) => set({ soundVolume: v })} label="Sound volume" ticks={false} />

          <GroupBox at={[6, 207, 364, 57]} label="Interface Features" />
          {check("Show toolbar", [15, 218, 62, 9], "toolbar")}
          {check("Show tooltips", [15, 228, 62, 9], "tooltips")}
          {check("Lock text window in place when scrolling back", [15, 239, 159, 9], "scrollLock")}
          {check("Add chat timestamps", [15, 250, 77, 9], "chatTimestamps")}
          {check("Show latency meter", [91, 218, 77, 9], "latencyMeter")}
          {check("Show dynamic map", [91, 228, 79, 10], "dynamicMap")}
          {check("Show colored text", [179, 218, 69, 10], "coloredText")}
          {check("Map annotations", [179, 228, 72, 10], "mapAnnotations")}
          {check("Show FPS", [179, 239, 50, 9], "showFps")}
          {check("Display XP as percent", [254, 218, 87, 9], "xpAsPercent")}
          {check("Filter text profanity", [254, 228, 77, 9], "profanityFilter")}
          <Button at={[253, 239, 110, 12]} onClick={() => setProfanityOpen(true)}>
            Profanity Options and Policy...
          </Button>

          <Button at={[131, 272, 50, 12]} type="submit" isDefault>
            OK
          </Button>
          <Button at={[193, 272, 50, 12]} onClick={onClose}>
            Cancel
          </Button>
        </form>
      </DluDialog>
      {profanityOpen && (
        <ProfanityDialog
          ignore={d.profanityIgnore}
          extra={d.profanityExtra}
          onDone={(ignore, extra) => set({ profanityIgnore: ignore, profanityExtra: extra })}
          onClose={() => setProfanityOpen(false)}
        />
      )}
    </>
  );
}

/**
 * maindlg.c ProfanityDialogProc (client.rc IDC_PROFANESETTINGS): ignore or obscure, the
 * extra search, and adding or removing a term (kept at once, as SaveProfaneTerms does).
 * The two options go to the Preferences window, applied with its OK.
 */
function ProfanityDialog({
  ignore: initialIgnore, extra: initialExtra, onDone, onClose,
}: {
  ignore: boolean;
  extra: boolean;
  onDone: (ignore: boolean, extra: boolean) => void;
  onClose: () => void;
}) {
  const [ignore, setIgnore] = useState(initialIgnore);
  const [extra, setExtra] = useState(initialExtra);
  const [term, setTerm] = useState("");
  const edit = (add: boolean) => {
    if (add) profanity.add(term);
    else profanity.remove(term);
    saveProfanity();
    setTerm("");
  };
  return (
    <DluDialog title="Profanity Filter Settings" size={[321, 201]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(ignore, extra);
          onClose();
        }}
      >
        <GroupBox at={[4, 4, 229, 56]} label="Options" />
        <Check at={[11, 15, 215, 10]} radio name="profane" label="Ignore any message containing recognized profane terms" checked={ignore} onChange={() => setIgnore(true)} />
        <Check at={[11, 27, 215, 10]} radio name="profane" label="Obscure all recognized profane terms with symbols ($@#!&)" checked={!ignore} onChange={() => setIgnore(false)} />
        <Check at={[11, 44, 215, 10]} label="Extra search for suspected embedded profanity" checked={extra} onChange={setExtra} />
        <Text at={[241, 16, 20, 8]}>Word:</Text>
        <TextField at={[271, 14, 46, 12]} value={term} onChange={setTerm} maxLength={MAX_PROFANE_TERM} />
        <Button at={[241, 30, 76, 11]} onClick={() => edit(true)}>
          Add as Profane Term
        </Button>
        <Button at={[241, 43, 76, 11]} onClick={() => edit(false)}>
          Remove Term
        </Button>
        <GroupBox at={[4, 66, 313, 108]} label="About Objectionable Language" />
        <Text at={[10, 77, 300, 25]} wrap>
          The profanity filter option in Meridian Shards is intended to allow you to make your own choices about objectionable language. You can decide to ignore or
          filter the incoming text, or to allow incoming text to be shown fully.
        </Text>
        <Text at={[10, 104, 300, 26]} wrap>
          No software filter can stop all profanity without severely limiting other communication. The filter will find thoughtless uses of words and will render them
          unreadable. It will not stop every form of objectionable material that can be typed.
        </Text>
        <Text at={[10, 132, 300, 18]}>Play nice!</Text>
        <Text at={[10, 152, 300, 18]}>---Zaphod</Text>
        <Button at={[206, 183, 50, 14]} type="submit" isDefault>
          OK
        </Button>
        <Button at={[267, 183, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
      </form>
    </DluDialog>
  );
}

/**
 * logoff.c TimeoutDialogProc (client.rc IDD_TIMEOUT): log off after so many minutes without
 * a key or a click.
 */
export function LogoutTimerDialog({ settings, iconUrl, onApply, onClose }: { settings: Settings; iconUrl: string; onApply: (patch: Patch) => void; onClose: () => void }) {
  const [enabled, setEnabled] = useState(settings.logoutTimer && settings.logoutMinutes > 0);
  const [minutes, setMinutes] = useState(String(settings.logoutMinutes));
  return (
    <DluDialog title="Logout timer" size={[149, 81]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // IDOK: the typed minutes (at least 0), and on or off
          onApply({ logoutMinutes: Math.max(Number.parseInt(minutes, 10) || 0, 0), logoutTimer: enabled });
          onClose();
        }}
      >
        <img src={iconUrl} alt="" style={at([8, 7, 18, 20])} className="mk-login-icon" />
        <Check at={[47, 13, 74, 10]} label="Enable logout timer" checked={enabled} onChange={setEnabled} />
        <Text at={[8, 37, 46, 8]}>Disconnect after</Text>
        <TextField at={[47, 35, 33, 14]} value={minutes} onChange={(v) => setMinutes(v.replace(/\D/g, ""))} maxLength={5} disabled={!enabled} />
        <Text at={[87, 37, 55, 8]}>minutes idle time</Text>
        <Button at={[21, 61, 45, 14]} type="submit" isDefault>
          OK
        </Button>
        <Button at={[82, 61, 45, 14]} onClick={onClose}>
          Cancel
        </Button>
      </form>
    </DluDialog>
  );
}

/** A spell Study can practise: its English name (spelltimes.json's key), the name shown, its data */
export interface StudySpell {
  key: string;
  label: string;
  info: StudySpellInfo | undefined;
}

/**
 * Study (ours; study.ts): practise a spell while away. Pick the spell and how many times; the
 * window says how many casts the reagents we carry are enough for, and about how long it takes.
 */
export function StudyDialog({
  spells, carried, mana, maxMana, memory, onStart, onClose,
}: {
  spells: StudySpell[];
  /** How much of each item we carry, by English name in lower case */
  carried: ReadonlyMap<string, number>;
  mana: number;
  maxMana: number;
  /** The last choices, and the rate this character's mana comes back resting */
  memory: StudyMemory;
  onStart: (config: StudyConfig) => void;
  onClose: () => void;
}) {
  const [spell, setSpell] = useState<string | null>(() => spells.find((s) => s.key === memory.spell)?.key ?? spells[0]?.key ?? null);
  const [untilOut, setUntilOut] = useState(memory.count === null);
  const [count, setCount] = useState(String(memory.count ?? 10));
  const [logOff, setLogOff] = useState(memory.logOff);
  const chosen = spells.find((s) => s.key === spell);
  const wanted = untilOut ? null : Math.max(Number.parseInt(count, 10) || 0, 0);
  let note: string;
  let ready = false;
  if (!chosen) note = "You don't know any spells yet.";
  else if (!chosen.info) note = "There's no data for this spell in the game files: rebuild the assets.";
  else if (maxMana > 0 && maxMana < chosen.info.mana) note = `${chosen.label} needs ${chosen.info.mana} mana, more than you can hold.`;
  else if (wanted === 0) note = "Cast it how many times?";
  else {
    const info = chosen.info;
    const known = info.reagents !== undefined;
    const reagentCasts = castsFromReagents(info, (n) => carried.get(n) ?? 0);
    const est = studyEstimate(info, wanted, reagentCasts, mana, maxMana, memory.regen ?? DEFAULT_REST_REGEN);
    const reagents = !known ? "Reagents unknown (rebuild the assets)." : reagentCasts === null ? "Needs no reagents." : `Reagents for ${reagentCasts} cast${reagentCasts === 1 ? "" : "s"}.`;
    const then = logOff ? "then log off" : "then stop";
    if (reagentCasts === 0) note = `${reagents} You have none for ${chosen.label}.`;
    else if (est.casts === null) note = `${reagents} Casts it until you stop it.`;
    else {
      const guess = memory.regen === null && est.casts * info.mana > mana ? " (a guess until you've rested once)" : "";
      note = `${reagents} ${est.casts} cast${est.casts === 1 ? "" : "s"}, ${formatDuration(est.seconds ?? 0)}${guess}, ${then}.`;
    }
    ready = reagentCasts !== 0;
  }
  return (
    <DluDialog title="Study" size={[190, 168]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && chosen) onStart({ spell: chosen.key, count: wanted, logOff });
        }}
      >
        <Text at={[8, 6, 174, 8]}>Practise a spell while you're away:</Text>
        <ListBox
          at={[8, 16, 174, 70]}
          label="Spells"
          items={spells.map((s) => ({ key: s.key, label: s.label }))}
          selected={spell}
          onSelect={setSpell}
          autoFocus
        />
        <Text at={[8, 93, 40, 8]}>Cast it</Text>
        <TextField at={[40, 91, 30, 14]} value={count} onChange={(v) => setCount(v.replace(/\D/g, ""))} maxLength={5} disabled={untilOut} />
        <Text at={[74, 93, 20, 8]}>times</Text>
        <Check at={[100, 93, 82, 10]} label="Until out of reagents" checked={untilOut} onChange={setUntilOut} />
        <Check at={[8, 108, 174, 10]} label="Log off when done" checked={logOff} onChange={setLogOff} />
        <Text at={[8, 121, 174, 24]} wrap className="study-note">
          {note}
        </Text>
        <Button at={[38, 148, 50, 14]} type="submit" isDefault disabled={!ready}>
          Start
        </Button>
        <Button at={[102, 148, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
      </form>
    </DluDialog>
  );
}

// ---------------------------------------------------------------------------- Configuration

/** What Enhanced Lighting (ours, settings.enhanced) does, for its tooltip */
const ENHANCED_TITLE =
  "Soft highlights, flickering and glowing flames, light that stops at walls, shaded corners, shadows and a vignette; off, the original's look";

const AMBIENT_TITLE = "Townsfolk walking the streets and patrons in the inns, seen by you alone";
const PETS_TITLE = "Other players' pets following them (your own always shows: choose No pet in the Pets tab to hide it)";
const PET_NAMES_TITLE = "The names under pets";
const CRITTERS_TITLE = "Rats, spiders, centipedes and other small creatures scurrying about, killed with a click; seen by you alone, with no experience or loot";
const FLYERS_TITLE = "Flocks of birds crossing the sky by day, and bats in caves (and out at night); seen by you alone";
const GROUND_TITLE = "Tufts of grass, flowers, pebbles and stones on the ground outdoors and in caves";
const NATURE_TITLE = "Butterflies by day, fireflies at night, leaves falling in the woods and fish leaping in lakes and rivers; seen by you alone";
const AMBIENT_OPTIONS = [
  { key: "off", label: "Off" },
  { key: "few", label: "Few" },
  { key: "normal", label: "Normal" },
  { key: "many", label: "Many" },
] as const;

/** Ours: how many townsfolk and inn patrons (Ambient Life) */
const FRAME_LIMIT_TITLE = "Draw at most 60 frames a second on a faster screen: cooler, quieter and kinder to batteries";
const AMBIENT_SOUNDS_TITLE = "The townsfolk's chatter, the arena's crowd, distant thunder, birds and critters: sounds of our own, under the Sound Volume";

/** Ours: Ambient Sounds, and how loud */
function AmbientSoundsOption({ d, set }: { d: Settings; set: (patch: Patch) => void }) {
  return (
    <>
      <Check label="Ambient Sounds" title={AMBIENT_SOUNDS_TITLE} checked={d.ambientSounds} onChange={(v) => set({ ambientSounds: v })} />
      <label className={d.ambientSounds ? "hud-scale ambient-volume" : "hud-scale ambient-volume disabled"} title="How loud the ambient sounds are, under the Sound Volume">
        <span>Volume</span>
        <Trackbar min={0} max={100} step={5} value={d.ambientVolume} onChange={(v) => set({ ambientVolume: v })} label="Ambient volume" />
        <span className="bind-scale-value">{d.ambientVolume}%</span>
      </label>
    </>
  );
}

function AmbientLifeSelect({ value, onChange }: { value: AmbientLevel; onChange: (v: AmbientLevel) => void }) {
  return (
    <label className="ambient-life" title={AMBIENT_TITLE}>
      <span>Ambient Life</span>
      <Select value={value} options={AMBIENT_OPTIONS} onChange={onChange} />
    </label>
  );
}

/** The Bind Editor's tabs: its Options box first (ours: a tab, for room), then the keys and the mouse */
const CONFIG_TABS = ["Options", ...(Object.keys(ACTION_TABS) as ActionTab[]), "Mouse"] as const;
type ConfigTab = (typeof CONFIG_TABS)[number];

const MODIFIER_CODES = new Set(["AltLeft", "AltRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]);

/**
 * Waits for a key, a key with Alt or Ctrl, a modifier on its own (released without another
 * key, like the original preset's Ctrl to attack) or a mouse button. Esc cancels.
 */
function useKeyListener(active: boolean, onKey: (b: KeyBinding | null) => void): void {
  useEffect(() => {
    if (!active) return;
    let pendingModifier: string | null = null;
    const done = (b: KeyBinding | null) => {
      onKey(b);
    };
    const keydown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_CODES.has(e.code)) {
        pendingModifier = e.code;
        return;
      }
      pendingModifier = null;
      if (e.code === "Escape" && !e.altKey && !e.ctrlKey) return done(null);
      done({ code: e.code, ...(e.altKey ? { alt: true } : {}), ...(e.ctrlKey ? { ctrl: true } : {}) });
    };
    const keyup = (e: KeyboardEvent) => {
      if (pendingModifier && e.code === pendingModifier) done({ code: pendingModifier });
    };
    const mousedown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      done({ code: mouseCode(e.button), ...(e.altKey ? { alt: true } : {}), ...(e.ctrlKey ? { ctrl: true } : {}) });
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    // A tick later, so the click that started listening isn't taken as the binding
    const t = setTimeout(() => {
      window.addEventListener("keydown", keydown, true);
      window.addEventListener("keyup", keyup, true);
      window.addEventListener("mousedown", mousedown, true);
      window.addEventListener("contextmenu", noMenu, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("mousedown", mousedown, true);
      window.removeEventListener("contextmenu", noMenu, true);
    };
  }, [active, onKey]);
}

/** The Bind Editor (m59bind.exe) without Classic Key Binding and Software Renderer. */
export function ConfigurationDialog({ settings, onApply, onClose }: { settings: Settings; onApply: (patch: Patch) => void; onClose: () => void }) {
  const [d, setD] = useState<Settings>(settings);
  const [tab, setTab] = useState<ConfigTab>("Options");
  const [listening, setListening] = useState<{ action: Action; index: number } | null>(null);
  const set = (patch: Patch) => setD((s) => ({ ...s, ...patch }));
  const onKey = useMemo(
    () => (b: KeyBinding | null) => {
      setListening((l) => {
        if (l && b) {
          setD((s) => {
            const list = [...s.keys[l.action]];
            list.splice(l.index, 1, b);
            return { ...s, keys: { ...s.keys, [l.action]: list } };
          });
        }
        return null;
      });
    },
    [],
  );
  useKeyListener(listening !== null, onKey);
  const remove = (a: Action, i: number) => set({ keys: { ...d.keys, [a]: d.keys[a].filter((_, j) => j !== i) } });
  const scale = (label: string, key: "mouseXScale" | "mouseYScale") => (
    <label className="bind-scale">
      <span>{label}</span>
      <Trackbar min={1} max={30} value={d[key]} onChange={(v) => set({ [key]: v })} label={label} />
      <span className="bind-scale-value">{d[key]}</span>
    </label>
  );
  return (
    <Modal>
      <Window title="Bind Editor" onClose={() => !listening && onClose()} className="options-dialog bind-editor">
        <div className="bind-layout">
          <Tabs tabs={CONFIG_TABS} active={tab} onChange={setTab} />
          <div className="mk-page bind-page">
            {tab === "Options" ? (
              <div className="bind-options">
                <GroupBox label="Playing" className="flow">
                  <Check label="Quick Chat" checked={d.typeToChat} onChange={(v) => set({ typeToChat: v })} />
                  <Check label="Always Run" checked={d.alwaysRun} onChange={(v) => set({ alwaysRun: v })} />
                  <Check label="Attack On Target" checked={d.attackOnTarget} onChange={(v) => set({ attackOnTarget: v })} />
                  <Check
                    label="Original Command Typing"
                    title="Every typed line is a command, as in the original: speech needs say, and the start of a command's name will do"
                    checked={d.originalCommands}
                    onChange={(v) => set({ originalCommands: v })}
                  />
                </GroupBox>
                <GroupBox label="World" className="flow">
                  <Check label="Dynamic Lighting" checked={d.dynamicLighting} onChange={(v) => set({ dynamicLighting: v })} />
                  <Check label="Ground Detail" title={GROUND_TITLE} checked={d.groundDetail} onChange={(v) => set({ groundDetail: v })} />
                  {/* Ours: Enhanced Lighting, or the original's look */}
                  <Check label="Enhanced Lighting" title={ENHANCED_TITLE} checked={d.enhanced} onChange={(v) => set({ enhanced: v })} />
                  <Check label="Damage Numbers" checked={d.damageNumbers} onChange={(v) => set({ damageNumbers: v })} />
                  <Check label="Limit to 60 FPS" title={FRAME_LIMIT_TITLE} checked={d.frameLimit} onChange={(v) => set({ frameLimit: v })} />
                  <AmbientLifeSelect value={d.ambientLife} onChange={(v) => set({ ambientLife: v })} />
                  <Check label="Critters" title={CRITTERS_TITLE} checked={d.critters} onChange={(v) => set({ critters: v })} />
                  <Check label="Birds and Bats" title={FLYERS_TITLE} checked={d.flyers} onChange={(v) => set({ flyers: v })} />
                  <Check label="Nature" title={NATURE_TITLE} checked={d.nature} onChange={(v) => set({ nature: v })} />
                  <AmbientSoundsOption d={d} set={set} />
                  <Check label="Show Pets" title={PETS_TITLE} checked={d.showPets} onChange={(v) => set({ showPets: v })} />
                  <Check label="Show Pet Names" title={PET_NAMES_TITLE} checked={d.showPetNames} onChange={(v) => set({ showPetNames: v })} />
                </GroupBox>
                <GroupBox label="Interface" className="flow">
                  {/* Ours: the HUD over the whole view, or the original's interface column */}
                  <Check
                    label="Modern Interface"
                    title="The view fills the window with the bars, quick slots, map and chat over it; off, the original's layout"
                    checked={d.interfaceStyle === "modern"}
                    onChange={(v) => set({ interfaceStyle: v ? "modern" : "classic" })}
                  />
                  <Check
                    label="Second Hotbar"
                    title="A second row of quick slots (11-20) above the first, on the numpad's keys (Modern interface)"
                    checked={d.secondHotbar}
                    disabled={d.interfaceStyle !== "modern"}
                    onChange={(v) => set({ secondHotbar: v })}
                  />
                  {/* Ours: the Modern HUD's size (CSS zoom on its clusters) */}
                  <label className={d.interfaceStyle === "modern" ? "hud-scale" : "hud-scale disabled"} title="The size of the Modern interface's bars, quick slots, map, chat and character window">
                    <span>HUD Size</span>
                    <Trackbar min={75} max={150} step={5} value={d.hudScale} onChange={(v) => set({ hudScale: v })} label="HUD size" />
                    <span className="bind-scale-value">{d.hudScale}%</span>
                  </label>
                </GroupBox>
              </div>
            ) : tab === "Mouse" ? (
              <div className="bind-mouse">
                {scale("Mouselook X Scale", "mouseXScale")}
                {scale("Mouselook Y Scale", "mouseYScale")}
                <Check label="Invert mouselook up/down" checked={d.invertMouse} onChange={(v) => set({ invertMouse: v })} />
              </div>
            ) : (
              <div className="bind-grid">
                {ACTION_TABS[tab].map((a: Action) => (
                  <div key={a} className="bind-row">
                    <span className="bind-label">
                      {/* Add a key: before the name, apart from the keys' × buttons */}
                      <Button className="add" title="Add a key" onClick={() => setListening({ action: a, index: d.keys[a].length })}>
                        +
                      </Button>
                      <span>{ACTION_LABELS[a]}</span>
                    </span>
                    <span className="bind-keys">
                      {d.keys[a].map((b, i) => (
                        <span key={i} className="bind-key">
                          {/* Drawn as an edit field (styles.css .key-field), so it reads as a value to change */}
                          <Button
                            className={listening?.action === a && listening.index === i ? "key-field listening" : "key-field"}
                            onClick={() => setListening({ action: a, index: i })}
                            title="Click, then press a key or mouse button"
                          >
                            {listening?.action === a && listening.index === i ? "press a key…" : bindingLabel(b)}
                          </Button>
                          <Button className="x" title="Remove this key" onClick={() => remove(a, i)}>
                            ×
                          </Button>
                        </span>
                      ))}
                      {/* The key being added, until it's pressed */}
                      {listening?.action === a && listening.index === d.keys[a].length && (
                        <span className="bind-key">
                          <Button className="key-field listening" onClick={() => setListening(null)} title="Press a key or mouse button (Esc cancels)">
                            press a key…
                          </Button>
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bind-footer">
            <Button onClick={() => set({ ...presetSettings("modern"), keys: PRESETS.modern })}>Restore Defaults</Button>
            <div className="bind-buttons">
              <Button
                isDefault
                onClick={() => {
                  onApply(d);
                  onClose();
                }}
              >
                OK
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </div>
        </div>
      </Window>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- Actions

export const ACTION_WINDOWS = ["who", "groups", "hotkeys", "commands", "guild"] as const;
export type ActionWindow = (typeof ACTION_WINDOWS)[number];

/** merintr.rc IDS_MENU_*: the windows */
const ACTION_MENU: [ActionWindow, string][] = [
  ["who", "Who is logged on"],
  ["groups", "Modify groups"],
  ["hotkeys", "Hotkey aliases"],
  ["commands", "Command aliases"],
  ["guild", "Guild configuration"],
];

/** actions.c: the emotes and moods, each its typed command (BP_ACTION) */
const EMOTES: [string, string][] = [["wave", "Wave"], ["point", "Point"], ["dance", "Dance"]];
const MOODS: [string, string][] = [["happy", "Happy"], ["sad", "Sad"], ["neutral", "Neutral"], ["wry", "Wry"]];

export function ActionsDialog({ onOpen, onCommand, onClose }: { onOpen: (w: ActionWindow) => void; onCommand: (c: string) => void; onClose: () => void }) {
  const buttons = (list: [string, string][]) =>
    list.map(([c, label]) => (
      <Button key={c} onClick={() => onCommand(c)}>
        {label}
      </Button>
    ));
  return (
    <Modal>
      <Window title="Actions" onClose={onClose} className="options-dialog actions-dialog">
        <div className="actions-list">
          {ACTION_MENU.map(([w, label]) => (
            <Button key={w} onClick={() => onOpen(w)}>
              {label}
            </Button>
          ))}
        </div>
        <h4 className="dialog-heading">Emotes</h4>
        <div className="actions-list">{buttons(EMOTES)}</div>
        <h4 className="dialog-heading">Moods</h4>
        <div className="actions-list">{buttons(MOODS)}</div>
      </Window>
    </Modal>
  );
}

/** msgfiltr.c IDD_WHO "Who is in Meridian" (235 x 379 DLU, the list shortened). */
export function WhoDialog({ session, settings, onApply, onClose }: { session: GameSession; settings: Settings; onApply: (patch: Patch) => void; onClose: () => void }) {
  const players = usePlayers(session);
  const [selected, setSelected] = useState<number | null>(null);
  const ignored = new Set(settings.ignored);
  const toggle = (name: string) => {
    const key = name.toLowerCase();
    const next = new Set(ignored);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onApply({ ignored: [...next] });
  };
  return (
    <DluDialog title="Who is in Meridian" size={[235, 260]} onClose={onClose}>
      <Text at={[4, 7, 57, 8]}>Players:</Text>
      <ListBox
        at={[4, 20, 119, 214]}
        label="Players"
        selected={selected}
        onSelect={setSelected}
        onActivate={(id) => {
          const p = players.find((x) => x.id === id);
          if (p) toggle(p.name);
        }}
        items={players.map((p) => ({
          key: p.id,
          className: ignored.has(p.name.toLowerCase()) ? "ignored" : "",
          label: (
            <span className="who-row">
              <input
                type="checkbox"
                title={ignored.has(p.name.toLowerCase()) ? "Ignored: click to hear them" : "Click to ignore"}
                checked={!ignored.has(p.name.toLowerCase())}
                onChange={() => toggle(p.name)}
                onMouseDown={(e) => e.stopPropagation()}
              />
              {p.name}
            </span>
          ),
        }))}
      />
      <Text at={[130, 20, 99, 26]} wrap>
        To ignore a player, turn off the box next to their name.
      </Text>
      <GroupBox at={[130, 47, 99, 41]} label="Messages" />
      <Check at={[139, 59, 81, 10]} label="Ignore all broadcasts" checked={settings.ignoreBroadcasts} onChange={(v) => onApply({ ignoreBroadcasts: v })} />
      <Check at={[139, 73, 67, 10]} label="Ignore everyone" checked={settings.ignoreEveryone} onChange={(v) => onApply({ ignoreEveryone: v })} />
      <Text at={[29, 242, 60, 8]}>Number of players:</Text>
      <span className="mk-edit who-count" style={at([92, 240, 31, 12])}>
        {players.length}
      </span>
      <Button at={[181, 240, 50, 14]} isDefault onClick={onClose}>
        OK
      </Button>
    </DluDialog>
  );
}

/** groupdlg.c IDD_GROUP "Group Configuration" (286 x 373 DLU, the lists shortened). */
export function GroupsDialog({ session, settings, onApply, onClose }: { session: GameSession; settings: Settings; onApply: (patch: Patch) => void; onClose: () => void }) {
  const players = usePlayers(session);
  const names = Object.keys(settings.groups).sort((a, b) => a.localeCompare(b));
  const [group, setGroup] = useState<string>(names[0] ?? "");
  const [newGroup, setNewGroup] = useState("");
  const [message, setMessage] = useState("");
  const [member, setMember] = useState<string | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [addName, setAddName] = useState("");
  const [status, setStatus] = useState("");
  const members = settings.groups[group] ?? [];
  const onlineByName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
  const save = (groups: Record<string, string[]>) => onApply({ groups });

  const create = (e: FormEvent) => {
    e.preventDefault();
    const n = newGroup.trim();
    if (!n || settings.groups[n]) return;
    save({ ...settings.groups, [n]: [] });
    setGroup(n);
    setNewGroup("");
    setStatus(`Group "${n}" created.`);
  };
  const addMember = (name: string) => {
    const n = name.trim();
    if (!group || !n || members.some((m) => m.toLowerCase() === n.toLowerCase())) return;
    save({ ...settings.groups, [group]: [...members, n].sort((a, b) => a.localeCompare(b)) });
    setAddName("");
  };
  const tell = (e: FormEvent) => {
    e.preventDefault();
    const ids = members.map((m) => onlineByName.get(m.toLowerCase())?.id).filter((id): id is number => id !== undefined);
    if (!message.trim()) return;
    if (!ids.length) return setStatus("Nobody in that group is logged on.");
    session.sayTo(ids, message.trim());
    setMessage("");
    setStatus(`Told ${ids.length} member${ids.length === 1 ? "" : "s"}.`);
  };
  return (
    <DluDialog title="Group Configuration" size={[286, 262]} onClose={onClose}>
      <Text at={[8, 7, 26, 8]}>Groups:</Text>
      <Select at={[8, 17, 97, 13]} value={group} options={names.map((n) => ({ key: n, label: n }))} onChange={setGroup} />
      <Button
        at={[114, 16, 58, 14]}
        disabled={!group}
        onClick={() => {
          const rest = { ...settings.groups };
          delete rest[group];
          save(rest);
          setGroup(Object.keys(rest)[0] ?? "");
        }}
      >
        Delete group
      </Button>
      <form onSubmit={create}>
        <Text at={[180, 6, 38, 8]}>New group:</Text>
        <TextField at={[180, 16, 58, 14]} value={newGroup} onChange={setNewGroup} maxLength={40} />
        <Button at={[242, 16, 36, 14]} type="submit" disabled={!newGroup.trim()}>
          Add
        </Button>
      </form>
      <form onSubmit={tell}>
        <Text at={[8, 39, 160, 8]}>Message to currently selected group:</Text>
        <TextField at={[8, 49, 269, 14]} value={message} onChange={setMessage} maxLength={500} />
      </form>
      <Text at={[8, 73, 60, 8]}>Group members:</Text>
      <Text at={[8, 81, 100, 8]}>(names in red are logged on)</Text>
      <ListBox
        at={[8, 91, 97, 146]}
        label="Group members"
        selected={member}
        onSelect={setMember}
        items={members.map((m) => ({ key: m, label: m, className: onlineByName.has(m.toLowerCase()) ? "online" : "" }))}
      />
      <Button at={[114, 91, 58, 14]} disabled={!group || online === null} onClick={() => online !== null && addMember(players.find((p) => p.id === online)?.name ?? "")}>
        {"<< Add to group"}
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addMember(addName);
        }}
      >
        <Text at={[114, 111, 40, 8]}>Add name:</Text>
        <TextField at={[114, 122, 58, 14]} value={addName} onChange={setAddName} maxLength={40} />
      </form>
      <Button
        at={[114, 149, 58, 14]}
        disabled={!group || member === null}
        onClick={() => {
          save({ ...settings.groups, [group]: members.filter((m) => m !== member) });
          setMember(null);
        }}
      >
        Remove member
      </Button>
      <Text at={[180, 80, 70, 8]}>People logged on:</Text>
      <ListBox
        at={[180, 91, 97, 146]}
        label="People logged on"
        selected={online}
        onSelect={setOnline}
        onActivate={(id) => addMember(players.find((p) => p.id === id)?.name ?? "")}
        items={players.map((p) => ({ key: p.id, label: p.name }))}
      />
      <Text at={[8, 244, 174, 8]}>{status}</Text>
      <Button at={[229, 242, 50, 14]} isDefault onClick={onClose}>
        Done
      </Button>
    </DluDialog>
  );
}

/** alias.c IDD_ALIAS "Hotkey Aliases" (217 x 226 DLU): F1..F12, each with Automatic Enter. */
export function HotkeyAliasesDialog({ settings, onApply, onOpen, onClose }: { settings: Settings; onApply: (patch: Patch) => void; onOpen: (w: ActionWindow) => void; onClose: () => void }) {
  const [rows, setRows] = useState<HotkeyAlias[]>(settings.hotkeyAliases);
  const edit = (i: number, patch: Partial<HotkeyAlias>) => setRows((r) => r.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <DluDialog title="Hotkey Aliases" size={[217, 226]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ hotkeyAliases: rows });
          onClose();
        }}
      >
        <Text at={[12, 4, 13, 8]}>Key:</Text>
        <Text at={[30, 4, 38, 8]}>Command:</Text>
        <Text at={[140, 4, 72, 8]} className="right">
          Automatic Enter:
        </Text>
        <GroupBox at={[4, 10, 208, 190]} label="" />
        {rows.map((a, i) => {
          const y = 19 + i * 15;
          return (
            <span key={i} style={{ display: "contents" }}>
              <Text at={[9, y + 1, 13, 8]} className="right">{`F${i + 1}`}</Text>
              <TextField at={[29, y, 159, 12]} value={a.command} onChange={(v) => edit(i, { command: v })} maxLength={200} />
              <Check at={[194, y + 2, 13, 9]} label="" checked={a.enter} onChange={(v) => edit(i, { enter: v })} />
            </span>
          );
        })}
        <Button at={[19, 208, 50, 14]} type="submit" isDefault>
          OK
        </Button>
        <Button at={[77, 208, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
        <Button at={[136, 208, 76, 14]} onClick={() => onOpen("commands")}>
          Command Aliases...
        </Button>
      </form>
    </DluDialog>
  );
}

/** alias.c IDD_CMDALIAS "Command Aliases" (219 x 223 DLU): a word stands for a full command. */
export function CommandAliasesDialog({ settings, onApply, onOpen, onClose }: { settings: Settings; onApply: (patch: Patch) => void; onOpen: (w: ActionWindow) => void; onClose: () => void }) {
  const [aliases, setAliases] = useState<Record<string, string>>(settings.commandAliases);
  const [word, setWord] = useState("");
  const [command, setCommand] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const words = Object.keys(aliases).sort((a, b) => a.localeCompare(b));
  const define = (e: FormEvent) => {
    e.preventDefault();
    const w = word.trim().toLowerCase();
    if (!/^\S+$/.test(w) || !command.trim()) return;
    setAliases((a) => ({ ...a, [w]: command.trim() }));
    setSelected(w);
  };
  return (
    <DluDialog title="Command Aliases" size={[219, 223]} onClose={onClose}>
      <Text at={[4, 4, 211, 26]} wrap>
        To define a command alias, enter a unique word and your full command below. To use it, type your unique word as a command in the game. For
        example, "laugh" could mean "emote laughs."
      </Text>
      <GroupBox at={[4, 29, 211, 170]} label="" />
      <form onSubmit={define}>
        <Text at={[10, 38, 20, 8]}>Word:</Text>
        <TextField at={[49, 36, 50, 12]} value={word} onChange={setWord} maxLength={30} />
        <Button at={[103, 37, 50, 11]} type="submit" isDefault>
          Define
        </Button>
        <Button
          at={[157, 37, 50, 11]}
          disabled={selected === null}
          onClick={() => {
            setAliases((a) => {
              const rest = { ...a };
              if (selected) delete rest[selected];
              return rest;
            });
            setSelected(null);
          }}
        >
          Remove
        </Button>
        <Text at={[10, 51, 34, 8]}>Command:</Text>
        <TextField at={[49, 49, 159, 12]} value={command} onChange={setCommand} maxLength={200} />
      </form>
      <ListBox
        at={[10, 64, 199, 128]}
        label="Command aliases"
        selected={selected}
        onSelect={(w) => {
          setSelected(w);
          setWord(w);
          setCommand(aliases[w] ?? "");
        }}
        items={words.map((w) => ({
          key: w,
          label: (
            <span className="alias-row">
              <b>{w}</b>
              <span>{aliases[w]}</span>
            </span>
          ),
        }))}
      />
      <Button
        at={[24, 205, 50, 14]}
        onClick={() => {
          onApply({ commandAliases: aliases });
          onClose();
        }}
      >
        OK
      </Button>
      <Button at={[82, 205, 50, 14]} onClick={onClose}>
        Cancel
      </Button>
      <Button at={[139, 205, 76, 14]} onClick={() => onOpen("hotkeys")}>
        Hotkey Aliases...
      </Button>
    </DluDialog>
  );
}

/**
 * Ours: the phone's Configuration instead of the Bind Editor (no keys to bind there): how fast a
 * drag looks around, and the Bind Editor's options that matter on a touch screen.
 */
export function TouchConfigDialog({ settings, onApply, onClose }: { settings: Settings; onApply: (patch: Patch) => void; onClose: () => void }) {
  const [d, setD] = useState<Settings>(settings);
  const set = (patch: Patch) => setD((s) => ({ ...s, ...patch }));
  return (
    <Modal>
      <Window title="Configuration" onClose={onClose} className="options-dialog touch-config">
        <label className="touch-config-scale">
          <span>Look Speed</span>
          <Trackbar min={1} max={30} value={d.touchLookScale} onChange={(v) => set({ touchLookScale: v })} label="Look Speed" />
          <span className="bind-scale-value">{d.touchLookScale}</span>
        </label>
        <Check label="Dynamic Lighting" checked={d.dynamicLighting} onChange={(v) => set({ dynamicLighting: v })} />
        <Check label="Enhanced Lighting" title={ENHANCED_TITLE} checked={d.enhanced} onChange={(v) => set({ enhanced: v })} />
        <Check label="Ground Detail" title={GROUND_TITLE} checked={d.groundDetail} onChange={(v) => set({ groundDetail: v })} />
        <Check label="Limit to 60 FPS" title={FRAME_LIMIT_TITLE} checked={d.frameLimit} onChange={(v) => set({ frameLimit: v })} />
        <AmbientLifeSelect value={d.ambientLife} onChange={(v) => set({ ambientLife: v })} />
        <Check label="Critters" title={CRITTERS_TITLE} checked={d.critters} onChange={(v) => set({ critters: v })} />
        <Check label="Birds and Bats" title={FLYERS_TITLE} checked={d.flyers} onChange={(v) => set({ flyers: v })} />
        <Check label="Nature" title={NATURE_TITLE} checked={d.nature} onChange={(v) => set({ nature: v })} />
        <AmbientSoundsOption d={d} set={set} />
        <Check label="Show Pets" title={PETS_TITLE} checked={d.showPets} onChange={(v) => set({ showPets: v })} />
        <Check label="Show Pet Names" title={PET_NAMES_TITLE} checked={d.showPetNames} onChange={(v) => set({ showPetNames: v })} />
        <Check label="Damage Numbers" checked={d.damageNumbers} onChange={(v) => set({ damageNumbers: v })} />
        <Check label="Attack On Target" checked={d.attackOnTarget} onChange={(v) => set({ attackOnTarget: v })} />
        <div className="touch-config-buttons">
          <Button onClick={() => set({ touchLookScale: DEFAULT_SETTINGS.touchLookScale })}>Default Speed</Button>
          <Button
            isDefault
            onClick={() => {
              onApply({
                touchLookScale: d.touchLookScale,
                dynamicLighting: d.dynamicLighting,
                enhanced: d.enhanced,
                ambientLife: d.ambientLife,
                ambientSounds: d.ambientSounds,
                frameLimit: d.frameLimit,
                ambientVolume: d.ambientVolume,
                critters: d.critters,
                flyers: d.flyers,
                nature: d.nature,
                groundDetail: d.groundDetail,
                showPets: d.showPets,
                showPetNames: d.showPetNames,
                damageNumbers: d.damageNumbers,
                attackOnTarget: d.attackOnTarget,
              });
              onClose();
            }}
          >
            OK
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </Window>
    </Modal>
  );
}
