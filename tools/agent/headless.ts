// The agent's body without a browser (docs/adr/0020-ai-playtester.md): it logs in with a
// GameSession of its own in Node, set up like the headless tools' (tools/headless/quest.ts), and
// ticks the world as the client's frame would.

import { GameSession } from "../../packages/world/src/index.ts";
import type { GameData } from "./assets.ts";
import { Body, sleep } from "./body.ts";

export interface LoginOptions {
  gateway: string;
  user: string;
  password: string;
  /** The character to play (the first when not given); a new account's is made with this name */
  character?: string;
}

/** How long logging in may take before connect() gives up */
const CONNECT_MS = 60_000;

export class HeadlessBody extends Body {
  readonly login: LoginOptions;
  private readonly files: GameData;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private leaving = false;
  private onFail: (why: string) => void = () => {};

  constructor(login: LoginOptions, data: GameData) {
    super(data);
    this.login = login;
    this.files = data;
  }

  /** Logs in and enters the game */
  async connect(): Promise<void> {
    if (this.session && this.session.phase !== "closed") throw new Error("Already connected.");
    this.leaving = false;
    const entered = this.next("inGame", CONNECT_MS);
    const failed = new Promise<string>((resolve) => (this.onFail = resolve));
    this.session = this.makeSession();
    const result = await Promise.race([entered.then((v) => (v ? null : "Timed out logging in.")), failed]);
    if (result) {
      this.session.close();
      this.session = null;
      throw new Error(result);
    }
  }

  disconnect(): void {
    this.leaving = true;
    this.session?.close();
    this.session = null;
    this.detach();
    this.stopTicking();
  }

  private makeSession(): GameSession {
    const { login, files } = this;
    const own = this.sessionEvents();
    const session: GameSession = new GameSession(
      { url: login.gateway, username: login.user, password: login.password, secretKey: files.secretKey, lookupResource: (id, lang) => files.rsb.get(id, lang) },
      {
        ...own,
        phase: (p) => {
          if (p === "characters") this.pickCharacter(session);
          if (p === "game") void this.entered(session);
          if (p === "closed") {
            this.stopTicking();
            if (!this.leaving) {
              this.log("error", "Disconnected from the server. Call connect to log in again.");
              this.onFail("The connection closed while logging in (wrong password, or the server's down?).");
            }
          }
        },
        error: (e) => {
          own.error?.(e);
          if (session.phase !== "game") this.onFail(e);
        },
      },
    );
    this.watchWorld(session);
    return session;
  }

  private pickCharacter(session: GameSession): void {
    const { character, user } = this.login;
    const want = character?.toLowerCase();
    const ready = session.characters.filter((c) => c.flags !== 1);
    const pick = want ? ready.find((c) => c.name.toLowerCase() === want) : ready[0];
    if (pick) return session.useCharacter(pick.id);
    const blank = session.characters.find((c) => c.flags === 1);
    if (blank && character) return session.createDefaultCharacter(blank.id, character);
    this.onFail(want ? `No character named ${character} on ${user} (has: ${ready.map((c) => c.name).join(", ") || "none"}).` : `${user} has no character; pass --character <name> to make one.`);
  }

  private async entered(session: GameSession): Promise<void> {
    for (let i = 0; i < 100 && !(session.world.self && this.name(session.world.self.info.nameRes)); i++) await sleep(100);
    // world.tick moves others along their paths, as the client's frame does
    this.stopTicking();
    this.ticker = setInterval(() => session.world.tick(100), 100);
    session.shardsCommand("quest log");
    this.answer("inGame", true);
  }

  private stopTicking(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
}
