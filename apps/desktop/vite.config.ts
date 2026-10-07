import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Builds the Electron main process and the preload into out/ as CommonJS, one file each,
// with their npm dependencies (electron-updater) bundled in, so the packaged app needs no
// node_modules. Two passes, because a sandboxed preload must be a single file:
//   vite build --mode main && vite build --mode preload
export default defineConfig(({ mode }) => {
  const entry = mode === "preload" ? "preload" : "main";
  return {
    build: {
      outDir: "out",
      emptyOutDir: entry === "main",
      ssr: `src/${entry}.ts`,
      target: "node22",
      minify: false,
      sourcemap: true,
      rollupOptions: {
        external: ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
        output: { format: "cjs", entryFileNames: `${entry}.cjs` },
      },
    },
    ssr: { noExternal: true },
  };
});
