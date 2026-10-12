// Ours (docs/adr/0005-friends.md section 3): the Friends window, from the ☰ menu's Actions and the
// Friends key. Find players of this client on this server and ask them, answer requests, and per
// friend: where they are (Locate), their pin on the map (Map marker), Follow and Remove. Laid out
// in dialog units with the kit, like the original's windows.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { RelayPlayer } from "@shards/world";
import type { SocialLink } from "../social.ts";
import { Button, Check, GroupBox, ListBox, Text, TextField, Window } from "./kit.tsx";

/** Re-render whenever the friends change (presence, requests, locations) */
export function useSocial(link: SocialLink | null): number {
  const [v, setV] = useState(0);
  useEffect(() => link?.onChange(() => setV((n) => n + 1)), [link]);
  return v;
}

function Modal({ children }: { children: ReactNode }) {
  return <div className="mk-modal options-modal">{children}</div>;
}

/** "3 min", "2 h", "5 days": how long ago */
export function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

type Selected = { kind: "in" | "out"; key: string } | null;

export function FriendsWindow({
  link, inGame, onFollow, onClose,
}: {
  link: SocialLink;
  /** Whether a character is in the game (the server's online list) */
  inGame: (name: string) => boolean;
  /** Follow a friend in our room (GameView checks and starts it) */
  onFollow: (key: string) => void;
  onClose: () => void;
}) {
  useSocial(link);
  const fs = link.friends;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RelayPlayer[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [request, setRequest] = useState<Selected>(null);
  const [friendKey, setFriendKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  /** "Seen ... ago" counts from when the window opened */
  const [openedAt] = useState(() => Date.now());
  const online = fs.relayStatus === "online";

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return setStatus("Type at least two letters of a name.");
    setStatus("Searching…");
    const found = await link.client.search(q);
    setResults(found);
    setResult(found[0]?.key ?? null);
    setStatus(found.length ? "" : "Nobody playing Meridian Shards on this server has a name starting with that.");
  };

  const add = (p: RelayPlayer | undefined) => {
    if (!p) return;
    const err = fs.add(p);
    setStatus(err ?? `Asked ${p.name}. They'll see your request while you're both in the game.`);
  };

  // The first friend until one is chosen
  const friend = fs.friends.find((f) => f.key === friendKey) ?? fs.friends[0] ?? null;
  const here = friend ? link.objectOf(friend.key) !== null : false;
  const rekeyed = friend ? fs.rekeyed.has(friend.key) : false;

  const describe = (key: string): string => {
    const f = fs.friendByKey(key)!;
    if (fs.rekeyed.has(key)) return "needs pairing again";
    if (!fs.online.has(key)) {
      if (inGame(f.name)) return "in the game, not on Meridian Shards";
      return f.lastSeen ? `offline, seen ${ago(openedAt - f.lastSeen)} ago` : "offline";
    }
    const parts = [link.objectOf(key) !== null ? "here" : "online"];
    if (f.locate && link.objectOf(key) === null) {
      const loc = fs.locations.get(key);
      if (loc && "room" in loc) parts.push(link.roomName(loc.room, loc.rid));
      else if (loc) parts.push("not sharing where");
    }
    if (fs.following === key) parts.push("you follow");
    if (fs.followers.has(key)) parts.push("follows you");
    return parts.join(", ");
  };

  const requests = [
    ...fs.incoming.map((r) => ({ key: `in:${r.key}`, label: `${r.name} wants to be your friend` })),
    ...fs.outgoing.map((r) => ({ key: `out:${r.key}`, label: `You asked ${r.name}` })),
  ];
  const reqKey = request ? `${request.kind}:${request.key}` : null;
  const pickRequest = (k: string) => {
    const [kind, ...rest] = k.split(":");
    setRequest({ kind: kind as "in" | "out", key: rest.join(":") });
  };
  const incoming = request?.kind === "in" && fs.incoming.some((r) => r.key === request.key);
  const outgoing = request?.kind === "out" && fs.outgoing.some((r) => r.key === request.key);

  return (
    <Modal>
      <Window title="Friends" dlu={[300, 276]} wide onClose={onClose} className="options-dialog friends-window">
        <form onSubmit={search}>
          <Text at={[6, 6, 288, 8]}>Find players of Meridian Shards on this server:</Text>
          <TextField at={[6, 17, 180, 12]} value={query} onChange={setQuery} maxLength={30} autoFocus />
          <Button at={[192, 16, 48, 14]} type="submit" disabled={!online}>
            Search
          </Button>
        </form>
        <ListBox
          at={[6, 33, 234, 38]}
          label="Players found"
          selected={result}
          onSelect={setResult}
          onActivate={(k) => add(results?.find((p) => p.key === k))}
          items={(results ?? []).map((p) => ({
            key: p.key,
            label: fs.friendByKey(p.key) ? `${p.name} (friend)` : p.name,
          }))}
        />
        <Button at={[246, 33, 48, 14]} disabled={!online || !result} onClick={() => add(results?.find((p) => p.key === result))}>
          Add
        </Button>

        <GroupBox at={[6, 76, 288, 52]} label="Requests" />
        <ListBox
          at={[12, 88, 228, 34]}
          label="Friend requests"
          selected={reqKey}
          onSelect={pickRequest}
          items={requests}
        />
        {incoming ? (
          <>
            <Button at={[246, 88, 42, 14]} onClick={() => fs.accept(request!.key)}>
              Accept
            </Button>
            <Button at={[246, 105, 42, 14]} onClick={() => fs.decline(request!.key)}>
              Decline
            </Button>
          </>
        ) : (
          <Button at={[246, 88, 42, 14]} disabled={!outgoing} onClick={() => request && fs.cancel(request.key)}>
            Cancel
          </Button>
        )}

        <GroupBox at={[6, 132, 288, 98]} label="Friends" />
        <ListBox
          at={[12, 144, 170, 82]}
          label="Friends"
          selected={friend?.key ?? null}
          onSelect={setFriendKey}
          items={fs.friends.map((f) => ({
            key: f.key,
            className: fs.online.has(f.key) ? "friend-online" : "friend-offline",
            label: (
              <span className="friend-row">
                <b>{f.name}</b> <small>{describe(f.key)}</small>
              </span>
            ),
          }))}
        />
        <Check
          at={[188, 145, 100, 10]}
          label="Locate"
          title="Show which room they're in"
          disabled={!friend}
          checked={!!friend?.locate}
          onChange={(v) => friend && fs.setFriend(friend.key, { locate: v })}
        />
        <Check
          at={[188, 158, 100, 10]}
          label="Map marker"
          title="Their pin on the map while they're in your room"
          disabled={!friend}
          checked={!!friend?.marker}
          onChange={(v) => friend && fs.setFriend(friend.key, { marker: v })}
        />
        {rekeyed ? (
          <Button
            at={[188, 174, 48, 14]}
            title="They're playing with a new key (another device, or cleared data): ask them again"
            onClick={async () => {
              if (!friend) return;
              const p = await fs.rekeyedPlayer(friend.key);
              if (p) add(p);
              else setStatus(`${friend.name} isn't on Meridian Shards just now.`);
            }}
          >
            Pair again
          </Button>
        ) : fs.following === friend?.key ? (
          <Button at={[188, 174, 48, 14]} onClick={() => fs.stopFollowing("you chose to")}>
            Unfollow
          </Button>
        ) : (
          <Button
            at={[188, 174, 48, 14]}
            title="Walk after them (only while they're in your room)"
            disabled={!friend || !here || !fs.online.has(friend.key)}
            onClick={() => friend && onFollow(friend.key)}
          >
            Follow
          </Button>
        )}
        <Button at={[240, 174, 48, 14]} disabled={!friend} onClick={() => friend && fs.remove(friend.key)}>
          Remove
        </Button>
        {friend && fs.followers.has(friend.key) && (
          <Button at={[188, 191, 100, 14]} onClick={() => fs.stopFollower(friend.key)}>
            Stop them following
          </Button>
        )}
        <Text at={[188, 208, 100, 18]} wrap className="friends-hint">
          {fs.friends.length ? "Friends see you online, and where you are if you share it." : "No friends yet: search for someone above."}
        </Text>

        <Check at={[6, 234, 140, 10]} label="Share my location" checked={fs.options.shareLocation} onChange={(v) => fs.setOptions({ shareLocation: v })} />
        <Check at={[150, 234, 144, 10]} label="Show health bars over friends" checked={fs.options.healthBars} onChange={(v) => fs.setOptions({ healthBars: v })} />
        <Check at={[6, 246, 140, 10]} label="Show me in search" checked={fs.options.visible} onChange={(v) => fs.setOptions({ visible: v })} />
        <Check at={[150, 246, 144, 10]} label="Refuse followers" checked={fs.options.refuseFollows} onChange={(v) => fs.setOptions({ refuseFollows: v })} />

        <Text at={[6, 259, 236, 14]} wrap className="friends-note">
          {status ||
            (online
              ? "Sent through the Meridian Shards server, which keeps nothing on disk. Only players of Meridian Shards are listed."
              : fs.relayStatus === "replaced"
                ? "This character is on Meridian Shards in another window."
                : "Can't reach the Meridian Shards server: friends show offline until it's back.")}
        </Text>
        <Button at={[246, 258, 48, 14]} isDefault onClick={onClose}>
          OK
        </Button>
      </Window>
    </Modal>
  );
}

/**
 * Over the view: who follows us (with "Stop them"), whom we follow, and requests waiting. Outside
 * GameView's own state so the friends' news doesn't re-render the game.
 */
export function FriendsNotices({ link, onOpen }: { link: SocialLink | null; onOpen: () => void }) {
  useSocial(link);
  if (!link) return null;
  const fs = link.friends;
  const name = (key: string) => fs.friendByKey(key)?.name ?? "?";
  const lines: ReactNode[] = [];
  for (const k of fs.followers)
    lines.push(
      <div key={`f${k}`}>
        <span>{name(k)} is following you</span>
        <button type="button" onClick={() => fs.stopFollower(k)}>
          Stop them
        </button>
      </div>,
    );
  if (fs.following)
    lines.push(
      <div key="following">
        <span>Following {name(fs.following)}</span>
        <button type="button" onClick={() => fs.stopFollowing("you chose to")}>
          Stop
        </button>
      </div>,
    );
  for (const r of fs.incoming)
    lines.push(
      <div key={`r${r.key}`}>
        <span>{r.name} wants to be your friend</span>
        <button type="button" onClick={onOpen}>
          Friends…
        </button>
      </div>,
    );
  return lines.length ? (
    <div className="friends-notices" role="status">
      {lines}
    </div>
  ) : null;
}

/** On the full map (3, Locate): where each located friend is, when not in our room */
export function FriendsMapHint({ link }: { link: SocialLink | null }) {
  useSocial(link);
  if (!link) return null;
  const fs = link.friends;
  const rows = fs.friends.flatMap((f) => {
    if (!f.locate || !fs.online.has(f.key) || link.objectOf(f.key) !== null) return [];
    const loc = fs.locations.get(f.key);
    return loc && "room" in loc ? [{ key: f.key, text: `${f.name}: ${link.roomName(loc.room, loc.rid)}` }] : [];
  });
  return rows.length ? (
    <div className="friends-map-hint">
      {rows.map((r) => (
        <div key={r.key}>{r.text}</div>
      ))}
    </div>
  ) : null;
}
