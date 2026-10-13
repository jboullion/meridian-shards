// The login dialog (clientd3d/login.c LoginDialogProc, client.rc IDD_LOGIN 251 x 175 DLU) on
// the tiled background. Our server makes an account the first time a name logs in, so the
// "New to ..." box says so, as the Server 104 template does. In the browser there's one server
// (the page's own), so the Server field is left out and the box moves up; the desktop app has
// the template's Server field as a drop-down of the servers it knows.
//
// Ours: the splash picture (Intro.tsx) behind the dialog, and the login names used before in a
// list under the name field (▾), newest first, each with × to forget it. Only names: never
// passwords (the browser's own password manager can keep those).

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AssetStore } from "../assets.ts";
import { desktop, devPagesEnabled, isAndroid, type DesktopBridge, type DesktopUpdate, type RequiredUpdate } from "../host.ts";
import { Backdrop, Button, GroupBox, MessageBox, Select, Text, TextField, Window, at, type Rect } from "./ui/kit.tsx";

/** Control rectangles: client.rc IDD_LOGIN (251 x 175, a little roomier) for the desktop, the same less the Server row for the browser. */
const LAYOUT = desktop
  ? {
      // Ours: 3 DLU more between the name and the password, 6 more before the Server
      size: [251, 184] as const,
      intro: [36, 6, 206, 18] as Rect,
      newBox: [37, 33, 207, 49] as Rect,
      newText: [45, 49, 190, 29] as Rect,
      accountBox: [37, 94, 207, 78] as Rect,
      nameLabel: [43, 110, 48, 10] as Rect,
      name: [93, 107, 143, 13] as Rect,
      passLabel: [43, 126, 48, 10] as Rect,
      pass: [93, 124, 143, 13] as Rect,
      serverLabel: [43, 148, 48, 10] as Rect,
      server: [93, 146, 143, 13] as Rect,
      ok: [137, 164, 100, 14] as Rect,
    }
  : {
      size: [251, 160] as const,
      intro: [36, 6, 206, 18] as Rect,
      newBox: [37, 31, 207, 49] as Rect,
      newText: [45, 47, 190, 29] as Rect,
      accountBox: [37, 88, 207, 66] as Rect,
      nameLabel: [43, 105, 48, 10] as Rect,
      name: [93, 102, 143, 13] as Rect,
      passLabel: [43, 121, 48, 10] as Rect,
      pass: [93, 118, 143, 13] as Rect,
      serverLabel: null,
      server: null,
      ok: [137, 136, 100, 14] as Rect,
    };

/** The login names used before, newest first (localStorage `shards.usernames`) */
const NAMES_KEY = "shards.usernames";
/** Before the list there was one name */
const OLD_NAME_KEY = "shards.username";
const MAX_NAMES = 10;

export function savedNames(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "null") as unknown;
    if (Array.isArray(list)) return list.filter((n): n is string => typeof n === "string" && n.length > 0).slice(0, MAX_NAMES);
    const old = localStorage.getItem(OLD_NAME_KEY);
    return old ? [old] : [];
  } catch {
    return [];
  }
}

function storeNames(names: string[]): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names.slice(0, MAX_NAMES)));
    localStorage.removeItem(OLD_NAME_KEY);
  } catch {
    // storage unavailable: fine
  }
}

/** A name just logged in with goes to the top of the list (names differing only in case are one) */
export function rememberName(name: string): void {
  storeNames([name, ...savedNames().filter((n) => n.toLowerCase() !== name.toLowerCase())]);
}

function forgetName(name: string): string[] {
  const names = savedNames().filter((n) => n !== name);
  storeNames(names);
  return names;
}

