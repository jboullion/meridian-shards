import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The original game files (dist/assets, built by `npm run assets`) are served at
// /assets/* in development. Production serves them separately (Caddy), so they
// are never copied into the client build.
export default defineConfig({
  plugins: [react()],
  publicDir: "../../dist",
  server: {
    port: 5173,
    proxy: {
      // Same-origin WebSocket in dev, like /ws behind Caddy in production.
      "/ws": { target: "ws://127.0.0.1:8059", ws: true, rewrite: () => "/" },
    },
  },
  build: {
    copyPublicDir: false,
    target: "es2023",
  },
});
