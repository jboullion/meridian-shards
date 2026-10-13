// Takes the screenshots in a manifest with the browser client: the Classic and Modern interfaces on
// the desktop and the phone layout, each from the same squares and facing. shots.json (the default)
// has the comparison and showcase shots; backgrounds.json the login screen's backgrounds, without
// the interface. Needs the local stack (npm run dev): it logs in through the page, and moves the
// character (and gives it its mace and shield, if the manifest has equipment) through the
// maintenance port.
//
//   npm run shots                                 every shot for classic, modern and mobile
//   npm run shots -- --only raza-pond,inn-room    some shots
//   npm run shots -- --client mobile              one client
//   npm run shots -- --headed                     watch it
//   npm run shots:backgrounds                     backgrounds.json (--manifest backgrounds.json)
//
// Shots land in <out>/<id>/<client>.png: the manifest's "out" (ReferenceImages/comparisons for
// shots.json), or --out. The hand-taken original.png and meridian-unreal's unreal.png go there too,
// and <out>/index.json lists every shot with a picture so far. A manifest with "web" also gets a
// smaller copy of each picture for the game to show (<id>/<client>.webp: the login screen's
// backgrounds, copied into the game files by npm run assets); --web-only makes them from the
// pictures already taken, without the local stack. README.md says more.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Maint } from "./maint.ts";

type Client = "classic" | "modern" | "mobile";
const CLIENTS: Client[] = ["classic", "modern", "mobile"];

