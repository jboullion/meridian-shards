// The login dialog (clientd3d/login.c LoginDialogProc, client.rc IDD_LOGIN 251 x 175 DLU) on
// the tiled background. Our server makes an account the first time a name logs in, so the
// "New to ..." box says so, as the Server 104 template does. In the browser there's one server
// (the page's own), so the Server field is left out and the box moves up; the desktop app has
// the template's Server field as a drop-down of the servers it knows.

import { useEffect, useState, type FormEvent } from "react";
import type { AssetStore } from "../assets.ts";
import { desktop, devPagesEnabled, type DesktopBridge, type DesktopUpdate } from "../host.ts";
import { Backdrop, Button, GroupBox, MessageBox, Select, Text, TextField, Window, at, type Rect } from "./ui/kit.tsx";

/** Control rectangles: client.rc IDD_LOGIN (251 x 175) for the desktop, the same less the Server row for the browser. */
const LAYOUT = desktop
  ? {
      size: [251, 175] as const,
      intro: [36, 6, 206, 18] as Rect,
      newBox: [37, 33, 207, 49] as Rect,
      newText: [45, 49, 190, 29] as Rect,
      accountBox: [37, 94, 207, 69] as Rect,
      nameLabel: [43, 110, 48, 10] as Rect,
      name: [93, 107, 143, 13] as Rect,
      passLabel: [43, 123, 48, 10] as Rect,
      pass: [93, 121, 143, 13] as Rect,
      serverLabel: [43, 139, 48, 10] as Rect,
      server: [93, 137, 143, 13] as Rect,
      ok: [137, 155, 100, 14] as Rect,
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

function readRemembered(): string {
  try {
    return localStorage.getItem("shards.username") ?? "";
  } catch {
    return "";
  }
}

export function LoginScreen({
  assets, onLogin, error, onClearError, initialUsername, initialPassword,
}: {
  assets: AssetStore;
  /** The desktop app's /U and /W (the original fills its login dialog from them) */
  initialUsername?: string;
  initialPassword?: string;
  onLogin: (u: string, p: string) => void;
  error: string | null;
  onClearError: () => void;
}) {
  const [username, setUsername] = useState(() => initialUsername ?? readRemembered());
  const [password, setPassword] = useState(initialPassword ?? "");
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  useEffect(() => desktop?.onUpdate(setUpdate), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim() && password) onLogin(username.trim(), password);
  };
  return (
    <Backdrop>
      <h1 className="mk-shard-title">Meridian Shards</h1>
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
          <TextField at={LAYOUT.name} value={username} onChange={setUsername} autoFocus={!username} autoComplete="username" />
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
          <Button at={LAYOUT.ok} type="submit" isDefault disabled={!username.trim() || !password}>
            Log In
          </Button>
        </form>
      </Window>
      <p className="mk-footnote">
        {devPagesEnabled && <a href="?viewer">Room viewer</a>}
        {desktop && !update && <span>Version {desktop.version}</span>}
        {desktop && update && (
          <span className="update">
            Version {update.version} is ready.{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), desktop?.installUpdate())}>
              Restart to update
            </a>
          </span>
        )}
      </p>
      {error && <MessageBox text={error} onResult={onClearError} />}
    </Backdrop>
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
      <h1 className="mk-shard-title">Meridian Shards</h1>
      <Window title="Meridian Shards" className="mk-message">
        <p className="mk-status">Connecting…</p>
      </Window>
    </Backdrop>
  );
}
