// The agent's bug reports and notes (docs/adr/0020-ai-playtester.md): one markdown file per report
// in playtest/reports/, with where it happened and the journal's last lines filled in, and a
// day's notes (things that aren't bugs) in playtest/notes/. playtest/README.md says how to triage.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entryLine, type Entry } from "./journal.ts";

export interface BugReport {
  title: string;
  severity: "blocker" | "major" | "minor" | "cosmetic";
  category: string;
  summary: string;
  steps?: string;
  expected?: string;
  actual?: string;
}

/** Where it happened, filled in by the server */
export interface ReportContext {
  character: string;
  room: string;
  square: string;
  journal: Entry[];
}

const JOURNAL_LINES = 30;

let sha: string | null = null;
function gitSha(root: string): string {
  if (sha === null)
    try {
      sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      sha = "unknown";
    }
  return sha;
}

/** "2026-10-20-1405" in local time */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "report";

/** YAML's double-quoted string */
const q = (s: string) => JSON.stringify(s);

/** Writes the report, with a screenshot beside it (the browser body's) when there is one; its path, relative to the repo */
export function writeReport(root: string, r: BugReport, ctx: ReportContext, now = new Date(), shot?: Uint8Array): string {
  const dir = join(root, "playtest", "reports");
  mkdirSync(dir, { recursive: true });
  let name = `${stamp(now)}-${slug(r.title)}.md`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${stamp(now)}-${slug(r.title)}-${n}.md`;
  const png = name.replace(/\.md$/, ".png");
  if (shot) writeFileSync(join(dir, png), shot);
  const body = [
    "---",
    `title: ${q(r.title)}`,
    `severity: ${r.severity}`,
    `category: ${q(r.category)}`,
    `status: new`,
    `reported: ${now.toISOString()}`,
    `character: ${q(ctx.character)}`,
    `room: ${q(ctx.room)}`,
    `square: ${q(ctx.square)}`,
    `commit: ${gitSha(root)}`,
    "---",
    "",
    `# ${r.title}`,
    "",
    r.summary.trim(),
    "",
    ...(r.steps ? ["## Steps to reproduce", "", r.steps.trim(), ""] : []),
    ...(r.expected ? ["## Expected", "", r.expected.trim(), ""] : []),
    ...(r.actual ? ["## Actual", "", r.actual.trim(), ""] : []),
    ...(shot ? ["## Screenshot", "", `![What the game showed](${png})`, ""] : []),
    "## The journal before it",
    "",
    "```",
    ...ctx.journal.slice(-JOURNAL_LINES).map(entryLine),
    "```",
    "",
  ].join("\n");
  writeFileSync(join(dir, name), body);
  return `playtest/reports/${name}`;
}

/** Every report's file, title, severity and status, newest first */
export function listReports(root: string): string[] {
  const dir = join(root, "playtest", "reports");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const field = (k: string) => new RegExp(`^${k}: "?(.*?)"?$`, "m").exec(text)?.[1] ?? "?";
      return `${f}: [${field("severity")}, ${field("status")}] ${field("title")}`;
    });
}

/** Appends a note to today's notes; the file's path */
export function writeNote(root: string, text: string, where: string, now = new Date()): string {
  const dir = join(root, "playtest", "notes");
  mkdirSync(dir, { recursive: true });
  const name = `${stamp(now).slice(0, 10)}.md`;
  const path = join(dir, name);
  if (!existsSync(path)) writeFileSync(path, `# Playtest notes, ${name.slice(0, 10)}\n\n`);
  appendFileSync(path, `- ${stamp(now).slice(11)} (${where}): ${text.trim().replace(/\n+/g, " ")}\n`);
  return `playtest/notes/${name}`;
}
