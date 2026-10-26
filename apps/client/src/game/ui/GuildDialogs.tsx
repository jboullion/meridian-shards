// Guilds (module/merintr guild*.c, merintr.rc): the guild window, a property sheet of
// Membership, Alliances, Invite and Shield (the last two only for those whose rank allows them),
// plus Create New Guild (UC_GUILD_ASK) and Rent Guild Hall
// (UC_GUILD_HALLS), both offered by the guild creator NPC. Ours (docs/adr/0022-guilds.md decision
// 32): the Fallen Halls tab, the eight End Game dungeons and our daily quest for each; the
// Quests tab, the guild window's other quests (the board); the Trophies tab (decisions 17-19); and
// the Hall tab (phase 8), in place of the classic Guildmaster page, for every member.

import { useEffect, useState } from "react";
import {
  ANIMATE, GC, GUILD_GENDER, UC, buildClaimShield, buildGuildCreate, buildGuildObjectCommand, buildGuildRent,
  buildSetRank, buildUserCommand, type GuildInfo,
} from "@shards/protocol";
import {
  DAILY_STATE, QUEST_OFFER, TROPHY, boardAcceptCommand, boardCommand, capstoneText, guildCloakCommand, guildHallCommand, guildHallPublicCommand, hallStateText, hallsCommand,
  prestigeText, rankNumeral, rentText, trophyAgeText,
  type FallenHall, type FallenHallsStatus, type GameSession, type GuildEvent,
} from "@shards/world";
import { formatCountdown, useSecondTick } from "../factionWar.ts";
import { useFallenHalls, type FallenHallsStore } from "../fallenHalls.ts";
import type { IconRenderer } from "../icons.ts";
import type { QuestStore } from "../quests.ts";
import { Button, Check, GroupBox, ListBox, MessageBox, Select, Tabs, Text, TextField, Window, at, type Rect } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

type GuildList = Extract<GuildEvent, { type: "list" }>["list"];
type GuildShield = Extract<GuildEvent, { type: "shield" }>["shield"];
type GuildHall = Extract<GuildEvent, { type: "halls" }>["halls"][number];

/** guild.h MAX_GUILD_NAME, MAX_RANK_LENGTH; guildmem.c MAX_RANK4 (at most two of rank 4) */
const MAX_GUILD_NAME = 30;
const MAX_RANK_LENGTH = 20;
const MAX_RANK4 = 2;
/** guildshi.c: 11 x 11 colour pairs (xlat.h XLAT_GUILDCOLOR_BASE..END), grey on grey (9, 9) not allowed */
const NUM_COLORS = 11;
const XLAT_GUILDCOLOR_BASE = 0x87;
export const legalShield = (c1: number, c2: number) => c1 !== 9 || c2 !== 9;
const OF_PLAYER = 0x4;
const DRAWFX_INVISIBLE = 5;

type Tab = "Membership" | "Alliances" | "Invite" | "Hall" | "Shield" | "Fallen Halls" | "Quests" | "Trophies";

/** A guild shield picture: the pattern in the two colours (guildshi.c GuildShieldDraw) */
function Shield({ icons, pattern, color1, color2, className }: { icons: IconRenderer; pattern: number; color1: number; color2: number; className?: string }) {
  if (!pattern) return <span className={`obj-icon ${className ?? ""}`} />;
  return (
    <ObjIcon
      icons={icons}
      className={className}
      object={{ iconRes: pattern, animation: { type: ANIMATE.NONE, group: 1 }, overlays: [], translation: XLAT_GUILDCOLOR_BASE + NUM_COLORS * color1 + color2 }}
      opts={{ group: 0 }}
    />
  );
}

export interface GuildState {
  info: GuildInfo;
  list: GuildList | null;
  shield: GuildShield | null;
  patterns: number[];
  /** GuildGotShield: once our own (legal) shield has come, Claim stays disabled */
  ownShield: boolean;
}

