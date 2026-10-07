// The login dialog (clientd3d/login.c LoginDialogProc, client.rc IDD_LOGIN 251 x 175 DLU) on
// the tiled background. Our server makes an account the first time a name logs in, so the
// "New to ..." box says so, as the Server 104 template does. There's one server: no Server field.

import { useState, type FormEvent } from "react";
import type { AssetStore } from "../assets.ts";
import { Backdrop, Button, GroupBox, MessageBox, Text, TextField, Window, at } from "./ui/kit.tsx";

function readRemembered(): string {
  try {
    return localStorage.getItem("shards.username") ?? "";
  } catch {
    return "";
  }
}

export function LoginScreen({
  assets, onLogin, error, onClearError,
}: {
  assets: AssetStore;
  onLogin: (u: string, p: string) => void;
  error: string | null;
  onClearError: () => void;
}) {
  const [username, setUsername] = useState(readRemembered);
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim() && password) onLogin(username.trim(), password);
  };
  return (
    <Backdrop>
      <h1 className="mk-shard-title">Meridian Shards</h1>
      <Window title="Meridian Shards Login" dlu={[251, 160]}>
        <form onSubmit={submit}>
          <img className="mk-login-icon" src={assets.url("ui/icon1.ico")} alt="" style={at([6, 6, 20, 20])} />
          <Text at={[36, 6, 206, 18]} wrap>
            Meridian Shards is a game played over the Internet. To play, you must have an account with the central server.
          </Text>
          <GroupBox at={[37, 31, 207, 49]} label="New to Meridian Shards" />
          <Text at={[45, 47, 190, 29]} wrap>
            If you don't have an account simply enter your desired account info and it will be made automatically!
          </Text>
          <GroupBox at={[37, 88, 207, 66]} label="Enter Your Account Information" />
          <Text at={[43, 105, 48, 10]}>Login name:</Text>
          <TextField at={[93, 102, 143, 13]} value={username} onChange={setUsername} autoFocus={!username} autoComplete="username" />
          <Text at={[43, 121, 48, 10]}>Password:</Text>
          <TextField
            at={[93, 118, 143, 13]}
            value={password}
            onChange={setPassword}
            password
            autoFocus={!!username}
            autoComplete="current-password"
          />
          <Button at={[137, 136, 100, 14]} type="submit" isDefault disabled={!username.trim() || !password}>
            Log In
          </Button>
        </form>
      </Window>
      <p className="mk-footnote">
        <a href="?viewer">Room viewer</a>
      </p>
      {error && <MessageBox text={error} onResult={onClearError} />}
    </Backdrop>
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
