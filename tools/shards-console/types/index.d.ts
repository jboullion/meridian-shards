// The Shards Console's session state (ADR 0031). The snapshots are what the meridian-browser
// scripts print: tools/console/live-status.ts, local-status.ts and analytics.ts.

export type Player = { account: string; room: string; rid: number }

export type ServerStatus = {
  version: string | null
  uptimeSec: number | null
  activeAccounts: number | null
  sessions: number | null
  guests: number | null
}

export type LiveSnapshot = {
  at: string
  reachable: boolean
  error?: string
  container: { state: string; startedAt: string; restarts: number; ageSec: number } | null
  skipped?: 'starting' | 'not running'
  server: ServerStatus | null
  players: Player[]
  errors: { lines: number; tail: string[] } | null
  /** blakserv's logs (channel/*.txt) by size, largest first; absent from scripts older than the field */
  logs?: { name: string; bytes: number }[]
  lastShip: { at: string | null; version: string; tag: string | null }
}

export type LocalSnapshot = {
  at: string
  ports: { game: boolean; maintenance: boolean; gateway: boolean; client: boolean }
  server: ServerStatus | null
  players: Player[]
  errors: { lines: number; tail: string[] } | null
}

export type VisitsSnapshot = {
  configured: boolean
  missing?: string[]
  at?: string
  error?: string
  today?: { visits: number; pageViews: number }
  week?: { visits: number; pageViews: number }
  days?: { date: string; visits: number; pageViews: number }[]
}

/** A snapshot, or why the last fetch of it failed */
export type Fetched<T> = { data: T | null; error: string | null; fetchedAt: number }

export type RunView = {
  id: string
  /** What the pane calls it: "Ship", "Patch 0.14.1 -> 0.14.2", "Build Kod" */
  label: string
  log: string
  startedAt: string
  lines: string[]
  code: number | null
  verdict: 'running' | 'ok' | 'dry-run' | 'failed'
  isLocked: boolean
}

export type Action = 'ship' | 'patch' | 'minor' | 'major' | 'start' | 'stop' | 'restart' | 'build' | 'check'

export type Confirm = { action: Action; lines: string[] }

export type Form = { message: string; isDryRun: boolean }

declare module 'claude-code' {
  interface PluginState {
    'shards-console': {
      live: Fetched<LiveSnapshot> | null
      local: Fetched<LocalSnapshot> | null
      visits: Fetched<VisitsSnapshot> | null
      run: RunView | null
      confirm: Confirm | null
      form: Form
      /** error.txt line counts the developer has seen: live and local */
      seen: { live: number; local: number }
      isErrorsShown: boolean
      /** The session opened in meridian-browser or shards-server */
      isInRepo: boolean
    }
  }
}