/** guild.c GuildConfigInitInfo: the property sheet, titled with the guild's name; Done closes it */
export function GuildWindow({
  session, state, icons, fallenHalls, quests, onClose,
}: {
  session: GameSession;
  state: GuildState;
  icons: IconRenderer;
  /** Ours (docs/adr/0022): the Fallen Halls and the guild window's quests */
  fallenHalls: FallenHallsStore;
  quests: QuestStore;
  onClose: () => void;
}) {
  const { info } = state;
  const tabs: Tab[] = ["Membership", "Alliances"];
  if (info.flags & GC.INVITE) tabs.push("Invite");
  tabs.push("Hall");
  if (info.flags & GC.DISBAND) tabs.push("Shield");
  tabs.push("Fallen Halls", "Quests", "Trophies");
  const [tab, setTab] = useState<Tab>("Membership");
  const [confirm, setConfirm] = useState<{ text: string; then: () => void } | null>(null);
  const send = (b: Uint8Array) => session.send(b);
  // guildmem.c / guildshi.c WM_INITDIALOG: the shield patterns and our shield
  useEffect(() => {
    session.userCommand(UC.GUILD_SHIELDS);
    session.userCommand(UC.GUILD_SHIELD);
  }, [session]);
  // Halls have no password since ADR 0022 (Lords say "open" for the sanctum), so nothing goes back on close
  const close = () => onClose();
  const ask = (text: string, then: () => void) => setConfirm({ text, then });
  const pageProps = { session, state, icons, send, ask, onClose: close };
  return (
    <div className="mk-modal">
      <Window title={info.name} dlu={[284, 160]} onClose={close} className="guild-window">
        <Tabs at={[2, 0, 280, 18]} tabs={tabs} active={tab} onChange={setTab} />
        <div className="mk-page" style={at([2, 18, 280, 124])}>
          <div className="mk-page-inner" style={at([0, 1, 280, 122])}>
            {tab === "Membership" && <MembersPage {...pageProps} />}
            {tab === "Alliances" && <AlliesPage {...pageProps} />}
            {tab === "Invite" && <InvitePage {...pageProps} />}
            {tab === "Hall" && <HallPage {...pageProps} store={fallenHalls} />}
            {tab === "Shield" && <ShieldPage {...pageProps} />}
            {tab === "Fallen Halls" && <FallenHallsPage session={session} store={fallenHalls} />}
            {tab === "Quests" && <GuildQuestsPage session={session} store={fallenHalls} quests={quests} />}
            {tab === "Trophies" && <TrophiesPage session={session} store={fallenHalls} />}
          </div>
        </div>
        <Button at={[230, 145, 50, 13]} isDefault onClick={close}>
          Done
        </Button>
      </Window>
      {confirm && (
        <MessageBox
          kind="yesno"
          defaultNo
          text={confirm.text}
          onResult={(yes) => {
            setConfirm(null);
            if (yes) confirm.then();
          }}
        />
      )}
    </div>
  );
}

/** A hall's line in the list: a mark if our guild holds its boss's trophy, its rank, name and state, and our daily's */
function hallLine(h: FallenHall, status: FallenHallsStatus): string {
  const daily = h.dailyState === DAILY_STATE.OFFERED ? " (daily ready)" : h.dailyState === DAILY_STATE.TAKEN ? " (daily taken)" : h.dailyState === DAILY_STATE.DONE ? " (daily done)" : "";
  const trophy = status.trophies.some((t) => t.id === h.rank && t.held) ? "★ " : "";
  return `${trophy}Rank ${rankNumeral(h.rank)}: ${h.name}. ${hallStateText(h)}${daily}`;
}

/**
 * Ours (docs/adr/0022 decisions 30 and 32): the eight Fallen Halls, the End Game dungeons, rank
 * I to VIII; how each stands since the last reset, and our daily quest for it, taken here
 * ("quest board-accept"). Asked for as the tab opens ("halls"); the server sends it again
 * whenever a hall changes, and the countdowns run here in between.
 */