export function LoginScreen({
  assets, required, onLogin, error, onClearError, initialUsername, initialPassword, behind,
}: {
  assets: AssetStore;
  /** Ours: a newer version to install before anyone can log in (host.ts requiredUpdate) */
  required: RequiredUpdate | null;
  /** Ours: drawn behind the dialog (the splash picture) */
  behind?: ReactNode;
  /** The desktop app's /U and /W (the original fills its login dialog from them) */
  initialUsername?: string;
  initialPassword?: string;
  onLogin: (u: string, p: string) => void;
  error: string | null;
  onClearError: () => void;
}) {
  const [names, setNames] = useState(savedNames);
  const [username, setUsername] = useState(() => initialUsername ?? names[0] ?? "");
  const [password, setPassword] = useState(initialPassword ?? "");
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  useEffect(() => desktop?.onUpdate(setUpdate), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim() && password) onLogin(username.trim(), password);
  };
  return (
    <Backdrop behind={behind}>
      <Window title="Login" dlu={LAYOUT.size}>
        <form onSubmit={submit}>
          <img className="mk-login-icon" src={assets.url("ui/icon1.ico")} alt="" style={at([6, 6, 20, 20])} />
          <Text at={LAYOUT.intro} wrap>
            Meridian Shards is a game played over the Internet. To play, you must have an account with the central server.
          </Text>
          <GroupBox at={LAYOUT.newBox} label="New to Meridian Shards" />
          <Text at={LAYOUT.newText} wrap>
            If you don't have an account simply enter your desired account info and it will be made automatically!
          </Text>
          <GroupBox at={LAYOUT.accountBox} label="Enter Your Account Information" />
          <Text at={LAYOUT.nameLabel}>Login name:</Text>
          <NameField at={LAYOUT.name} value={username} onChange={setUsername} names={names} onForget={(n) => setNames(forgetName(n))} />
          <Text at={LAYOUT.passLabel}>Password:</Text>
          <TextField
            at={LAYOUT.pass}
            value={password}
            onChange={setPassword}
            password
            autoFocus={!!username}
            autoComplete="current-password"
          />
          {desktop && LAYOUT.serverLabel && LAYOUT.server && (
            <ServerField desktop={desktop} label={LAYOUT.serverLabel} field={LAYOUT.server} />
          )}
          <Button at={LAYOUT.ok} type="submit" isDefault disabled={!username.trim() || !password || !!required}>
            Log In
          </Button>
        </form>
      </Window>
      <p className="mk-footnote">
        {devPagesEnabled && <a href="?viewer">Room viewer</a>}
        {desktop && !update && <span>Version {desktop.version}</span>}
        {desktop && update && <UpdateNotice update={update} install={() => desktop?.installUpdate()} />}
      </p>
      {error && !required && <MessageBox text={error} onResult={onClearError} />}
      {required && <UpdateRequired required={required} update={update} />}
    </Backdrop>
  );
}

