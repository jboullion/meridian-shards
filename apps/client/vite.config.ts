import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// The release version (the desktop app's), for the About box
const appVersion = (JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as { version: string }).version;

// The original game files (dist/assets-101, built by `npm run assets` from the 101 server) are
// served at /assets/* in development. Production serves them separately (Caddy), so they
// are never copied into the client build.
/** The gateway in front of blakserv (SHARDS_GATEWAY, to try a second server beside the usual one) */
const GATEWAY = process.env.SHARDS_GATEWAY ?? "ws://127.0.0.1:8059";

const gameFiles: Plugin = {
  name: "shards-game-files",
  configureServer(server) {
    // dist/ is shared with main's build (dist/assets, the 104 server's): this branch's are beside it
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/assets/")) req.url = "/assets-101/" + req.url.slice("/assets/".length);
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), gameFiles],
  publicDir: "../../dist",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    // IPv4 loopback rather than "localhost" (::1 only on this machine): `adb reverse`, which
    // the Android app's dev server goes through, connects to 127.0.0.1. Browsers and the
    // desktop app still open http://localhost:5173.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // Same-origin WebSocket in dev, like /ws behind Caddy in production.
      "/ws": { target: GATEWAY, ws: true, rewrite: () => "/" },
      // The friends relay, in the gateway's process (docs/adr/0005-friends.md)
      "/social": { target: GATEWAY, ws: true },
    },
  },
  build: {
    copyPublicDir: false,
    // /assets/* is the game files (Caddy serves dist/assets there), so the client's own
    // hashed bundles go elsewhere
    assetsDir: "assets-client",
    target: "es2023",
  },
});