function FallenHallsPage({ session, store }: { session: GameSession; store: FallenHallsStore }) {
  useFallenHalls(store);
  useSecondTick(true);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => session.shardsCommand(hallsCommand()), [session]);
  const status = store.status;
  if (!status) return <Text at={[4, 4, 272, 8]}>Asking Frular...</Text>;
  const hall = status.halls.find((h) => h.rid === selected) ?? status.halls[0] ?? null;
  const daily = (h: FallenHall): string => {
    if (h.dailyState === DAILY_STATE.OFFERED) return "Its daily quest is yours to take.";
    if (h.dailyState === DAILY_STATE.TAKEN) return "You've taken its daily quest: bring down its boss.";
    if (h.dailyState === DAILY_STATE.DONE) return `You've done its daily quest. It's offered again in ${formatCountdown(store.dailySeconds(h))}.`;
    return `Its daily quest opens at ${h.minHealth} base health, once you've done its story quest with Frular in Barloque.`;
  };
  return (
    <>
      <Text at={[4, 2, 272, 8]}>End Game dungeons. The Order retakes every hall in {formatCountdown(store.resetSeconds())}.</Text>
      <ListBox
        at={[4, 12, 272, 62]}
        label="The Fallen Halls"
        items={status.halls.map((h) => ({ key: h.rid, label: hallLine(h, status) }))}
        selected={hall?.rid ?? null}
        onSelect={setSelected}
      />
      {hall && (
        <>
          <Text at={[4, 78, 206, 42]} wrap>
            {`${hall.name}, rank ${rankNumeral(hall.rank)} of VIII, from ${hall.minHealth} base health. Its door is off ${hall.door}. ${daily(hall)}`}
          </Text>
          <Button at={[214, 80, 62, 13]} disabled={hall.dailyState !== DAILY_STATE.OFFERED} onClick={() => session.shardsCommand(boardAcceptCommand(hall.dailyQuest))}>
            Take the daily
          </Button>
        </>
      )}
    </>
  );
}

/** The world's trophies are named as in a sentence ("the Ice Dragon"); a list or a line starts with a capital */
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Ours (docs/adr/0022 decisions 17-19 and 26): our guild's trophies, one for each great creature
 * that falls to its members, held or not: who took part and when. The eight Fallen Halls' trophies
 * open the Inner Sanctum's capstone. They come with the halls (UC_FALLEN_HALLS), sent again as one
 * is earned.
 */
function TrophiesPage({ session, store }: { session: GameSession; store: FallenHallsStore }) {
  useFallenHalls(store);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => session.shardsCommand(hallsCommand()), [session]);
  const status = store.status;
  if (!status) return <Text at={[4, 4, 272, 8]}>Asking Frular...</Text>;
  if (!status.trophies.length) return <Text at={[4, 4, 272, 8]}>No word of trophies yet.</Text>;
  const held = status.trophies.filter((t) => t.held).length;
  const fallen = status.trophies.filter((t) => t.id >= TROPHY.FALLEN_FIRST && t.id <= TROPHY.FALLEN_LAST);
  const fallenHeld = fallen.filter((t) => t.held).length;
  const trophy = status.trophies.find((t) => t.id === selected) ?? status.trophies[0]!;
  const detail = (): string => {
    const where = `${capitalised(trophy.name)}, in ${trophy.where}.`;
    if (trophy.held) return `${where} Taken ${trophyAgeText(store.trophyAge(trophy))}${trophy.names.length ? ` by ${trophy.names.join(", ")}` : ""}.`;
    if (trophy.id === TROPHY.CAPSTONE)
      return `${where} ${fallenHeld < fallen.length ? `Its seal opens for a guild holding all eight Fallen Hall trophies: you hold ${fallenHeld}.` : "Your guild may break its seal: say \"open\" before the sealed door."} ${capstoneText(status.capstone)}`;
    return `${where} Not yet taken.`;
  };
  return (
    <>
      <Text at={[4, 2, 272, 8]}>{`Your guild holds ${held} of ${status.trophies.length} trophies.`}</Text>
      <ListBox
        at={[4, 12, 272, 70]}
        label="Trophies"
        items={status.trophies.map((t) => ({ key: t.id, label: `${t.held ? "★" : "–"} ${capitalised(t.name)}` }))}
        selected={trophy.id}
        onSelect={setSelected}
      />
      <Text at={[4, 86, 272, 34]} wrap>
        {detail()}
      </Text>
    </>
  );
}

/**
 * Ours (docs/adr/0022 decision 32): the guild window's other quests, the repeatable ones taken
 * here rather than from an NPC (the board, "quest board"). The halls' dailies are on the Fallen
 * Halls tab, and the guild's story is with Frular in Barloque.
 */