/** The login name: typed, or picked from the names used before (▾, or the down arrow) */
function NameField({
  at: r, value, onChange, names, onForget,
}: {
  at: Rect;
  value: string;
  onChange: (v: string) => void;
  names: string[];
  onForget: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const shown = open && names.length > 0;
  const pick = (name: string, el: HTMLElement) => {
    onChange(name);
    setOpen(false);
    // On to the password
    el.closest("form")?.querySelector<HTMLInputElement>("input[type=password]")?.focus();
  };
  return (
    <span className={names.length ? "mk-edit mk-combo" : "mk-edit"} style={at(r)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={!value}
        autoComplete="username"
        spellCheck={false}
        aria-label="Login name"
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!names.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!shown) {
              setOpen(true);
              setHot(Math.max(0, names.indexOf(value)));
            } else setHot((h) => (h + (e.key === "ArrowDown" ? 1 : names.length - 1)) % names.length);
          } else if (shown && e.key === "Enter") {
            e.preventDefault();
            pick(names[hot] ?? value, e.currentTarget);
          } else if (shown && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {names.length > 0 && (
        <button
          type="button"
          className="mk-combo-button"
          tabIndex={-1}
          aria-label="Login names used before"
          title="Login names used before"
          // Keeps the focus in the name, so the list doesn't close as it opens
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            setHot(Math.max(0, names.indexOf(value)));
            setOpen((o) => !o);
            e.currentTarget.parentElement?.querySelector("input")?.focus();
          }}
        >
          ▾
        </button>
      )}
      {shown && (
        <ul className="mk-list mk-combo-list" role="listbox" aria-label="Login names used before" onMouseDown={(e) => e.preventDefault()}>
          {names.map((n, i) => (
            <li
              key={n}
              role="option"
              aria-selected={i === hot}
              className={i === hot ? "selected" : undefined}
              onMouseEnter={() => setHot(i)}
              onClick={(e) => pick(n, e.currentTarget)}
            >
              <span>{n}</span>
              <button
                type="button"
                className="mk-combo-forget"
                tabIndex={-1}
                title={`Forget ${n}`}
                aria-label={`Forget ${n}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onForget(n);
                  setHot(0);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The template's Server field: the desktop app's servers; picking one reloads with its files. */
function ServerField({ desktop, label, field }: { desktop: DesktopBridge; label: Rect; field: Rect }) {
  return (
    <>
      <Text at={label}>Server:</Text>
      <Select
        at={field}
        value={desktop.server}
        options={desktop.servers.map((s) => ({ key: s.origin, label: s.name }))}
        onChange={(origin) => desktop.selectServer(origin)}
      />
    </>
  );
}

/** Waiting for the server between the login click and the character list. */
export function ConnectingScreen() {
  return (
    <Backdrop>
      <Window title="Meridian Shards" className="mk-message">
        <p className="mk-status">Connecting…</p>
      </Window>
    </Backdrop>
  );
}

/**
 * Ours: a newer version is out, and nobody plays on an old one. It can't be closed: the desktop
 * app downloads it (electron-updater) and restarts into it, or, where it can't update itself
 * (macOS, unsigned), the installer is downloaded; the Android app restarts into the new page or
 * installs the new APK; the browser reloads.
 */
function UpdateRequired({ required, update }: { required: RequiredUpdate; update: DesktopUpdate | null }) {
  const v = required.version ?? update?.version;
  const install = () => desktop?.installUpdate();
  const download = required.download && (
    <Button isDefault={!update || update.state === "error"} onClick={() => window.open(required.download!, "_blank")}>
      {isAndroid ? "Download" : "Download installer"}
    </Button>
  );
  let status: ReactNode = null;
  let action: ReactNode = null;
  const a = update?.android;
  if (required.reload) {
    status = "A new version of Meridian Shards is out.";
    action = (
      <Button isDefault onClick={() => location.reload()}>
        Reload
      </Button>
    );
  } else if (a) {
    if (a.kind === "web" && a.state === "ready") action = <Button isDefault onClick={install}>Restart to update</Button>;
    else if (a.state === "downloading") status = `Downloading${a.progress != null ? ` (${Math.floor(a.progress * 100)}%)` : ""}...`;
    else if (a.state === "permission") {
      status = "Allow Meridian Shards to install apps, then install it.";
      action = <Button isDefault onClick={install}>Install</Button>;
    } else if (a.state === "downloaded" || a.state === "installing") action = <Button isDefault onClick={install}>Install</Button>;
    else if (a.state === "error") {
      status = "It didn't download.";
      action = <Button isDefault onClick={install}>Try again</Button>;
    } else action = <Button isDefault onClick={install}>Install</Button>;
  } else if (update && (update.state ?? "ready") === "ready") action = <Button isDefault onClick={install}>Restart to update</Button>;
  else if (update?.state === "downloading")
    status = `Downloading${update.progress != null ? ` (${Math.floor(update.progress * 100)}%)` : ""}... It installs when you restart.`;
  else if (update?.state === "error") status = "It couldn't install itself: download the installer and run it.";
  return (
    <div className="mk-modal">
      <Window title="Update required" closeButton={false} className="mk-message update-required">
        <p className="mk-message-text">
          {v ? `Version ${v} of Meridian Shards is out.` : null} Please update to keep playing.
          {status && (
            <>
              <br />
              {status}
            </>
          )}
        </p>
        <div className="mk-buttons center">
          {action}
          {!isAndroid || !a ? download : null}
        </div>
      </Window>
    </div>
  );
}

/**
 * A newer version: the desktop's, downloaded and installed on restart; on Android, the page by
 * itself (ready, restart) or a new APK, downloaded and handed to Android's installer as the player
 * asks (host.ts androidBridge).
 */
function UpdateNotice({ update, install }: { update: DesktopUpdate; install: () => void }) {
  const link = (text: string) => (
    <a href="#" onClick={(e) => (e.preventDefault(), install())}>
      {text}
    </a>
  );
  const v = update.version;
  const a = update.android;
  let body;
  if (!a && update.state === "downloading") body = <>Downloading version {v}{update.progress != null ? ` (${Math.floor(update.progress * 100)}%)` : ""}...</>;
  else if (!a && update.state === "error") body = <>Version {v} didn't install itself.</>;
  else if (a?.kind === "web" && a.state === "downloading") body = <>Downloading version {v}...</>;
  else if (!a || a.kind === "web") body = <>Version {v} is ready. {link("Restart to update")}</>;
  else if (a.state === "downloading")
    body = <>Downloading version {v}{a.progress != null ? ` (${Math.floor(a.progress * 100)}%)` : ""}...</>;
  else if (a.state === "permission") body = <>Allow Meridian Shards to install apps, then {link("install it")}</>;
  else if (a.state === "downloaded" || a.state === "installing") body = <>Version {v} is downloaded. {link("Install it")}</>;
  else if (a.state === "error") body = <>Version {v} didn't download. {link("Try again")}</>;
  else body = <>Version {v} is out. {link(isAndroid ? "Install it" : "Download it")}</>;
  return <span className="update">{body}</span>;
}
