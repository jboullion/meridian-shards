// Ours (docs/adr/0005-friends.md section 3): the Friends tab of the character window and the
// interface column (beside Inventory, Spells and the rest), from the ☰ menu's Actions and the
// Friends key too. Find players in the game and ask them, answer requests, and per friend: where
// they are (Locate), their pin on the map (Map marker), Follow and Remove. Our server keeps all of
// it (docs/adr/0015-social-on-our-server.md). It flows to fit, from the Classic column's narrow
// page to the Modern window's.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SocialLink } from "../social.ts";
import { Button, Check, ListBox } from "./kit.tsx";

/** Re-render whenever the friends change (presence, requests, locations) */
export function useSocial(link: SocialLink | null): number {
  const [v, setV] = useState(0);
  useEffect(() => link?.onChange(() => setV((n) => n + 1)), [link]);
  return v;
}

/** "3 min", "2 h", "5 days": how long ago */
export function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** A heading for a part of a panel */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function FriendsPanel({
  link, self, onFollow,
}: {
  /** The friends feature, or null while it starts */
  link: SocialLink | null;
  /** Our character's name */
  self: string;
  /** Follow a friend in our room (GameView checks and starts it) */
  onFollow: (key: string) => void;
}) {
  useSocial(link);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const [friendKey, setFriendKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  /** "Seen ... ago" counts from when the tab was shown */
  const [openedAt] = useState(() => Date.now());
  if (!link) return <div className="friends-panel panel-note">Starting…</div>;
  const fs = link.friends;
  const online = fs.ready;

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return setStatus("Type at least two letters of a name.");
    setStatus("Searching…");
    const found = await fs.search(q);
    setResults(found);
    setResult(found[0] ?? null);
    setStatus(found.length ? "" : "Nobody in the game has a name with that in it.");
  };

  const add = (name: string | null | undefined) => {
    if (!name) return;
    const err = fs.add(name, self);
    setStatus(err ?? `Asked ${name}. They'll see your request, now or when they next play.`);
  };

  // The first friend until one is chosen
  const friend = fs.friends.find((f) => f.key === friendKey) ?? fs.friends[0] ?? null;
  const here = friend ? link.objectOf(friend.key) !== null : false;

  const describe = (key: string): string => {
    const f = fs.friendByKey(key)!;
    if (!fs.online.has(key)) return f.lastSeen ? `offline, seen ${ago(openedAt - f.lastSeen)} ago` : "offline";
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
  const req = requests.find((r) => r.key === request) ?? requests[0] ?? null;
  const reqKey = req ? req.key.slice(req.key.indexOf(":") + 1) : "";
  const incoming = !!req?.key.startsWith("in:");

  return (
    <div className="friends-panel">
      <PanelSection title="Friends">
        {fs.friends.length ? (
          <ListBox
            className="panel-list"
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
        ) : (
          <p className="panel-note">No friends yet: find someone below.</p>
        )}
        {friend && (
          <div className="panel-row wrap">
            <Check label="Locate" title="Show which room they're in" checked={friend.locate} onChange={(v) => fs.setFriend(friend.key, { locate: v })} />
            <Check label="Map marker" title="Their pin on the map while they're in your room" checked={friend.marker} onChange={(v) => fs.setFriend(friend.key, { marker: v })} />
          </div>
        )}
        {friend && (
          <div className="panel-row wrap">
            {fs.following === friend.key ? (
              <Button onClick={() => fs.stopFollowing("you chose to")}>Unfollow</Button>
            ) : (
              <Button title="Walk after them (only while they're in your room)" disabled={!here || !fs.online.has(friend.key)} onClick={() => onFollow(friend.key)}>
                Follow
              </Button>
            )}
            {fs.followers.has(friend.key) && <Button onClick={() => fs.stopFollower(friend.key)}>Stop them following</Button>}
            <Button onClick={() => fs.remove(friend.key)}>Remove</Button>
          </div>
        )}
      </PanelSection>

      {requests.length > 0 && (
        <PanelSection title="Requests">
          <ListBox className="panel-list short" label="Friend requests" selected={req?.key ?? null} onSelect={setRequest} items={requests} />
          <div className="panel-row">
            {incoming ? (
              <>
                <Button onClick={() => fs.accept(reqKey)}>Accept</Button>
                <Button onClick={() => fs.decline(reqKey)}>Decline</Button>
              </>
            ) : (
              <Button onClick={() => fs.cancel(reqKey)}>Cancel request</Button>
            )}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Find players">
        <form className="panel-row" onSubmit={search}>
          <span className="mk-edit panel-grow">
            <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={30} placeholder="A name" spellCheck={false} aria-label="Find players" />
          </span>
          <Button type="submit" disabled={!online}>
            Search
          </Button>
        </form>
        {results && results.length > 0 && (
          <>
            <ListBox
              className="panel-list short"
              label="Players found"
              selected={result}
              onSelect={setResult}
              onActivate={(name) => add(name)}
              items={results.map((name) => ({ key: name, label: fs.friendByName(name) ? `${name} (friend)` : name }))}
            />
            <div className="panel-row">
              <Button disabled={!online || !result} onClick={() => add(result)}>
                Add friend
              </Button>
            </div>
          </>
        )}
      </PanelSection>

      <PanelSection title="Options">
        <Check label="Share my location" checked={fs.options.shareLocation} onChange={(v) => fs.setOptions({ shareLocation: v })} />
        <Check label="Health bars over friends" checked={fs.options.healthBars} onChange={(v) => fs.setOptions({ healthBars: v })} />
        <Check label="Show me in search" checked={fs.options.visible} onChange={(v) => fs.setOptions({ visible: v })} />
        <Check label="Refuse followers" checked={fs.options.refuseFollows} onChange={(v) => fs.setOptions({ refuseFollows: v })} />
      </PanelSection>

      <p className="panel-note">
        {status || (online ? "Your friends are kept with your character, on every device you play on." : "Asking the server for your friends…")}
      </p>
    </div>
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