function GuildQuestsPage({ session, store, quests }: { session: GameSession; store: FallenHallsStore; quests: QuestStore }) {
  useFallenHalls(store);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => session.shardsCommand(boardCommand()), [session]);
  const board = store.board;
  if (!board) return <Text at={[4, 4, 272, 8]}>Asking Frular...</Text>;
  const dailies = store.dailyIds();
  const offers = board.filter((o) => !dailies.has(o.id));
  if (!offers.length)
    return (
      <Text at={[4, 4, 272, 40]} wrap>
        No other guild quests for now. Your daily hall quests are on the Fallen Halls tab, and Frular, the guild creator in Barloque, tells your guild's story.
      </Text>
    );
  const offer = offers.find((o) => o.id === selected) ?? offers[0]!;
  const quest = quests.quest(offer.id);
  return (
    <>
      <ListBox
        at={[4, 4, 272, 62]}
        label="Guild quests"
        items={offers.map((o) => ({ key: o.id, label: quests.quest(o.id)?.name ?? `Quest ${o.id}` }))}
        selected={offer.id}
        onSelect={setSelected}
      />
      <Text at={[4, 70, 206, 50]} wrap>
        {quest?.text.offer ?? ""}
      </Text>
      <Button at={[214, 72, 62, 13]} disabled={offer.state !== QUEST_OFFER.OFFER} onClick={() => session.shardsCommand(boardAcceptCommand(offer.id))}>
        Take it
      </Button>
    </>
  );
}

interface PageProps {
  session: GameSession;
  state: GuildState;
  icons: IconRenderer;
  send: (b: Uint8Array) => void;
  ask: (text: string, then: () => void) => void;
  onClose: () => void;
}

/** guildmem.c: members (red ones logged on), their rank, exile, abdicating, leaving */
function MembersPage({ session, state, icons, send, ask, onClose }: PageProps) {
  const { info, shield } = state;
  const [members, setMembers] = useState(info.members);
  const [selected, setSelected] = useState<number | null>(null);
  const me = session.world.player?.id ?? 0;
  const myRank = members.find((m) => m.id === me)?.rank ?? 0;
  const member = members.find((m) => m.id === selected) ?? null;
  const rankName = (m: { rank: number; gender: number }) => (m.gender === GUILD_GENDER.MALE ? info.maleRanks : info.femaleRanks)[m.rank - 1] ?? "";
  const online = (id: number) => session.world.players.has(id);
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const f = info.flags;
  // Ranks we may give: below our own (guildmem.c IDC_GUILDLIST LBN_SELCHANGE)
  const rankOptions = member
    ? (member.gender === GUILD_GENDER.MALE ? info.maleRanks : info.femaleRanks)
        .map((label, i) => ({ key: String(i + 1), label }))
        .filter((_, i) => !(i === myRank - 1 && member.rank < myRank) && i < Math.max(myRank, member.rank))
    : [];
  return (
    <>
      <Text at={[4, 4, 158, 8]}>Guild Members (names in red are logged on):</Text>
      <ListBox
        at={[4, 15, 88, 89]}
        label="Guild members"
        items={sorted.map((m) => ({ key: m.id, label: m.name, className: online(m.id) ? "guild-online" : undefined }))}
        selected={selected}
        onSelect={setSelected}
      />
      <Text at={[98, 17, 20, 8]}>Rank:</Text>
      {f & GC.SET_RANK && member ? (
        <span style={at([123, 15, 93, 12])}>
          <Select
            value={String(member.rank)}
            options={rankOptions}
            onChange={(v) => {
              // Can't set someone at or above your rank; at most two of rank 4
              if (member.rank >= myRank) return;
              let rank = Number(v);
              if (rank === 4 && member.rank !== 4 && members.filter((m) => m.rank === 4).length >= MAX_RANK4) rank = 3;
              setMembers(members.map((m) => (m.id === member.id ? { ...m, rank } : m)));
              send(buildSetRank(member.id, rank));
            }}
          />
        </span>
      ) : (
        <Text at={[124, 17, 93, 8]} className="sunken">
          {member ? rankName(member) : ""}
        </Text>
      )}
      {!!(f & GC.EXILE) && (
        <Button
          at={[123, 30, 55, 12]}
          disabled={!member || member.id === me || member.rank >= myRank}
          onClick={() => {
            if (!member) return;
            send(buildGuildObjectCommand(UC.EXILE, member.id));
            setMembers(members.filter((m) => m.id !== member.id));
            setSelected(null);
          }}
        >
          Exile
        </Button>
      )}
      {/* No votes for leader since ADR 0022: a Leader abdicates, or is succeeded after 30 days away. */}
      {!!(f & GC.ABDICATE) && (
        <>
          <Button
            at={[98, 91, 54, 12]}
            disabled={!member}
            onClick={() =>
              member &&
              ask("Are you sure you want to step down as leader?", () => {
                send(buildGuildObjectCommand(UC.ABDICATE, member.id));
                onClose();
              })
            }
          >
            Abdicate to:
          </Button>
          <Text at={[171, 92, 105, 10]} className="sunken">
            {member?.name ?? ""}
          </Text>
        </>
      )}
      {!!(f & GC.RENOUNCE) && (
        <Button
          at={[4, 106, 49, 12]}
          onClick={() =>
            ask("Are you sure you want to leave the guild?", () => {
              session.userCommand(UC.RENOUNCE);
              onClose();
            })
          }
        >
          Leave guild
        </Button>
      )}
      <span style={at([236, 4, 40, 40])} className="guild-shield-box">
        {shield && <Shield icons={icons} pattern={state.patterns[shield.pattern - 1] ?? 0} color1={shield.color1} color2={shield.color2} className="guild-shield" />}
      </span>
    </>
  );
}

