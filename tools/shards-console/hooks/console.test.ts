import { describe, expect, mock, test } from 'claude-code/testing'

import { buildsServer, changedConstants, isRawBuild, kodErrors, nextVersion, size, verdict } from './logic.ts'

const PLUGIN = 'shards-console'
const PANE = { plugin: PLUGIN, component: 'Pane', props: { title: 'Shards', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }, requestId: 'shards' } as const
const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

describe('logic', () => {
  test('next versions', () => {
    expect(nextVersion('0.14.1', 'patch')).toBe('0.14.2')
    expect(nextVersion('0.14.1', 'minor')).toBe('0.15.0')
    expect(nextVersion('0.14.1', 'major')).toBe('1.0.0')
    expect(nextVersion('dev', 'patch')).toBe(null)
  })

  test("a run's verdict comes from the scripts' last lines, then its exit code", () => {
    expect(verdict(['== Deploy', 'Shipped.'], 0)).toBe('ok')
    expect(verdict(['Release 0.14.1 -> 0.14.2 (patch)', 'Would release v0.14.2 (dry run).'], 0)).toBe('dry-run')
    expect(verdict(['', '!! shards-server has changes: give a commit message'], 1)).toBe('failed')
    expect(verdict(['[build] failed: 1 error line'], 1)).toBe('failed')
    expect(verdict(['hello'], null)).toBe('running')
    expect(verdict(['hello'], 3)).toBe('failed')
  })

  test('raw builds and their errors', () => {
    expect(isRawBuild('cmd /c server\\build.cmd Bkod')).toBe(true)
    expect(isRawBuild('nmake -nologo debug=1 Bkod')).toBe(true)
    expect(isRawBuild('node tools/server/build.ts Bkod')).toBe(false)
    expect(buildsServer('cmd /c server\\build.cmd')).toBe(true)
    expect(buildsServer('cmd /c server\\build.cmd Bkod')).toBe(false)
    expect(buildsServer('nmake debug=1 Bserver')).toBe(true)
    expect(kodErrors('a.kod(3): warning: x\nticket.kod(54): fatal error: syntax error\n')).toEqual(['ticket.kod(54): fatal error: syntax error'])
  })

  test('log sizes', () => {
    expect(size(39_697_880)).toBe('38 MB')
    expect(size(4_995_526)).toBe('4.8 MB')
    expect(size(261_722)).toBe('256 KB')
  })

  test("a .khd's changed constants", () => {
    const before = '// header\n   TRUE = 1\n   MAX_HP = 150 // the cap\n   GONE = 3\n'
    const after = '// header\n   TRUE = 1\n   MAX_HP = 200\n   NEW_ONE = 4\n'
    expect(changedConstants(before, after)).toEqual(['GONE', 'MAX_HP', 'NEW_ONE'])
    expect(changedConstants(before, before.replace('// the cap', '// a comment'))).toEqual([])
  })
})

test('the pane draws on every surface, and Ship asks to confirm first', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('fs.read', async (_, e) => ({ value: e.path.endsWith('package.json') ? '{ "version": "0.14.1" }' : '' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /fetching/ })).toBeDefined()
    expect(await ui.find({ key: 'patch' })).toBeDefined()
    await ui.press({ key: 'ship' })
    expect(await ui.find({ type: 'Text', text: /Ship v0\.14\.1 as it is/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Dry run: prints every step/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ type: 'Text', text: /Ship v0\.14\.1 as it is/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a Patch press names the version it will release', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('fs.read', async () => ({ value: '{ "version": "0.14.1" }' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'patch' })
  expect(await ui.find({ type: 'Text', text: /Release 0\.14\.1 -> 0\.14\.2 \(patch\)/ })).toBeDefined()
  await ui.unmount()
})

test("a raw Kod build's errors reach Claude as a note", async ($, on) => {
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: 'Building ticket\nticket.kod(54): fatal error: syntax error on token not\n', stderr: '' } }) as never)
  const built = await $.tool.call({ tool: 'Bash', command: 'cmd /c server\\build.cmd Bkod' })
  expect((built.context ?? []).join('\n')).toMatch(/1 Kod error line[\s\S]*ticket\.kod\(54\)/)
  const other = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(other.context).toBeUndefined()
})

test('an edit to a .khd lists the .kod files that use the constants it changed', async ($, on) => {
  let text = '   MAX_HP = 150\n   TRUE = 1\n'
  on('fs.read', async () => ({ value: text }))
  on('tool.call', { tool: 'Edit' }, async () => {
    text = '   MAX_HP = 200\n   TRUE = 1\n'
    return { result: {} } as never
  })
  on('process.run', async (_, e) => ran(e.argv.includes('MAX_HP') ? 'object/active/holder/nomoveon/battler/player.kod\nutil/settings.kod\n' : ''))
  const edited = await $.tool.call({ tool: 'Edit', file_path: 'J:\\shards-server\\kod\\include\\blakston.khd', old_string: 'MAX_HP = 150', new_string: 'MAX_HP = 200' })
  const note = (edited.context ?? []).join('\n')
  expect(note).toMatch(/MAX_HP changed in blakston\.khd/)
  expect(note).toMatch(/touch these 2 files/)
  expect(note).toMatch(/kod\/util\/settings\.kod/)
})

test('shards_status answers with the snapshots it holds', async $ => {
  const answer = await $.tool.call({ tool: `mcp__${PLUGIN}__shards_status` })
  expect(JSON.parse(answer.result as string)).toEqual({ live: null, visits: null, local: null, lastRun: null })
})