interface Shot {
  id: string;
  title: string;
  note?: string;
  rid?: number;
  row?: number;
  col?: number;
  angle?: number;
  /** The first-person look's pitch in degrees, negative looks down */
  pitch?: number;
  /** The time of day (a DM command: morning, afternoon, evening, night), else the manifest's */
  time?: string;
  tags?: string[];
  clients: string[];
  steps: string[];
}
interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}
interface Manifest {
  account: { user: string; password: string; character: string };
  time: string;
  /** Where the shots go, from the repository's root (--out overrides it) */
  out?: string;
  /** false: the 3D view alone, without the interface, the hands, names or the title bar */
  hud?: boolean;
  /** Each client's window, instead of newContext's */
  viewports?: Partial<Record<Client, Viewport>>;
  equipment?: string[];
  /** A copy of each picture for the game to show: WebP at this quality (0-1), each client's no wider than `width` */
  web?: { quality: number; width?: Partial<Record<Client, number>> };
  shots: Shot[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const { values: opt } = parseArgs({
  options: {
    manifest: { type: "string", default: "shots.json" },
    only: { type: "string" },
    client: { type: "string" },
    out: { type: "string" },
    url: { type: "string", default: "http://localhost:5173/" },
    headed: { type: "boolean", default: false },
    // Only the manifest's web copies, from the pictures already taken
    "web-only": { type: "boolean", default: false },
    // The installed Edge, as the website's tests use; "chromium" for Playwright's own
    channel: { type: "string", default: "msedge" },
  },
});

const manifest = JSON.parse(readFileSync(resolve(here, opt.manifest!), "utf8")) as Manifest;
const out = opt.out ? resolve(opt.out) : join(root, manifest.out ?? join("ReferenceImages", "comparisons"));
const hud = manifest.hud !== false;
const equipment = manifest.equipment ?? [];
const only = opt.only ? new Set(opt.only.split(",").map((s) => s.trim())) : null;
const clients = opt.client ? (opt.client.split(",").map((s) => s.trim()) as Client[]) : CLIENTS;
for (const c of clients) if (!CLIENTS.includes(c)) throw new Error(`unknown client "${c}" (${CLIENTS.join(", ")})`);
if (only) for (const id of only) if (!manifest.shots.some((s) => s.id === id)) throw new Error(`no shot "${id}" in ${opt.manifest}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(s);

// ---- what the page exposes in development (gameScene.ts: window.shards) ----

interface PageShards {
  gameScene: {
    mover: { x: number; y: number; angle: number; setAngle(a: number): void };
    viewMode: string;
    setViewMode(m: string): void;
    press(a: string): void;
    captureView(): Promise<HTMLCanvasElement>;
    arenaView: { phase: string } | null;
    ambientLife?: { objects(): { x: number; y: number }[] } | null;
  };
  session: {
    world: {
      player: { id: number; roomId: number } | null;
      bgOverlays: Map<number, { info: { id: number; angle: number; height: number } }>;
      inventory: Map<number, { id: number; nameRes: number; iconRes: number }>;
      inUse: Set<number>;
      spells: Map<number, { object: { nameRes: number; iconRes: number } }> | { object: { nameRes: number; iconRes: number } }[];
    };
    use(id: number): void;
    say(text: string, kind: number): void;
    requestTurn(angle: number): void;
  };
}
type ShardsWindow = Window & { shards?: PageShards };
const SAY_DM = 9;

// ---- the page's settings for each client (settings.ts), written before it loads ----

function settingsFor(client: Client) {
  return {
    // Past every migration (settings.ts migrate), so these stay as written
    version: 9999,
    interfaceStyle: client === "classic" ? "classic" : "modern",
    touchControls: client === "mobile" ? "on" : "off",
    // The same sky everywhere: no rain or snow, and no frame counter in the picture
    weather: false,
    showFps: false,
  };
}

async function newContext(browser: Browser, client: Client): Promise<BrowserContext> {
  const size = manifest.viewports?.[client];
  const viewport = size ? { width: size.width, height: size.height } : undefined;
  const context =
    client === "mobile"
      ? await browser.newContext({
          // A landscape phone (the game turns landscape after login): about a Pixel 7's
          viewport: viewport ?? { width: 915, height: 412 },
          deviceScaleFactor: size?.deviceScaleFactor ?? 2.625,
          isMobile: true,
          hasTouch: true,
          userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        })
      : await browser.newContext({ viewport: viewport ?? { width: 1600, height: 900 }, deviceScaleFactor: size?.deviceScaleFactor ?? 1 });
  const settings = JSON.stringify(settingsFor(client));
  await context.addInitScript((s) => {
    try {
      localStorage.setItem("shards.settings", s);
    } catch {
      // no storage: the defaults
    }
  }, settings);
  return context;
}

// ---- logging in (Intro.tsx, LoginScreen.tsx, CharacterSelect.tsx) ----

async function logIn(page: Page): Promise<void> {
  const { user, password, character } = manifest.account;
  await page.goto(opt.url!);
  // The Login window opens from the login screen's Log in button (LoginScreen.tsx); it's open at
  // once after a failed login
  const opener = page.locator(".login-button");
  await Promise.race([opener.waitFor({ timeout: 30_000 }), page.locator("form input").first().waitFor({ timeout: 30_000 })]);
  if (await opener.isVisible()) await opener.click();
  const fields = page.locator("form input");
  await fields.nth(0).fill(user);
  await fields.nth(1).fill(password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  const list = page.getByRole("listbox", { name: "Characters" });
  await list.waitFor({ timeout: 30_000 });
  const option = list.getByRole("option", { name: character, exact: true });
  if (!(await option.count())) throw new Error(`${user} has no character "${character}": make it once (tools/screenshots/README.md)`);
  await option.click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForFunction(() => !!(window as ShardsWindow).shards?.session.world.player, null, { timeout: 60_000 });
  await sleep(1500);
}

// ---- the server side (maintenance port) ----

async function playerId(m: Maint): Promise<number> {
  const name = manifest.account.character;
  return m.objectId(`show user ${name}`, new RegExp(`^\\s*\\d+\\s+(\\d+)\\s+\\w+\\s+${name}\\s*$`, "m"));
}

async function className(m: Maint, id: number): Promise<string | null> {
  const answer = await m.run(`show object ${id}`);
  return /OBJECT \d+ is CLASS (\w+)/.exec(answer)?.[1] ?? null;
}

/** Gives the character its mace and shield if it hasn't them, and wields and wears them. */
async function equip(page: Page, m: Maint): Promise<void> {
  const inventory = () =>
    page.evaluate(() => {
      const w = (window as ShardsWindow).shards!.session.world;
      return [...w.inventory.values()].map((o) => ({ id: o.id, inUse: w.inUse.has(o.id) }));
    });
  const found = new Map<string, { id: number; inUse: boolean }>();
  for (const item of await inventory()) {
    const cls = await className(m, item.id);
    if (cls && equipment.includes(cls) && !found.has(cls)) found.set(cls, item);
  }
  const player = await playerId(m);
  for (const cls of equipment) {
    if (found.has(cls)) continue;
    const id = await m.objectId(`create object ${cls}`, /Created object (\d+)/);
    await m.run(`send object ${player} NewHold what object ${id}`);
    await page.waitForFunction((i) => (window as ShardsWindow).shards!.session.world.inventory.has(i), id, { timeout: 10_000 });
    found.set(cls, { id, inUse: false });
    log(`  gave ${manifest.account.character} a ${cls}`);
  }
  for (const item of found.values()) if (!item.inUse) await page.evaluate((i) => (window as ShardsWindow).shards!.session.use(i), item.id);
  const ids = [...found.values()].map((i) => i.id);
  await page.waitForFunction((list) => list.every((i) => (window as ShardsWindow).shards!.session.world.inUse.has(i)), ids, { timeout: 10_000 });
}

/** Puts the character in a room at a square's centre, facing `angle`. */
async function place(page: Page, m: Maint, shot: Shot): Promise<void> {
  const player = await playerId(m);
  const roomOf = async () => (await m.property(player, "poOwner"))?.replace(/^OBJECT\s+/, "") ?? "";
  await m.run(`send object ${player} TeleportTo rid int ${shot.rid}`);
  const room = await roomOf();
  if (!room || room === "$ 0") throw new Error(`${shot.id}: TeleportTo ${shot.rid} left the character nowhere`);
  // System's UtilGoNearSquare moves within a room (NewHold won't for someone already there); the
  // maintenance port takes 5 parameters at most, so the square's centre (fine 32, 32)
  const moved = await m.run(
    `send object 0 UtilGoNearSquare what object ${player} where object ${room} new_row int ${shot.row} new_col int ${shot.col} new_angle int ${shot.angle}`,
  );
  if (!/INT 1/.test(moved)) throw new Error(`${shot.id}: UtilGoNearSquare failed:\n${moved}`);
  const want = { x: (shot.col! - 1) * 1024 + 512, y: (shot.row! - 1) * 1024 + 512 };
  await page.waitForFunction(
    (w) => {
      const s = (window as ShardsWindow).shards!;
      const m = s.gameScene.mover;
      return Math.abs(m.x - w.x) < 64 && Math.abs(m.y - w.y) < 64;
    },
    want,
    { timeout: 20_000 },
  );
  // The facing is ours to keep: turn the client too, in case the server's turn hasn't reached it
  await page.evaluate((a) => {
    const s = (window as ShardsWindow).shards!;
    s.gameScene.mover.setAngle(a);
    s.session.requestTurn(a);
  }, shot.angle!);
}

/** Sets the time of day for everyone on the server (dm.kod: an hour each) and waits for the sun or moon to move. */
async function setTime(page: Page, time: string): Promise<void> {
  const sky = () =>
    page.evaluate(() =>
      [...(window as ShardsWindow).shards!.session.world.bgOverlays.values()].map((b) => `${b.info.id}:${b.info.angle}:${b.info.height}`).join(","),
    );
  const before = await sky();
  await page.evaluate(({ t, dm }) => (window as ShardsWindow).shards!.session.say(t, dm), { t: time, dm: SAY_DM });
  // Nothing moves if it was that hour already
  for (let waited = 0; waited < 8000 && (await sky()) === before; waited += 250) await sleep(250);
}

/** The first-person look's pitch (gameScene.ts pitch: radians, up positive). Entering a room levels it. */
async function setPitch(page: Page, degrees: number): Promise<void> {
  await page.evaluate((p) => {
    ((window as ShardsWindow).shards!.gameScene as unknown as Record<string, unknown>).pitch = p;
  }, (degrees * Math.PI) / 180);
}

/** The 3D view as the next frame draws it (gameScene.ts captureView), with nothing over it. */
async function captureView(page: Page, file: string): Promise<void> {
  const url = await page.evaluate(async () => (await (window as ShardsWindow).shards!.gameScene.captureView()).toDataURL("image/png"));
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}

// ---- the steps (README.md) ----

async function runSteps(page: Page, client: Client, shot: Shot): Promise<void> {
  for (const step of shot.steps) {
    const [name, ...args] = step.split(":");
    switch (name) {
      case "inventory":
        if (client === "mobile") await page.getByRole("button", { name: "Inventory, spells and map" }).click();
        else await page.evaluate(() => (window as ShardsWindow).shards!.gameScene.press("inventory"));
        break;
      case "hideHud":
        await page.evaluate(() => (window as ShardsWindow).shards!.gameScene.press("hideInterface"));
        break;
      case "view":
        await page.evaluate((v) => (window as ShardsWindow).shards!.gameScene.setViewMode(v), args[0]!);
        break;
      case "chase": {
        // chase:<camera heading 0-4095>:<pitch, radians (negative looks down)>:<arm, squares>
        const [heading, pitch, arm] = args.map(Number);
        await page.evaluate(
          ({ heading, pitch, arm }) => {
            const g = (window as ShardsWindow).shards!.gameScene as unknown as Record<string, unknown> & PageShards["gameScene"];
            g.setViewMode("chase");
            g.chaseAngle = heading;
            g.pitch = pitch;
            g.arm = arm * 1024;
          },
          { heading: heading!, pitch: pitch!, arm: arm! },
        );
        break;
      }
      case "wheel": {
        // Hold the Cast button until the ring opens (QuickSlots.tsx QuickWheel, HOLD_MS)
        // with a real touch that stays down (the button captures the pointer, so a made-up event won't do)
        const box = (await page.locator(".touch-button.cast").boundingBox())!;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
        });
        await page.locator(".quick-wheel").waitFor({ state: "attached", timeout: 5000 });
        break;
      }
      case "arenaFight": {
        // The arena's fights (ADR 0007) rest between bouts: wait for one, then for it to get going
        const fighting = await page
          .waitForFunction(() => (window as ShardsWindow).shards!.gameScene.arenaView?.phase === "fight", null, { timeout: 240_000, polling: 500 })
          .then(() => true, () => false);
        if (fighting) await sleep(Number(args[0] ?? 4) * 1000);
        else log(`  ${shot.id}: no bout in the arena`);
        break;
      }
      case "login":
        break;
      default:
        throw new Error(`${shot.id}: unknown step "${step}"`);
    }
  }
}

// ---- the phone's quick slots: the character's spells, and the last one on the Cast button ----

async function fillQuickSlots(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ character }) => {
      const w = (window as ShardsWindow).shards!.session.world;
      const spells = [...(w.spells instanceof Map ? w.spells.values() : w.spells)];
      if (!spells.length) return false;
      const slots: unknown[] = Array.from({ length: 20 }, () => null);
      spells.slice(0, 10).forEach((s, i) => (slots[i] = { kind: "spell", nameRes: s.object.nameRes, name: "", icon: s.object.iconRes }));
      const server = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      const key = `${server}.${character.toLowerCase()}`;
      const had = localStorage.getItem(`shards.quickslots.${key}`);
      const next = JSON.stringify(slots);
      localStorage.setItem(`shards.quickslots.${key}`, next);
      localStorage.setItem(`shards.quickslots.last.${key}`, "0");
      return had !== next;
    },
    { character: manifest.account.character },
  );
}

// ---- one client's shots ----

async function settle(page: Page): Promise<void> {
  // Textures and sprites arrive after the room; notes ("First person") fade after a moment
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(3500);
  // The Modern chat shows new lines for 10 s (GameView.tsx CHAT_FRESH_MS), then fades them (not in
  // the 3D view alone)
  if (hud) {
    await page.waitForFunction(() => !document.querySelector(".chat-line.fresh"), null, { timeout: 30_000 }).catch(() => {});
    // and the fade itself takes 0.6 s
    await sleep(1000);
  }
  // Our townsfolk wander (packages/world ambient/): wait a while for none to stand right in front
  await page
    .waitForFunction(
      () => {
        const g = (window as ShardsWindow).shards!.gameScene;
        const walkers = g.ambientLife?.objects() ?? [];
        const a = (g.mover.angle * 2 * Math.PI) / 4096;
        return walkers.every((o) => {
          const dx = (o.x - g.mover.x) / 1024,
            dy = (o.y - g.mover.y) / 1024;
          const ahead = dx * Math.cos(a) + dy * Math.sin(a);
          const side = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
          return !(ahead > -1 && ahead < 5 && side < ahead * 0.6 + 1.5);
        });
      },
      null,
      { timeout: 20_000, polling: 250 },
    )
    .catch(() => log("  (someone is still in front of the camera)"));
}

async function runClient(browser: Browser, client: Client, shots: Shot[]): Promise<number> {
  log(`\n${client}: ${shots.length} shot(s)`);
  const context = await newContext(browser, client);
  let page = await context.newPage();
  page.on("pageerror", (e) => log(`  page error: ${e.message}`));
  const m = await Maint.open();
  let taken = 0;
  try {
    await logIn(page);
    if (client === "mobile" && hud && (await fillQuickSlots(page))) {
      // The game reads its quick slots on entering: go round again with them in place
      await page.close();
      page = await context.newPage();
      await logIn(page);
    }
    if (equipment.length) await equip(page, m);
    let time = "";
    let dirty = false;
    for (const shot of shots) {
      // A shot after one with steps starts from a fresh page, so no window or camera view is left over
      if (dirty) {
        await page.close();
        page = await context.newPage();
        await logIn(page);
      }
      const want = shot.time ?? manifest.time;
      if (want !== time) {
        await setTime(page, want);
        time = want;
      }
      await place(page, m, shot);
      await settle(page);
      try {
        await runSteps(page, client, shot);
      } catch (e) {
        // what the page showed when a step failed, beside where the shot would go
        const failed = join(out, shot.id, `${client}-failed.png`);
        mkdirSync(dirname(failed), { recursive: true });
        await page.screenshot({ path: failed }).catch(() => {});
        const first = (e as Error).message.split(/\r?\n/)[0];
        throw new Error(`${shot.id} (${client}): ${first} (the page: ${failed})`, { cause: e });
      }
      // After the steps, as a camera view levels the look
      if (shot.pitch !== undefined) await setPitch(page, shot.pitch);
      await sleep(shot.steps.length ? 1500 : 0);
      const dir = join(out, shot.id);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${client}.png`);
      if (hud) await page.screenshot({ path: file });
      else await captureView(page, file);
      log(`  ${shot.id} -> ${file}`);
      taken++;
      dirty = shot.steps.some((s) => !s.startsWith("arenaFight"));
    }
  } finally {
    m.close();
    await context.close();
  }
  return taken;
}