/** guildaly.c: allied, unaligned and enemy guilds, moved between with << and >> */
function AlliesPage({ session, state, send }: PageProps) {
  const { info, list } = state;
  const [lists, setLists] = useState<{ ally: number | null; other: number | null; enemy: number | null }>({ ally: null, other: null, enemy: null });
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => session.userCommand(UC.REQ_GUILD_LIST), [session]);
  const guilds = (list?.guilds ?? []).filter((g) => g.id !== info.guildId).sort((a, b) => a.name.localeCompare(b.name));
  const allies = guilds.filter((g) => list?.allies.includes(g.id));
  const enemies = guilds.filter((g) => list?.enemies.includes(g.id));
  const others = guilds.filter((g) => !list?.allies.includes(g.id) && !list?.enemies.includes(g.id));
  const f = info.flags;
  // UpdateAllyLists: the change, then the lists again from the server
  const act = (uc: number, id: number | null) => {
    if (id === null) return;
    send(buildGuildObjectCommand(uc, id));
    setLists({ ally: null, other: null, enemy: null });
    session.userCommand(UC.REQ_GUILD_LIST);
  };
  const status = (() => {
    const g = guilds.find((x) => x.id === chosen);
    if (!g || !list) return "";
    if (list.otherAllies.includes(g.id)) return `The ${g.name} consider you an ally.`;
    if (list.otherEnemies.includes(g.id)) return `The ${g.name} consider you an enemy.`;
    return `The ${g.name} do not consider you an ally or an enemy.`;
  })();
  const box = (r: Rect, label: string, items: { id: number; name: string }[], key: "ally" | "other" | "enemy") => (
    <ListBox
      at={r}
      label={label}
      items={items.map((g) => ({ key: g.id, label: g.name }))}
      selected={lists[key]}
      onSelect={(id) => {
        setLists({ ally: null, other: null, enemy: null, [key]: id });
        setChosen(id);
      }}
    />
  );
  return (
    <>
      {!!(f & GC.MAKE_ALLIANCE) && <Text at={[51, 4, 176, 8]}>Use the &lt;&lt; and &gt;&gt; buttons to forge and break alliances.</Text>}
      <Text at={[4, 26, 60, 8]}>Allied guilds</Text>
      {box([4, 36, 75, 58], "Allied guilds", allies, "ally")}
      {!!(f & GC.END_ALLIANCE) && (
        <Button at={[84, 46, 13, 12]} onClick={() => act(UC.END_ALLIANCE, lists.ally)}>
          &gt;&gt;
        </Button>
      )}
      {!!(f & GC.MAKE_ALLIANCE) && (
        <Button at={[84, 72, 13, 12]} onClick={() => act(UC.MAKE_ALLIANCE, lists.other)}>
          &lt;&lt;
        </Button>
      )}
      <Text at={[102, 26, 70, 8]}>Unaligned guilds</Text>
      {box([102, 36, 75, 58], "Unaligned guilds", others, "other")}
      {!!(f & GC.DECLARE_ENEMY) && (
        <Button at={[182, 47, 13, 12]} onClick={() => act(UC.MAKE_ENEMY, lists.other)}>
          &gt;&gt;
        </Button>
      )}
      {!!(f & GC.END_ENEMY) && (
        <Button at={[182, 72, 13, 12]} onClick={() => act(UC.END_ENEMY, lists.enemy)}>
          &lt;&lt;
        </Button>
      )}
      <Text at={[200, 26, 60, 8]}>Enemy guilds</Text>
      {box([201, 36, 75, 58], "Enemy guilds", enemies, "enemy")}
      <Text at={[4, 100, 272, 8]}>{status}</Text>
    </>
  );
}

