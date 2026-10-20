// The agent's body in the real client (docs/adr/0020-ai-playtester.md, phase 2): Playwright opens
// the dev client, logs in as tools/screenshots/capture.ts does, and loads inpage.ts into the page,
// which answers the game tools on the page's own session. Screenshots come from here: the page as
// the player sees it, or the 3D view alone (gameScene.ts captureView).

import { chromium, type Browser, type Page } from "@playwright/test";
import type { PageAgent } from "./inpage.ts";
import type { PlayContext } from "./play.ts";

export interface BrowserOptions {
  /** The dev client (npm run dev) */
  url: string;
  user: string;
  password: string;
  /** The character to pick (the first when not given) */
  character?: string;
  /** Show the browser window (to watch it play) */
  headed: boolean;
  /** "msedge" (the installed Edge, as the screenshot tour) or "chromium" */
  channel: string;
  /** This repo, for the page to import inpage.ts from (Vite's /@fs/) */
  root: string;
}

type AgentWindow = Window & {
  shards?: { session: { world: { player: unknown } }; gameScene: { captureView(): Promise<HTMLCanvasElement> } };
  shardsAgent?: PageAgent;
};

/** The page's settings (settings.ts), written before it loads, as the screenshot tour does */
const SETTINGS = {
  version: 9999,
  interfaceStyle: "modern",
  touchControls: "off",
  showFps: false,
  // No first-time Controls window over the view
  seenControls: true,
};
const VIEWPORT = { width: 1280, height: 720 };

export class BrowserBody {
  readonly opts: BrowserOptions;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(opts: BrowserOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return !!this.page && !this.page.isClosed();
  }

  /** Opens the client, logs in, picks the character and loads the agent into the page */
  async connect(): Promise<void> {
    if (this.connected) throw new Error("Already connected.");
    const { url, channel, headed } = this.opts;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      throw new Error(`The client isn't up at ${url} (${(e as Error).message}): start it with npm run dev.`, { cause: e });
    }
    this.browser ??= await chromium.launch({
      headless: !headed,
      channel: channel === "chromium" ? undefined : channel,
      // The real GPU: SwiftShader is slow and draws differently (capture.ts)
      args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"],
    });
    const context = await this.browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript((s) => {
      try {
        localStorage.setItem("shards.settings", s);
      } catch {
        // no storage: the defaults
      }
    }, JSON.stringify(SETTINGS));
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error(`agent page: ${e.message}`));
    try {
      await this.logIn(page);
      const path = `/@fs/${this.opts.root.replace(/\\/g, "/").replace(/^\/?/, "")}/tools/agent/inpage.ts`;
      await page.evaluate(async (p) => {
        const m = (await import(/* @vite-ignore */ p)) as { start(): Promise<void> };
        await m.start();
      }, path);
    } catch (e) {
      await context.close();
      throw e;
    }
    this.page = page;
  }

  /** capture.ts logIn: the login screen's button, the form, the character list */
  private async logIn(page: Page): Promise<void> {
    const { url, user, password, character } = this.opts;
    await page.goto(url);
    const opener = page.locator(".login-button");
    await Promise.race([opener.waitFor({ timeout: 30_000 }), page.locator("form input").first().waitFor({ timeout: 30_000 })]);
    if (await opener.isVisible()) await opener.click();
    const fields = page.locator("form input");
    await fields.nth(0).fill(user);
    await fields.nth(1).fill(password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    const list = page.getByRole("listbox", { name: "Characters" });
    await list.waitFor({ timeout: 30_000 });
    const option = character ? list.getByRole("option", { name: character, exact: true }) : list.getByRole("option").first();
    if (!(await option.count())) throw new Error(`${user} has no character${character ? ` named ${character}` : ""}.`);
    await option.click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(() => !!(window as AgentWindow).shards?.session.world.player, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
  }

  private get live(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("Not in the game: call connect first.");
    return this.page;
  }

  /** A game tool, answered in the page (play.ts) */
  async call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    return this.live.evaluate(([n, a]) => (window as AgentWindow).shardsAgent!.call(n, a), [name, args] as const);
  }

  context(): Promise<PlayContext> {
    return this.live.evaluate(() => (window as AgentWindow).shardsAgent!.context());
  }

  /** A PNG of the page as the player sees it, or (hud false) the 3D view alone */
  async screenshot(hud: boolean): Promise<Buffer> {
    const page = this.live;
    if (hud) return page.screenshot();
    const data = await page.evaluate(async () => (await (window as AgentWindow).shards!.gameScene.captureView()).toDataURL("image/png"));
    return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  }

  async disconnect(): Promise<void> {
    const page = this.page;
    this.page = null;
    if (page && !page.isClosed()) await page.context().close();
  }

  async close(): Promise<void> {
    await this.disconnect();
    await this.browser?.close();
    this.browser = null;
  }
}
