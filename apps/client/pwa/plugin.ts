// The browser client as an installable web app (docs/adr/0032-installable-web-client.md): the web
// app manifest and the service worker (sw.js, beside this file), at the root of the client's base,
// so their scope is the client: /play/manifest.webmanifest and /play/sw.js on our server
// (tools/deploy/stage.ts builds with --base /play/), /manifest.webmanifest and /sw.js on Vite's dev
// server. The build writes both unhashed (Caddy serves them no-cache) and the icons hashed beside
// the client's bundles; index.html gets the manifest's <link>. The icons are made by
// tools/icons/make-icons.ts.

import { readFileSync } from "node:fs";
import type { Plugin, ResolvedConfig } from "vite";

const ICONS = new URL("../src/icons/", import.meta.url);
const SW = new URL("./sw.js", import.meta.url);
const MANIFEST = "manifest.webmanifest";

const ICON_FILES = [
  { file: "icon-192.png", sizes: "192x192", purpose: "any" },
  { file: "icon-512.png", sizes: "512x512", purpose: "any" },
  { file: "icon-maskable-192.png", sizes: "192x192", purpose: "maskable" },
  { file: "icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
] as const;

/**
 * The manifest, for a client whose base is `base`; `iconUrl` is where each icon file is, relative
 * to the manifest. A relative base (the itch.io build's ./, which is never installed: it runs in
 * itch.io's iframe) gets a relative scope and no id.
 */
export function webAppManifest(base: string, iconUrl: (file: string) => string): Record<string, unknown> {
  const at = base.startsWith("/") ? base : "./";
  return {
    name: "Meridian Shards",
    short_name: "Meridian Shards",
    description: "Meridian Shards: Meridian 59, the classic online role-playing game, in your browser.",
    ...(base.startsWith("/") ? { id: base } : {}),
    start_url: at,
    scope: at,
    display: "standalone",
    // Chrome and Edge on the desktop: the page draws its own title bar (TitleBar.tsx) up to the
    // system's window buttons, as the desktop app does
    display_override: ["window-controls-overlay"],
    // styles.css: the page's background, and the title bar's grey (.title-bar), which the system's
    // window buttons and title take
    background_color: "#0c0a08",
    theme_color: "#cccccc",
    icons: ICON_FILES.map((i) => ({ src: iconUrl(i.file), sizes: i.sizes, type: "image/png", purpose: i.purpose })),
  };
}

export function webApp(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "shards-web-app",
    configResolved(c) {
      config = c;
    },
    transformIndexHtml() {
      return [{ tag: "link", attrs: { rel: "manifest", href: `${config.base}${MANIFEST}` }, injectTo: "head" }];
    },
    configureServer(server) {
      const base = server.config.base;
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path === `${base}${MANIFEST}`) {
          res.setHeader("Content-Type", "application/manifest+json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify(webAppManifest(base, (file) => `${base}src/icons/${file}`), null, 2));
        } else if (path === `${base}sw.js`) {
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.end(readFileSync(SW));
        } else next();
      });
    },
    generateBundle() {
      // The icons beside the bundles (assets-client/, hashed): the manifest names them relative to itself
      const names = new Map<string, string>();
      for (const { file } of ICON_FILES) {
        const ref = this.emitFile({ type: "asset", name: file, source: readFileSync(new URL(file, ICONS)) });
        names.set(file, this.getFileName(ref));
      }
      this.emitFile({ type: "asset", fileName: MANIFEST, source: JSON.stringify(webAppManifest(config.base, (file) => names.get(file)!), null, 2) });
      this.emitFile({ type: "asset", fileName: "sw.js", source: readFileSync(SW) });
    },
  };
}