/** guildinv.c: the players in the room (not us, not invisible) to invite */
function InvitePage({ session, send }: PageProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const me = session.world.player?.id;
  const people = [...session.world.objects.values()]
    .filter((o) => o.info.flags & OF_PLAYER && o.id !== me && o.info.drawingType !== DRAWFX_INVISIBLE)
    .map((o) => ({ key: o.id, label: session.resource(o.info.nameRes) ?? "" }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <>
      <Text at={[4, 4, 272, 8]}>You can only invite people in the same room as you, and you may only</Text>
      <Text at={[4, 14, 200, 8]}>have one invitation outstanding at a time.</Text>
      <Text at={[4, 34, 52, 18]} wrap>
        Choose person to invite:
      </Text>
      <ListBox at={[60, 32, 134, 86]} label="People here" items={people} selected={selected} onSelect={setSelected} />
      <Button at={[231, 32, 45, 12]} disabled={selected === null} onClick={() => selected !== null && send(buildGuildObjectCommand(UC.INVITE, selected))}>
        Invite
      </Button>
    </>
  );
}

/**
 * Ours (docs/adr/0022 phase 8): the Hall tab, for every member, in place of guildmtr.c's Guildmaster
 * page. The hall and whether it's open to visitors (an Officer or the Leader may change that), its
 * chests and how full they are, the prestige and what its tier gives, the rent, and the trophies.
 * The Leader's Abandon Guild Hall and Disband Guild are here too. Asked for as the tab opens
 * ("guildhall"); the server sends it again when the hall opens or closes.
 */
function HallPage({ session, state, ask, onClose, store }: PageProps & { store: FallenHallsStore }) {
  useFallenHalls(store);
  const { info } = state;
  useEffect(() => session.shardsCommand(guildHallCommand()), [session]);
  const s = store.hall;
  const me = info.members.find((m) => m.id === session.world.player?.id);
  const ranks = me?.gender === GUILD_GENDER.FEMALE ? info.femaleRanks : info.maleRanks;
  const rankName = (rank: number) => ranks[rank - 1] ?? `rank ${rank}`;
  const chestLine = (c: { name: string; rank: number; items: number }, limit: number) =>
    `${c.name.charAt(0).toUpperCase()}${c.name.slice(1)}: ${c.rank <= 1 ? "every member" : `${rankName(c.rank)} and up`}, ${c.items} of ${limit} items`;
  const leader = (
    <>
      {!!(info.flags & GC.ABANDON) && (
        <Button
          at={[130, 106, 72, 13]}
          onClick={() =>
            ask("Are you sure you want to abandon your guild hall?", () => {
              session.userCommand(UC.ABANDON_GUILD_HALL);
              onClose();
            })
          }
        >
          Abandon Guild Hall
        </Button>
      )}
      {!!(info.flags & GC.DISBAND) && (
        <Button
          at={[206, 106, 70, 13]}
          onClick={() =>
            ask("Are you sure you want to disband the guild?", () => {
              session.userCommand(UC.DISBAND);
              onClose();
            })
          }
        >
          Disband Guild
        </Button>
      )}
    </>
  );
  if (!s) return <Text at={[4, 4, 272, 8]}>Asking after your hall...</Text>;
  const hall = s.hall;
  return (
    <>
      <GroupBox at={[4, 2, 272, 70]} label="Guild Hall" />
      {hall ? (
        <>
          <Text at={[10, 13, 176, 8]}>{hall.name}</Text>
          <Check
            at={[192, 12, 80, 10]}
            label="Open to visitors"
            checked={hall.isPublic}
            disabled={!hall.mayToggle}
            title={hall.mayToggle ? undefined : `Only the ${rankName(4)} rank and above may open or close the hall.`}
            onChange={(open) => session.shardsCommand(guildHallPublicCommand(open))}
          />
          {hall.chests.map((c, i) => (
            <Text key={i} at={[10, 24 + i * 9, 262, 8]}>
              {chestLine(c, s.chestLimit)}
            </Text>
          ))}
          <Text at={[10, 51, 262, 8]}>Say "recall stone" in the hall for a recall stone.</Text>
        </>
      ) : (
        <Text at={[10, 13, 262, 20]} wrap>
          Your guild has no hall. Frular in Barloque leases them to a guild of two or more members.
        </Text>
      )}
      <Check
        at={[10, 60, 180, 10]}
        label="Wear the guild's cloak"
        checked={s.wearingCloak}
        disabled={!s.hasColours}
        title={s.hasColours ? "A cloak in the guild's colours, over whatever you wear" : "Your cloaks wait on the guild's colours, chosen on the Shield tab."}
        onChange={(wear) => session.shardsCommand(guildCloakCommand(wear))}
      />
      <Text at={[4, 75, 272, 8]}>
        {prestigeText(s)}
      </Text>
      <Text at={[4, 86, 272, 18]} wrap>
        {rentText(s)}
      </Text>
      <Text at={[4, 108, 124, 8]}>{`Trophies: ${s.trophies} of ${s.trophyTotal}.`}</Text>
      {leader}
    </>
  );
}

/** guildshi.c: try colour and pattern combinations (the server says who has each), and claim one */
function ShieldPage({ state, icons, send }: PageProps) {
  const { shield, patterns } = state;
  // GuildShieldInit: random colours to start with, until the server says which design is ours
  const [start] = useState(() => ({ color1: Math.floor(Math.random() * NUM_COLORS), color2: Math.floor(Math.random() * NUM_COLORS), pattern: 1 }));
  /** What we stepped to, until the server's answer for it (GuildGotShield shows each answer's design) */
  const [stepped, setStepped] = useState<{ design: typeof start; after: GuildShield | null } | null>(null);
  const design = stepped && stepped.after === shield ? stepped.design : (shield ?? start);
  const find = (d: typeof start) => send(buildClaimShield(d.color1, d.color2, d.pattern, false));
  const step = (key: "color1" | "color2" | "pattern", d: number) => {
    const n = key === "pattern" ? Math.max(1, patterns.length) : NUM_COLORS;
    const next = { color1: design.color1, color2: design.color2, pattern: design.pattern };
    if (key === "pattern") next.pattern = ((((design.pattern - 1 + d) % n) + n) % n) + 1;
    else next[key] = (((design[key] + d) % n) + n) % n;
    setStepped({ design: next, after: shield });
    // RequestFindGuildShield after every change
    find(next);
  };
  // GuildGotShield: who has the design the server last told us about
  const claimedText = !shield || !legalShield(shield.color1, shield.color2) ? "Design is not available." : shield.id ? `Design has been claimed by ${shield.name}.` : "";
  const arrows = (y: number, key: "color1" | "color2" | "pattern") => (
    <>
      <Button at={[181, y, 17, 11]} onClick={() => step(key, -1)}>
        &lt;
      </Button>
      <Button at={[199, y, 17, 11]} onClick={() => step(key, 1)}>
        &gt;
      </Button>
    </>
  );
  return (
    <>
      <GroupBox at={[3, 0, 120, 116]} label="Guild Shield" />
      <span style={at([7, 10, 108, 102])} className="guild-shield-box">
        <Shield icons={icons} pattern={patterns[design.pattern - 1] ?? 0} color1={design.color1} color2={design.color2} className="guild-shield" />
      </span>
      <Text at={[137, 14, 135, 8]}>Select a color and pattern combination:</Text>
      <Text at={[148, 29, 30, 8]}>Color 1:</Text>
      {arrows(27, "color1")}
      <Text at={[148, 44, 30, 8]}>Color 2:</Text>
      {arrows(42, "color2")}
      <Text at={[147, 59, 30, 8]}>Pattern:</Text>
      {arrows(57, "pattern")}
      <Text at={[137, 77, 129, 19]} className="sunken" wrap>
        {claimedText}
      </Text>
      <Button
        at={[137, 102, 129, 13]}
        disabled={state.ownShield}
        onClick={() => {
          // IDC_ACCEPT: claim it (grey on grey can't be), then ask again
          if (legalShield(design.color1, design.color2)) send(buildClaimShield(design.color1, design.color2, design.pattern, true));
          find(design);
        }}
      >
        Claim for my Guild
      </Button>
    </>
  );
}

/** guildbuy.c IDD_GUILDCREATE: the name, ten rank names, the secret option and its cost */
export function GuildCreateDialog({ session, cost, secretCost, onClose }: { session: GameSession; cost: number; secretCost: number; onClose: () => void }) {
  const [name, setName] = useState("");
  // ADR 0022's default rank names, lowest first
  const [male, setMale] = useState(["Apprentice", "Sir", "Lord", "Lieutenant", "Commander"]);
  const [female, setFemale] = useState(["Apprentice", "Madame", "Lady", "Lieutenant", "Commander"]);
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState("");
  const rankField = (list: string[], set: (l: string[]) => void, i: number, x: number) => (
    <TextField at={[x, 143 - i * 16, 83, 14]} value={list[i]} maxLength={MAX_RANK_LENGTH} onChange={(v) => set(list.map((r, j) => (j === i ? v : r)))} />
  );
  return (
    <div className="mk-modal">
      <Window title="Create New Guild" dlu={[269, 207]} onClose={onClose}>
        <Text at={[9, 12, 42, 8]}>Guild Name:</Text>
        <TextField at={[59, 10, 95, 14]} value={name} onChange={setName} maxLength={MAX_GUILD_NAME} autoFocus />
        <Text at={[9, 28, 255, 8]}>Tip:  Don&apos;t include the word &quot;The&quot; at the beginning of your guild name.</Text>
        <Text at={[10, 37, 255, 8]}>This will be done automatically.  (Example:  &quot;Slashers&quot; becomes &quot;The Slashers&quot;.)</Text>
        <GroupBox at={[10, 52, 247, 114]} label="Rank Names" />
        <Text at={[21, 67, 15, 8]}>Men</Text>
        <Text at={[163, 67, 26, 8]}>Women</Text>
        <Text at={[121, 81, 30, 8]}>Highest</Text>
        <Text at={[122, 145, 30, 8]}>Lowest</Text>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i}>
            {rankField(male, setMale, i, 21)}
            {rankField(female, setFemale, i, 163)}
          </span>
        ))}
        <Check at={[10, 169, 246, 10]} label="Make guild secret (guild members will not be identifiable by other guilds)" checked={secret} onChange={setSecret} />
        <Text at={[10, 191, 75, 8]}>Cost of creating guild:</Text>
        <Text at={[84, 191, 32, 10]} className="sunken">
          {secret ? secretCost : cost}
        </Text>
        <Button
          at={[156, 189, 50, 14]}
          isDefault
          onClick={() => {
            if (!name.trim()) return setError("You must specify a guild name.");
            session.send(buildGuildCreate(name.trim(), male, female, secret));
            onClose();
          }}
        >
          OK
        </Button>
        <Button at={[215, 189, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
      </Window>
      {error && <MessageBox text={error} onResult={() => setError("")} />}
    </div>
  );
}

