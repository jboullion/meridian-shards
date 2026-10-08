import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The login SecretKey must match the server's [Login] SecretKey. It isn't a real
// secret (it ships in the JS); server/config/blakserv.cfg is the one source of truth.
const cfg = readFileSync(new URL("../../server/config/blakserv.cfg", import.meta.url), "utf8");
const secretKey = /^SecretKey\s+(\S+)/m.exec(cfg)?.[1] ?? "";

// The original game files (dist/assets, built by `npm run assets`) are served at
// /assets/* in development. Production serves them separately (Caddy), so they
// are never copied into the client build.
export default defineConfig({
  plugins: [react()],
  publicDir: "../../dist",
  define: {
    __SECRET_KEY__: JSON.stringify(secretKey),
  },
  server: {
    // IPv4 loopback rather than "localhost" (::1 only on this machine): `adb reverse`, which
    // the Android app's dev server goes through, connects to 127.0.0.1. Browsers and the
    // desktop app still open http://localhost:5173.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // Same-origin WebSocket in dev, like /ws behind Caddy in production.
      "/ws": { target: "ws://127.0.0.1:8059", ws: true, rewrite: () => "/" },
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
