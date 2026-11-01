// Shards Console (meridian-browser docs/adr/0031-shards-console.md): the live server, visits,
// the local server and the release buttons in a pane, a band above the prompt, a
// `shards_status` tool for Claude, and notes on the build traps in shards-server's AGENTS.md.
// The data comes from meridian-browser's tools/console scripts; long commands run detached
// through tools/console/run.ts, so a reload of this module never kills a ship. The work is in
// console.ts; this file hooks it up and draws it.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  confirmed,
  isGameUp,
  khdTrap,
  PANE,
  PLUGIN,
  press,
  readOrEmpty,
  refreshLive,
  refreshLocal,
  setSeen,
  setUp,
  shellTrap,
  snapshot,
  stopRun,
  tick,
  TICK_MS,
  TOOL,
} from './console.ts'
import { ago, duration, isRawBuild, nextVersion, size } from './logic.ts'

// The console's state (console.ts declares the same: the validator reads an atom only from the file that uses it)
const live = atom({ plugin: 'shards-console', key: 'live' } as const, null)
const local = atom({ plugin: 'shards-console', key: 'local' } as const, null)
const visits = atom({ plugin: 'shards-console', key: 'visits' } as const, null)
const run = atom({ plugin: 'shards-console', key: 'run' } as const, null)
const confirm = atom({ plugin: 'shards-console', key: 'confirm' } as const, null)
const form = atom({ plugin: 'shards-console', key: 'form' } as const, { message: '', isDryRun: true })
const seen = atom({ plugin: 'shards-console', key: 'seen' } as const, { live: 0, local: 0 })
const isErrorsShown = atom({ plugin: 'shards-console', key: 'isErrorsShown' } as const, false)
const isInRepo = atom({ plugin: 'shards-console', key: 'isInRepo' } as const, false)

