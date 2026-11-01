import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.ts", "tools/**/*.test.ts"],
    // tools/shards-console is a Claude Code mod: claude plugin test runs its tests
    exclude: ["**/node_modules/**", "tools/shards-console/**"],
  },
});
