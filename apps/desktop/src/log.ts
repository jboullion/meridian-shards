// The main process log: the console (npm run desktop) and userData/logs/main.log, which
// starts fresh each launch.

import { app } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let path: string | null = null;

export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map(String).join(" ")}`;
  console.log(line);
  try {
    if (!path) {
      const dir = join(app.getPath("userData"), "logs");
      mkdirSync(dir, { recursive: true });
      path = join(dir, "main.log");
      writeFileSync(path, "");
    }
    appendFileSync(path, line + "\n");
  } catch {
    // no log file: the console has it
  }
}