/** guildhal.c IDD_GUILDHALLS: a hall (sorted by name, with cost and daily rent); no password since ADR 0022 */
export function GuildHallsDialog({ session, halls, onClose }: { session: GameSession; halls: GuildHall[]; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const name = (h: GuildHall) => session.resource(h.nameRes) ?? "";
  const sorted = [...halls].sort((a, b) => name(a).localeCompare(name(b)));
  const chosen = halls.find((h) => h.id === selected);
  return (
    <div className="mk-modal">
      <Window title="Rent Guild Hall" dlu={[249, 258]} onClose={onClose}>
        <Text at={[6, 4, 110, 8]}>Select a hall to house your guild:</Text>
        <ListBox
          at={[7, 16, 235, 153]}
          label="Guild halls"
          items={sorted.map((h) => ({ key: h.id, label: <span className="mail-columns" style={{ gridTemplateColumns: "1fr 5em 5em" }}><span>{name(h)}</span><span>{h.cost}</span><span>{h.rent}</span></span> }))}
          selected={selected}
          onSelect={setSelected}
        />
        <Text at={[6, 180, 60, 8]}>Selected guild hall:</Text>
        <Text at={[98, 179, 144, 11]} className="sunken">
          {chosen ? name(chosen) : ""}
        </Text>
        <Text at={[6, 198, 236, 24]}>Your Lords and above open the hall&apos;s sanctum by saying &quot;open&quot; inside it.</Text>
        <Button
          at={[66, 237, 50, 14]}
          isDefault
          onClick={() => {
            if (selected === null) return;
            if (!chosen) return setError("Select a guild hall first.");
            // The protocol still carries a password; the server ignores it
            session.send(buildGuildRent(selected, ""));
            onClose();
          }}
        >
          OK
        </Button>
        <Button at={[132, 237, 50, 14]} onClick={onClose}>
          Cancel
        </Button>
      </Window>
      {error && <MessageBox text={error} onResult={() => setError("")} />}
    </div>
  );
}

/** command.c CommandGuild: ask for the guild window (UC_REQ_GUILDINFO); the server answers UC_GUILDINFO */
export const buildReqGuildInfo = (): Uint8Array => buildUserCommand(UC.REQ_GUILDINFO);