/** deploy/logrotate.conf rotates a log past 20 MB: one bigger means it isn't installed or hasn't run */
const LOG_ROTATE_BYTES = 20 * 1024 * 1024

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const inRepo = await setUp($, e.cwd)
    await $.command.register({ name: 'shards', description: 'Open the Shards Console: the live server, visits, the local server and releases', argumentHint: '[refresh]' })
    await $.tool.register({
      name: TOOL,
      description:
        "Meridian Shards status from the Shards Console: the live server (container, uptime, who is online, error.txt's tail, the last ship), visits to m59-shards.com, the local stack's ports and players, and the last console run. Use it in place of ssh to the VM for status questions. refresh: true fetches the live server and the local stack again first (a few seconds).",
      inputSchema: { type: 'object', properties: { refresh: { type: 'boolean', description: 'Fetch the live server and local stack again before answering' } } },
      isDeferred: false,
    })
    if (inRepo) void $.ui.open({ id: PANE, title: 'Shards' })
    $.clock.every(TICK_MS, () => void tick($))
    void tick($)
    return next(e)
  })

  on('command.run', { command: 'shards' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Shards', focus: true })
    if (e.args.trim() === 'refresh') {
      await tick($, true)
      return { text: 'Shards Console refreshed.' }
    }
    return { text: 'Shards Console opened.' }
  })

  on('tool.call', { tool: `mcp__${PLUGIN}__${TOOL}` }, async ($, e) => {
    if ((e as { refresh?: unknown }).refresh === true) await Promise.all([refreshLive($), refreshLocal($)])
    // A plugin tool answers text (or content blocks), not an object
    const text = JSON.stringify(await snapshot($), null, 2)
    return { result: text, text, isReadOnly: true }
  }).catch(() => ({ deny: `${PLUGIN}: the status tool failed; ask again with refresh, or use npm run console:status` }))

  // ---------------------------------------------------------------------------------------
  // The build traps (shards-server AGENTS.md), for builds and edits Claude makes itself

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isRawBuild(e.command)) return next(e)
    const wasUp = await isGameUp($)
    return shellTrap(e.command, await next(e), wasUp)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    if (!isRawBuild(e.command)) return next(e)
    const wasUp = await isGameUp($)
    return shellTrap(e.command, await next(e), wasUp)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!/\.khd$/i.test(e.file_path)) return next(e)
    const before = await readOrEmpty($, e.file_path)
    return khdTrap($, e.file_path, before, await next(e))
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!/\.khd$/i.test(e.file_path)) return next(e)
    const before = await readOrEmpty($, e.file_path)
    return khdTrap($, e.file_path, before, await next(e))
  }).catch(($, e, next) => next(e))

  // ---------------------------------------------------------------------------------------
  // Drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Input = 'Input' in ui ? ui.Input : undefined
    const now = await $.clock.now()
    const l = await read($, live)
    const lo = await read($, local)
    const v = await read($, visits)
    const r = await read($, run)
    const c = await read($, confirm)
    const f = await read($, form)
    const s = await read($, seen)
    const showErrors = await read($, isErrorsShown)
    const version = l?.data?.lastShip.version ?? '?'

    const dot = (ok: boolean | null) => <Text color={ok === null ? 'subtle' : ok ? 'success' : 'error'}>●</Text>
    const heading = (title: string, right?: string) => (
      <Box marginTop={1}>
        <Text bold>{title}</Text>
        {right ? <Text dimColor> {right}</Text> : null}
      </Box>
    )

    // Live
    const ld = l?.data
    const liveUp = ld ? ld.reachable && ld.container?.state === 'running' : null
    const liveLine = !l
      ? 'fetching...'
      : !ld
        ? `couldn't run live-status.ts: ${l.error}`
        : !ld.reachable
          ? `unreachable: ${ld.error ?? '?'}`
          : !ld.container
            ? 'no blakserv container'
            : ld.skipped === 'not running'
              ? `container ${ld.container.state} (restarts ${ld.container.restarts})`
              : ld.skipped === 'starting'
                ? `starting (up ${duration(ld.container.ageSec)}): no maintenance commands in the first minute and a half`
                : `up ${duration(ld.server?.uptimeSec ?? ld.container.ageSec)} · ${ld.players.length} online · restarts ${ld.container.restarts}`
    const newLive = ld?.errors ? Math.max(0, ld.errors.lines - s.live) : 0

    // Local
    const lod = lo?.data
    const loPorts = lod?.ports

    return (
      <Box flexDirection="column">
        {heading('Live', l ? `checked ${ago(new Date(l.fetchedAt).toISOString(), now)}` : undefined)}
        <Box gap={1}>
          {dot(liveUp)}
          <Text>{liveLine}</Text>
        </Box>
        {ld?.players.length ? <Text dimColor>{ld.players.map(p => `${p.account} (${p.room})`).join(', ')}</Text> : null}
        <Text dimColor>
          last ship {ago(ld?.lastShip.at, now)} · v{version}
          {ld?.lastShip.tag ? ` · last tag ${ld.lastShip.tag}` : ''}
          {ld?.server?.version ? ` · ${ld.server.version}` : ''}
        </Text>
        {ld?.errors ? (
          <Box gap={1}>
            <Text color={newLive ? 'warning' : 'subtle'}>
              error.txt: {newLive ? `${newLive} new` : 'nothing new'} ({ld.errors.lines} lines)
            </Text>
            <Button key="errors-toggle" plain label={showErrors ? 'Hide' : 'Show'} onPress={() => void update($, isErrorsShown, () => !showErrors)} />
            {newLive ? <Button key="errors-seen" plain label="Mark seen" onPress={() => void setSeen($, { ...s, live: ld.errors?.lines ?? 0 })} /> : null}
          </Box>
        ) : null}
        {showErrors && ld?.errors
          ? ld.errors.tail.map((line, i) => (
              <Text key={`err-${i}`} mono dimColor wrap="truncate-end">
                {line}
              </Text>
            ))
          : null}
        {ld?.logs?.length ? (
          <Text key="logs" color={ld.logs.some(f => f.bytes > LOG_ROTATE_BYTES) ? 'warning' : 'subtle'}>
            logs: {ld.logs.map(f => `${f.name.replace(/\.txt$/, '')} ${size(f.bytes)}`).join(' · ')}
            {ld.logs.some(f => f.bytes > LOG_ROTATE_BYTES) ? ' (over 20 MB: is deploy/logrotate.conf installed on the VM?)' : ''}
          </Text>
        ) : null}
        <Box gap={1}>
          <Button key="refresh" label="Refresh" onPress={() => void tick($, true)} />
        </Box>

        {heading('Visits', v?.data?.at ? `m59-shards.com · ${ago(v.data.at, now)}` : 'm59-shards.com')}
        {!v ? (
          <Text dimColor>fetching...</Text>
        ) : !v.data ? (
          <Text color="error">couldn't run analytics.ts: {v.error}</Text>
        ) : !v.data.configured ? (
          <Text dimColor>Not set up: add {(v.data.missing ?? []).join(', ')} to meridian-browser's .env; node tools/console/analytics.ts --sites finds the site tag.</Text>
        ) : v.data.error ? (
          <Text color="error">Cloudflare: {v.data.error}</Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              today {v.data.today?.visits ?? 0} visits, {v.data.today?.pageViews ?? 0} page views · 7 days {v.data.week?.visits ?? 0} visits, {v.data.week?.pageViews ?? 0} page views
            </Text>
            <Text dimColor mono>
              {(v.data.days ?? []).map(d => `${d.date.slice(5)} ${d.visits}`).join('  ')}
            </Text>
          </Box>
        )}

        {heading('Local', lod?.server?.uptimeSec ? `blakserv up ${duration(lod.server.uptimeSec)}` : undefined)}
        <Box gap={1}>
          {dot(loPorts ? loPorts.game && loPorts.maintenance : null)}
          <Text>blakserv</Text>
          {dot(loPorts ? loPorts.gateway : null)}
          <Text>gateway</Text>
          {dot(loPorts ? loPorts.client : null)}
          <Text>vite</Text>
          <Text dimColor>· {lod?.players.length ?? 0} online</Text>
        </Box>
        <Box gap={1} flexWrap="wrap">
          <Button key="start" label="Start" onPress={() => void press($, 'start')} />
          <Button key="stop" label="Stop" onPress={() => void press($, 'stop')} />
          <Button key="restart" label="Restart" onPress={() => void press($, 'restart')} />
          <Button key="build" label="Build Kod" onPress={() => void press($, 'build')} />
          <Button key="check" label="Check" onPress={() => void press($, 'check')} />
        </Box>

        {heading('Release', `v${version}`)}
        {Input ? (
          <Input
            key="message"
            label="Commit message"
            placeholder="What changed"
            value={f.message}
            submitLabel="Set"
            onInput={value => void update($, form, old => ({ ...old, message: value }))}
            onSubmit={value => void update($, form, old => ({ ...old, message: value }))}
          />
        ) : (
          <Text dimColor>No text field on this surface: ship from a terminal, or use the desktop app.</Text>
        )}
        <Box gap={1} flexWrap="wrap">
          <Button key="dry" label={f.isDryRun ? 'Dry run: on' : 'Dry run: off'} onPress={() => void update($, form, old => ({ ...old, isDryRun: !old.isDryRun }))} />
          <Button key="ship" label="Ship" onPress={() => void press($, 'ship')} />
          <Button key="patch" label={`Patch ${nextVersion(version, 'patch') ?? ''}`} onPress={() => void press($, 'patch')} />
          <Button key="minor" label={`Minor ${nextVersion(version, 'minor') ?? ''}`} onPress={() => void press($, 'minor')} />
          <Button key="major" label={`Major ${nextVersion(version, 'major') ?? ''}`} onPress={() => void press($, 'major')} />
        </Box>
        {c ? (
          <Box flexDirection="column" marginTop={1}>
            {c.lines.map((line, i) => (
              <Text key={`confirm-${i}`} color={i === 0 ? 'warning' : undefined}>
                {line}
              </Text>
            ))}
            <Box gap={1}>
              <Button
                key="confirm"
                variant="primary"
                label="Confirm"
                onPress={() => void confirmed($, c.action)}
              />
              <Button key="cancel" role="dismiss" label="Cancel" onPress={() => void update($, confirm, () => null)} />
            </Box>
          </Box>
        ) : null}

        {r ? (
          <Box flexDirection="column">
            {heading(
              r.label,
              r.verdict === 'running' ? `running ${duration((now - Date.parse(r.startedAt)) / 1000)}` : r.verdict === 'failed' ? `failed (exit ${r.code ?? '?'})` : r.verdict === 'dry-run' ? 'dry run done' : 'done',
            )}
            {r.lines.map((line, i) => (
              <Text key={`run-${i}`} mono dimColor={!/^(!!|==|\[build\])/.test(line)} color={/^!!|\[build\] failed/.test(line) ? 'error' : undefined} wrap="truncate-end">
                {line}
              </Text>
            ))}
            <Box gap={1}>
              {r.verdict === 'running' && !r.isLocked ? (
                <Button key="run-stop" label="Stop run" onPress={() => void stopRun($, r.id)} />
              ) : null}
              <Button key="run-copy" plain label="Copy log path" onPress={p => void $.ui.copy({ text: r.log, surface: p.surface })} />
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isInRepo))) return next(e)
    const l = await read($, live)
    const lo = await read($, local)
    const r = await read($, run)
    const s = await read($, seen)
    if (!l && !lo) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const ld = l?.data
    const up = ld ? ld.reachable && ld.container?.state === 'running' && ld.skipped !== 'starting' : null
    const newErrors = ld?.errors ? Math.max(0, ld.errors.lines - s.live) : 0
    const ports = lo?.data?.ports
    const localUp = ports ? ports.game && ports.maintenance : null

    return (
      <Box gap={1}>
        <Text color={up === null ? 'subtle' : up ? 'success' : ld?.skipped === 'starting' ? 'warning' : 'error'}>●</Text>
        <Text dimColor>
          live{ld?.reachable && ld.container ? ` · ${ld.players.length} online · up ${duration(ld.server?.uptimeSec ?? ld.container.ageSec)}` : ld ? ` · ${ld.error ?? ld.skipped ?? 'down'}` : ''}
        </Text>
        {newErrors ? <Text color="warning">{newErrors} new errors</Text> : null}
        <Text dimColor>│ local</Text>
        <Text color={localUp === null ? 'subtle' : localUp ? 'success' : 'error'}>●</Text>
        <Text dimColor>
          │ ship {ago(ld?.lastShip.at, now)} v{ld?.lastShip.version ?? '?'}
        </Text>
        {r?.verdict === 'running' ? <Text color="warning">│ {r.label}…</Text> : null}
        <Button key="band-open" plain label="Open" onPress={() => void $.ui.open({ id: PANE, title: 'Shards', focus: true })} />
      </Box>
    )
  })
}
