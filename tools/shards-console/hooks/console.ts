// The Shards Console's state and work (ADR 0031): fetching the snapshots through
// meridian-browser's tools/console scripts, starting and following runs through
// tools/console/run.ts, the release confirm step, and the build-trap notes. register.tsx hooks
// these up and draws them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Action, Confirm, Fetched, Form, LiveSnapshot, LocalSnapshot, RunView, VisitsSnapshot } from '../types'
import { buildsServer, changedConstants, kodErrors, nextVersion, tail, verdict, type Part } from './logic.ts'

export const PLUGIN = 'shards-console'
export const PANE = 'shards'
export const TOOL = 'shards_status'
const DEFAULT_BROWSER = 'E:\\2026_Experiments\\meridian-browser'

export const live = atom({ plugin: 'shards-console', key: 'live' } as const, null)
export const local = atom({ plugin: 'shards-console', key: 'local' } as const, null)
export const visits = atom({ plugin: 'shards-console', key: 'visits' } as const, null)
export const run = atom({ plugin: 'shards-console', key: 'run' } as const, null)
export const confirm = atom({ plugin: 'shards-console', key: 'confirm' } as const, null)
export const form = atom({ plugin: 'shards-console', key: 'form' } as const, { message: '', isDryRun: true })
export const seen = atom({ plugin: 'shards-console', key: 'seen' } as const, { live: 0, local: 0 })
export const isErrorsShown = atom({ plugin: 'shards-console', key: 'isErrorsShown' } as const, false)
export const isInRepo = atom({ plugin: 'shards-console', key: 'isInRepo' } as const, false)

/** How often each part is fetched, in ms: [pane shown, pane not shown] */
const EVERY = { live: [60_000, 300_000], local: [15_000, 60_000], visits: [900_000, 900_000] } as const
export const TICK_MS = 5000
const RUN_LINES = 14

type Dollar = EngineInterface
type Paths = { browser: string; server: string; repos: string[] }
type StoredRun = Omit<RunView, 'lines' | 'code' | 'verdict'> & { isDone?: boolean }
type ToolResult = Awaited<ReturnType<Dollar['tool']['call']>>

export const join = (...parts: string[]) => parts.join('\\')
const lower = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

// The module's own; a reload starts them again and session.start fills them in
export const paths: Paths = { browser: DEFAULT_BROWSER, server: join(DEFAULT_BROWSER, 'server', 'src'), repos: [] }
const busy = new Set<string>()

