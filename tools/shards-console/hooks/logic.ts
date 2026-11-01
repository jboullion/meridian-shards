// The Shards Console's pure parts (ADR 0031): no `$`, so they test on their own.

import type { RunView } from '../types'

export type Part = 'patch' | 'minor' | 'major'

/** The version after `version` for a release of `part`; null when it isn't x.y.z */
export function nextVersion(version: string, part: Part): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) return null
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (part === 'major') return `${major + 1}.0.0`
  if (part === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** "3d 4h", "12m", "40s" */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
}

/** "40 MB", "1.1 MB", "812 KB" */
export function size(bytes: number): string {
  if (bytes >= 10 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** "2h ago", from an ISO time and now in ms */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 'never' : `${duration((now - t) / 1000)} ago`
}

/** How a run ended, read from its last lines (the scripts print these) and its exit code */
export function verdict(lines: readonly string[], code: number | null): RunView['verdict'] {
  const tail = lines.slice(-12).join('\n')
  if (/^!! |^\[build\] failed/m.test(tail)) return 'failed'
  if (/Would release v|\(dry run\)/.test(tail)) return 'dry-run'
  if (/^Shipped\.|^published: |^\[build\] ok|^Not deployed/m.test(tail)) return 'ok'
  if (code === null) return 'running'
  return code === 0 ? 'ok' : 'failed'
}

/** The lines of a build's output that mean it failed (as tools/server/build.ts reads them) */
export function kodErrors(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter(l => /\.(kod|khd|lkod)(\(\d+\))?: error/i.test(l) || /\bfatal error\b/i.test(l))
}

/** A shell command that builds the server without tools/server/build.ts */
export function isRawBuild(command: string): boolean {
  return /\bnmake\b|\bbuild\.cmd\b/i.test(command) && !/build\.ts\b/.test(command)
}

/** Whether a raw build includes Bserver (build.cmd's default targets do) */
export function buildsServer(command: string): boolean {
  if (/\bBserver\b/.test(command)) return true
  // build.cmd with no targets after it builds Bzlib Bjansson Bserver Bkod
  return /\bbuild\.cmd\b["']?\s*(&&|\||;|$)/im.test(command)
}

/** A .khd's constants, NAME = value (comments and spacing ignored) */
export function constants(khd: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of khd.split(/\r?\n/)) {
    const line = raw.replace(/%.*$/, '').replace(/\/\/.*$/, '')
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/.exec(line)
    if (m) out.set(m[1]!, m[2]!)
  }
  return out
}

/** The constants added, removed or given another value between two versions of a .khd */
export function changedConstants(before: string, after: string): string[] {
  const a = constants(before)
  const b = constants(after)
  const names = new Set([...a.keys(), ...b.keys()])
  return [...names].filter(n => a.get(n) !== b.get(n)).sort()
}

/** The last `n` lines of a log, without blank trailing ones */
export function tail(text: string, n: number): string[] {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
  return lines.slice(-n)
}