/**
 * <out>/index.json: every shot with a picture so far, its pictures by client (unreal.png and
 * original.png too), and their web copies
 */
function writeIndex(): void {
  const index = manifest.shots.flatMap((s) => {
    const files: Record<string, string> = {};
    const web: Record<string, string> = {};
    for (const c of [...CLIENTS, "unreal", "original"]) {
      if (existsSync(join(out, s.id, `${c}.png`))) files[c] = `${s.id}/${c}.png`;
      if (existsSync(join(out, s.id, `${c}.webp`))) web[c] = `${s.id}/${c}.webp`;
    }
    if (!Object.keys(files).length) return [];
    return [{ id: s.id, title: s.title, tags: s.tags ?? [], time: s.time ?? manifest.time, files, ...(Object.keys(web).length ? { web } : {}) }];
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

/**
 * The manifest's web copies: each picture newer than its <id>/<client>.webp, made smaller by the
 * browser itself (no image library): drawn into a canvas no wider than the client's `width`, then
 * encoded as WebP. Unreal's pictures too, as the "modern" size.
 */
async function writeWebCopies(browser: Browser): Promise<number> {
  const web = manifest.web;
  if (!web) return 0;
  const page = await browser.newPage();
  let made = 0;
  try {
    for (const s of manifest.shots) {
      if (only && !only.has(s.id)) continue;
      for (const c of [...CLIENTS, "unreal"]) {
        const png = join(out, s.id, `${c}.png`);
        const webp = join(out, s.id, `${c}.webp`);
        if (!existsSync(png) || (existsSync(webp) && statSync(webp).mtimeMs >= statSync(png).mtimeMs)) continue;
        const max = web.width?.[c === "unreal" ? "modern" : (c as Client)] ?? Infinity;
        await page.goto(pathToFileURL(png).href);
        const url = await page.evaluate(
          async ({ max, quality }) => {
            const img = document.images[0]!;
            await img.decode();
            const scale = Math.min(1, max / img.naturalWidth);
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const ctx = canvas.getContext("2d")!;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/webp", quality);
          },
          { max, quality: web.quality },
        );
        if (!url.startsWith("data:image/webp")) throw new Error(`${s.id} (${c}): this browser can't write WebP`);
        writeFileSync(webp, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
        made++;
      }
    }
  } finally {
    await page.close();
  }
  return made;
}

async function checkStack(): Promise<void> {
  try {
    const r = await fetch(opt.url!);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    throw new Error(`the client isn't up at ${opt.url} (${(e as Error).message}): start it with npm run dev`, { cause: e });
  }
  (await Maint.open()).close();
}

if (opt["web-only"] && !manifest.web) throw new Error(`${opt.manifest} has no "web" copies to make`);
if (!opt["web-only"]) await checkStack();
const browser = await chromium.launch({
  headless: !opt.headed,
  channel: opt.channel === "chromium" ? undefined : opt.channel,
  // The real GPU: SwiftShader is slow and draws differently
  args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"],
});
let total = 0;
let copies: number;
try {
  for (const client of opt["web-only"] ? [] : clients) {
    const shots = manifest.shots.filter((s) => s.clients.includes(client) && (!only || only.has(s.id)) && s.rid !== undefined);
    // One time of day after another, so the server's clock changes as seldom as it can (in the manifest's order within each)
    const times = [manifest.time, ...shots.map((s) => s.time ?? manifest.time)];
    shots.sort((a, b) => times.indexOf(a.time ?? manifest.time) - times.indexOf(b.time ?? manifest.time));
    if (shots.length) total += await runClient(browser, client, shots);
  }
  copies = await writeWebCopies(browser);
} finally {
  await browser.close();
  writeIndex();
}
log(`\n${total} screenshot(s)${manifest.web ? ` and ${copies} web cop${copies === 1 ? "y" : "ies"}` : ""} in ${out}`);