/** Finds the repositories (the mod lives in meridian-browser/tools/shards-console) and whether `cwd` is in one */
export async function setUp($: Dollar, cwd: string): Promise<boolean> {
  const root = $.plugin.root.replace(/\//g, '\\')
  const browser = /\\tools\\shards-console\\?$/i.test(root) ? root.replace(/\\tools\\shards-console\\?$/i, '') : DEFAULT_BROWSER
  let server = join(browser, 'server', 'src')
  try {
    server = (await $.fs.stat(server, { resolve: true })).realPath ?? server
  } catch {
    // no junction: the scripts say so when they run
  }
  Object.assign(paths, { browser, server, repos: [lower(browser), lower(server)] })
  const here = lower(cwd)
  const inRepo = paths.repos.some(r => here === r || here.startsWith(`${r}\\`))
  await update($, isInRepo, () => inRepo)
  const storedSeen = (await $.store.get('seen')) as { live: number; local: number } | undefined
  if (storedSeen) await update($, seen, () => storedSeen)
  return inRepo
}

// -----------------------------------------------------------------------------------------
// Fetching

async function script<T>($: Dollar, file: string, timeoutMs: number): Promise<Fetched<T>> {
  const fetchedAt = await $.clock.now()
  try {
    const r = await $.process.run(['node', join(paths.browser, 'tools', 'console', file)], { cwd: paths.browser, timeoutMs })
    const start = r.stdout.indexOf('{')
    if (start < 0) return { data: null, error: (r.stderr.trim() || `exit ${r.exitCode}`).slice(-300), fetchedAt }
    return { data: JSON.parse(r.stdout.slice(start)) as T, error: null, fetchedAt }
  } catch (err) {
    return { data: null, error: (err as Error).message.slice(0, 300), fetchedAt }
  }
}

const isUp = (s: LiveSnapshot | null | undefined) => !!s?.reachable && s.container?.state === 'running'

export async function refreshLive($: Dollar) {
  if (busy.has('live')) return
  busy.add('live')
  try {
    const was = (await read($, live))?.data
    const next = await script<LiveSnapshot>($, 'live-status.ts', 60_000)
    await update($, live, () => next)
    const now = next.data
    if (was && isUp(was) && !isUp(now)) {
      const why = now?.error ?? (now?.container ? `container ${now.container.state}` : 'no container')
      $.ui.toast(`Live server down: ${why}`)
      void $.ui.notify(`The live server looks down: ${why}`, { title: 'Meridian Shards' })
    }
    const grew = (now?.errors?.lines ?? 0) - (was?.errors?.lines ?? 0)
    if (was && grew > 0) $.ui.toast(`Live: ${grew} new line${grew === 1 ? '' : 's'} in error.txt`)
    const s = await read($, seen)
    // The first look takes what is already in error.txt as seen: only lines after it count as new
    if (now?.errors && (await $.store.get('seen')) === undefined) await setSeen($, { ...s, live: now.errors.lines })
    // A fresh volume or a rotated log starts the count again
    else if (now?.errors && now.errors.lines < s.live) await setSeen($, { ...s, live: 0 })
  } finally {
    busy.delete('live')
  }
}

export async function refreshLocal($: Dollar) {
  if (busy.has('local')) return
  busy.add('local')
  try {
    const next = await script<LocalSnapshot>($, 'local-status.ts', 20_000)
    await update($, local, () => next)
  } finally {
    busy.delete('local')
  }
}

async function refreshVisits($: Dollar) {
  if (busy.has('visits')) return
  busy.add('visits')
  try {
    const next = await script<VisitsSnapshot>($, 'analytics.ts', 30_000)
    await update($, visits, () => next)
  } finally {
    busy.delete('visits')
  }
}

export async function setSeen($: Dollar, value: { live: number; local: number }) {
  await update($, seen, () => value)
  await $.store.set('seen', value)
}

/** Fetches what is due (every part when forced) and follows the current run */
export async function tick($: Dollar, isForced = false) {
  const now = await $.clock.now()
  const shown = (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
  const due = (f: { fetchedAt: number } | null, every: readonly [number, number]) => isForced || !f || now - f.fetchedAt >= every[shown ? 0 : 1]
  const work: Promise<void>[] = []
  if (due(await read($, live), EVERY.live)) work.push(refreshLive($))
  if (due(await read($, local), EVERY.local)) work.push(refreshLocal($))
  if (due(await read($, visits), EVERY.visits)) work.push(refreshVisits($))
  work.push(pollRun($))
  await Promise.all(work)
}

/** What Claude's shards_status tool answers */
export async function snapshot($: Dollar) {
  return { live: await read($, live), visits: await read($, visits), local: await read($, local), lastRun: await read($, run) }
}

// -----------------------------------------------------------------------------------------
// Runs (tools/console/run.ts)

async function pollRun($: Dollar) {
  const stored = (await $.store.get('run')) as StoredRun | undefined
  if (!stored || stored.isDone || busy.has('run')) return
  busy.add('run')
  try {
    let text = ''
    try {
      text = await $.fs.read(stored.log)
    } catch {
      // the runner hasn't opened its log yet
    }
    let code: number | null = null
    try {
      code = (JSON.parse(await $.fs.read(stored.log.replace(/\.log$/, '.exit'))) as { code: number }).code
    } catch {
      // still running
    }
    const lines = tail(text, 200)
    const ended = code === null ? 'running' : verdict(lines, code)
    // ship.ts says "Shipped." after a dry run too
    const v = ended === 'ok' && stored.label.endsWith('(dry run)') ? 'dry-run' : ended
    await update($, run, () => ({ ...stored, lines: lines.slice(-RUN_LINES), code, verdict: v }))
    if (code !== null) {
      await $.store.set('run', { ...stored, isDone: true })
      const word = v === 'ok' ? 'finished' : v === 'dry-run' ? 'finished (dry run)' : 'failed'
      $.ui.toast(`${stored.label} ${word}`)
      void $.ui.notify(`${stored.label} ${word}`, { title: 'Meridian Shards' })
      void refreshLocal($)
      if (stored.isLocked && v === 'ok') void refreshLive($)
    }
  } finally {
    busy.delete('run')
  }
}

async function startRun($: Dollar, name: string, label: string, argv: string[], options: { isLocked?: boolean; cwd?: string } = {}) {
  const runner = join(paths.browser, 'tools', 'console', 'run.ts')
  const args = ['node', runner, name, ...(options.isLocked ? ['--lock'] : []), ...(options.cwd ? ['--cwd', options.cwd] : []), '--', ...argv]
  let answer: { started: boolean; id?: string; log?: string; reason?: string }
  try {
    const r = await $.process.run(args, { cwd: paths.browser })
    answer = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as typeof answer
  } catch (err) {
    answer = { started: false, reason: (err as Error).message }
  }
  if (!answer.started || !answer.id || !answer.log) {
    $.ui.toast(`${label} didn't start: ${answer.reason ?? 'no answer from run.ts'}`)
    return
  }
  const stored: StoredRun = { id: answer.id, label, log: answer.log, startedAt: new Date(await $.clock.now()).toISOString(), isLocked: !!options.isLocked }
  await $.store.set('run', stored)
  await update($, run, () => ({ ...stored, lines: [], code: null, verdict: 'running' as const }))
}

/** Ends a run that holds no lock (builds, checks, the local server) */
export async function stopRun($: Dollar, id: string) {
  await $.process.run(['node', join(paths.browser, 'tools', 'console', 'run.ts'), '--stop', id], { cwd: paths.browser })
}

async function desktopVersion($: Dollar): Promise<string> {
  try {
    return (JSON.parse(await $.fs.read(join(paths.browser, 'apps', 'desktop', 'package.json'))) as { version: string }).version
  } catch {
    return '?'
  }
}

async function confirmLines($: Dollar, action: Action, f: Form): Promise<string[]> {
  if (action === 'stop' || action === 'restart') {
    return [`${action === 'stop' ? 'Stop' : 'Restart'} the local blakserv: it saves the game and shuts down${action === 'restart' ? ', then starts again' : ''}. Anyone logged on locally is logged off.`]
  }
  const message = f.message.trim()
  const msg = message ? `Commit message: "${message}"` : 'No commit message: ship stops if either repository has changes to commit.'
  const dry = f.isDryRun ? 'Dry run: prints every step and changes nothing.' : 'Not a dry run: this pushes to GitHub and restarts the live server.'
  const ship = 'Build and check, commit and push both repositories, save the live game, deploy and restart the live stack, rebuild changed rooms.'
  const current = await desktopVersion($)
  if (action === 'ship') return [`Ship v${current} as it is.`, ship, msg, dry]
  const next = nextVersion(current, action as Part) ?? '?'
  return [`Release ${current} -> ${next} (${action}).`, `${ship} Then tag v${next}, push the tag and follow the desktop build until the GitHub release is published.`, msg, dry]
}

/** Runs an action: the confirm step's Confirm, or a button that needs none */
export async function act($: Dollar, action: Action) {
  const f = await read($, form)
  const message = f.message.trim()
  const releaseArgs = [...(message ? ['-m', message] : []), ...(f.isDryRun ? ['--dry-run'] : [])]
  const dry = f.isDryRun ? ' (dry run)' : ''
  switch (action) {
    case 'ship':
      return startRun($, 'ship', `Ship${dry}`, ['node', 'tools/deploy/ship.ts', ...releaseArgs], { isLocked: true })
    case 'patch':
    case 'minor':
    case 'major': {
      const current = await desktopVersion($)
      return startRun($, `release-${action}`, `Release ${current} -> ${nextVersion(current, action) ?? '?'}${dry}`, ['node', 'tools/deploy/bump.ts', action, ...releaseArgs], { isLocked: true })
    }
    case 'start':
    case 'stop':
    case 'restart':
      return startRun($, `server-${action}`, `Local blakserv ${action}`, ['node', 'tools/server.mjs', action], { cwd: paths.server })
    case 'build':
      return startRun($, 'build-kod', 'Build Kod', ['node', 'tools/server/build.ts', 'Bresource', 'Bkod'])
    case 'check':
      return startRun($, 'check', 'npm run check', ['npm', 'run', 'check'])
  }
}

const isRelease = (a: Action) => a === 'ship' || a === 'patch' || a === 'minor' || a === 'major'
const needsConfirm = (a: Action) => isRelease(a) || a === 'stop' || a === 'restart'

/** A button's press: what needs it shows the confirm step first */
export async function press($: Dollar, action: Action) {
  const current = await read($, run)
  if (current?.verdict === 'running' && current.isLocked && isRelease(action)) {
    $.ui.toast(`${current.label} is still running`)
    return
  }
  if (!needsConfirm(action)) return act($, action)
  const c: Confirm = { action, lines: await confirmLines($, action, await read($, form)) }
  await update($, confirm, () => c)
}

export async function confirmed($: Dollar, action: Action) {
  await update($, confirm, () => null)
  await act($, action)
}

// -----------------------------------------------------------------------------------------
// The build traps (shards-server AGENTS.md), for builds Claude runs itself

export async function isGameUp($: Dollar) {
  return (await read($, local))?.data?.ports.game ?? false
}

/** Notes for Claude on a raw nmake / build.cmd run: Kod errors nmake let through, a stale blakserv.exe */
export function shellTrap(command: string, ran: ToolResult, wasServerUp: boolean): ToolResult {
  if (ran.deny !== undefined) return ran
  const notes: string[] = []
  const r = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  const output = [ran.text, typeof r?.stdout === 'string' ? r.stdout : '', typeof r?.stderr === 'string' ? r.stderr : ''].filter(Boolean).join('\n')
  const errors = kodErrors(output)
  if (errors.length) {
    notes.push(
      `${PLUGIN}: this build has ${errors.length} Kod error line${errors.length === 1 ? '' : 's'}, though nmake may have exited 0 (shards-server AGENTS.md): the failing classes keep their old .bof.\n${errors.slice(0, 15).join('\n')}\nnode tools/server/build.ts (meridian-browser) checks for these and fails the build.`,
    )
  }
  if (wasServerUp && buildsServer(command)) {
    notes.push(`${PLUGIN}: blakserv was running (port 5959) during a Bserver build, so the build can't have copied blakserv.exe into run/server: the running server and run/server/blakserv.exe are the old build until it is stopped and Bserver built again.`)
  }
  return notes.length ? { ...ran, context: [...(ran.context ?? []), ...notes] } : ran
}

export async function readOrEmpty($: Dollar, file: string) {
  try {
    return await $.fs.read(file)
  } catch {
    return ''
  }
}

/** A note for Claude after a .khd edit: the .kod files that use the constants it changed */
export async function khdTrap($: Dollar, file: string, before: string, ran: ToolResult): Promise<ToolResult> {
  if (ran.deny !== undefined || ran.isError) return ran
  const names = changedConstants(before, await readOrEmpty($, file)).slice(0, 40)
  if (!names.length) return ran
  const at = file.replace(/\//g, '\\').toLowerCase().lastIndexOf('\\kod\\')
  if (at < 0) return ran
  let files: string[] = []
  try {
    const g = await $.process.run(['git', 'grep', '-l', '-w', ...names.flatMap(n => ['-e', n]), '--', '*.kod'], { cwd: file.slice(0, at + 4) })
    files = g.stdout.split(/\r?\n/).filter(Boolean)
  } catch {
    return ran
  }
  if (!files.length) return ran
  const shown = files.slice(0, 60).map(f => `kod/${f}`)
  const more = files.length > shown.length ? `\n... and ${files.length - shown.length} more` : ''
  const note = `${PLUGIN}: ${names.join(', ')} changed in ${file.split(/[\\/]/).pop()}. A .khd change doesn't recompile the .kod files that use it (shards-server AGENTS.md): touch these ${files.length} file${files.length === 1 ? '' : 's'} before rebuilding, or their .bof keeps the old value:\n${shown.join('\n')}${more}`
  return { ...ran, context: [...(ran.context ?? []), note] }
}
