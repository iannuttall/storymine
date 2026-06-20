import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import { type Signal, signalSchema } from '../schemas.js'
import {
  completeSourceRun,
  createSourceRun,
  getDb,
  insertSignals,
  stableId,
} from '../storage/database.js'

const chromeEpochOffsetSeconds = 11644473600

const defaultNoiseHosts = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'adsense.com',
  'app.ahrefs.com',
  'appstoreconnect.apple.com',
  'ap.www.namecheap.com',
  'clicky.com',
  'dashboard.stripe.com',
  'dashboard.raptive.com',
  'google.com',
  'mail.google.com',
  'gmail.com',
  'session.bbc.co.uk',
]

const defaultNoiseHostFragments = [
  'analytics.google.com',
  'search.google.com',
  'console.cloud.google.com',
  'dash.cloudflare.com',
  'github.com/settings',
  'iron.iann.workers.dev/dashboard',
  'keep.md/settings',
  'www.namecheap.com/twofa',
  'twitter.com',
  'x.com/home',
  'x.com/i/chat',
  'x.com/notifications',
]

export interface ChromeHistoryOptions {
  historyPath?: string
  days?: number
  limit?: number
  now?: Date
  includeNoise?: boolean
  excludeHosts?: string[]
  excludeHostFragments?: string[]
}

export interface StoredChromeHistoryResult {
  runId: string
  signals: Signal[]
}

interface ChromeHistoryRow {
  url: string
  title: string
  visitCount: number
  typedCount: number
  lastVisitTime: number
}

interface AggregatedHistoryRow extends ChromeHistoryRow {
  canonicalUrl: string
}

export function defaultChromeHistoryPath(): string {
  return join(
    process.env.HOME ?? '',
    'Library/Application Support/Google/Chrome/Default/History',
  )
}

export function chromeTimeFromDate(date: Date): number {
  return (
    (Math.floor(date.getTime() / 1000) + chromeEpochOffsetSeconds) * 1_000_000
  )
}

export function dateFromChromeTime(value: number): Date {
  const unixSeconds = Math.floor(value / 1_000_000) - chromeEpochOffsetSeconds
  return new Date(unixSeconds * 1000)
}

export function isNoisyHistoryUrl(
  value: string,
  options: Pick<
    ChromeHistoryOptions,
    'excludeHosts' | 'excludeHostFragments'
  > = {},
): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return true
  }

  if (!['http:', 'https:'].includes(url.protocol)) return true
  const host = url.hostname.toLowerCase()
  const full = `${host}${url.pathname}`.toLowerCase()
  const excludedHosts = options.excludeHosts ?? defaultNoiseHosts
  const excludedFragments =
    options.excludeHostFragments ?? defaultNoiseHostFragments

  if (
    excludedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
  ) {
    return true
  }
  return excludedFragments.some((fragment) => full.includes(fragment))
}

export function collectChromeHistorySignals(
  options: ChromeHistoryOptions = {},
): Signal[] {
  const historyPath = options.historyPath ?? defaultChromeHistoryPath()
  if (!existsSync(historyPath)) {
    throw new Error(`Chrome history database not found: ${historyPath}`)
  }

  const days = clampInt(options.days ?? 7, 1, 365)
  const limit = clampInt(options.limit ?? 40, 1, 500)
  const now = options.now ?? new Date()
  const capturedAt = now.toISOString()
  const sinceChromeTime = chromeTimeFromDate(
    new Date(now.getTime() - days * 86400 * 1000),
  )

  return withCopiedHistoryDb(historyPath, (dbPath) => {
    const database = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const rows = database
        .prepare(
          `SELECT
            url,
            title,
            visit_count AS visitCount,
            typed_count AS typedCount,
            last_visit_time AS lastVisitTime
          FROM urls
          WHERE last_visit_time > @sinceChromeTime
            AND title IS NOT NULL
            AND title != ''
            AND url IS NOT NULL
            AND url != ''
          ORDER BY visit_count DESC, last_visit_time DESC
          LIMIT @queryLimit`,
        )
        .all({ sinceChromeTime, queryLimit: limit * 4 }) as ChromeHistoryRow[]

      const filtered = aggregateHistoryRows(
        rows.filter(
          (row) =>
            options.includeNoise ||
            !isNoisyHistoryUrl(row.url, historyNoiseOptions(options)),
        ),
      ).slice(0, limit)

      const maxVisits = Math.max(...filtered.map((row) => row.visitCount), 1)
      return filtered.map((row) => {
        const url = new URL(row.canonicalUrl)
        return signalSchema.parse({
          id: stableId([
            'search-history',
            row.canonicalUrl,
            row.lastVisitTime,
            capturedAt.slice(0, 10),
          ]),
          source: 'search-history',
          signalType: 'visited-url',
          title: row.title,
          url: row.canonicalUrl,
          summary: `${row.visitCount} visits in the last ${days} days`,
          capturedAt,
          privacyLevel: 'private',
          weight: Math.min(row.visitCount / maxVisits, 1),
          metadata: {
            host: url.hostname,
            canonicalUrl: row.canonicalUrl,
            visitCount: row.visitCount,
            typedCount: row.typedCount,
            lastVisitedAt: dateFromChromeTime(row.lastVisitTime).toISOString(),
            days,
          },
        })
      })
    } finally {
      database.close()
    }
  })
}

function historyNoiseOptions(
  options: Pick<ChromeHistoryOptions, 'excludeHosts' | 'excludeHostFragments'>,
): Pick<ChromeHistoryOptions, 'excludeHosts' | 'excludeHostFragments'> {
  return {
    ...(options.excludeHosts ? { excludeHosts: options.excludeHosts } : {}),
    ...(options.excludeHostFragments
      ? { excludeHostFragments: options.excludeHostFragments }
      : {}),
  }
}

function aggregateHistoryRows(
  rows: ChromeHistoryRow[],
): AggregatedHistoryRow[] {
  const byUrl = new Map<string, AggregatedHistoryRow>()
  for (const row of rows) {
    const canonicalUrl = canonicalizeHistoryUrl(row.url)
    if (!canonicalUrl) continue
    const existing = byUrl.get(canonicalUrl)
    if (!existing) {
      byUrl.set(canonicalUrl, { ...row, canonicalUrl })
      continue
    }
    existing.visitCount += row.visitCount
    existing.typedCount += row.typedCount
    if (row.lastVisitTime > existing.lastVisitTime) {
      existing.title = row.title
      existing.lastVisitTime = row.lastVisitTime
      existing.url = row.url
    }
  }
  return [...byUrl.values()].sort(
    (a, b) => b.visitCount - a.visitCount || b.lastVisitTime - a.lastVisitTime,
  )
}

export function canonicalizeHistoryUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return url.toString()
  } catch {
    return null
  }
}

export function collectAndStoreChromeHistory(
  options: ChromeHistoryOptions = {},
): StoredChromeHistoryResult {
  const database = getDb()
  const run = createSourceRun(database, {
    source: 'search-history',
    command: 'research me history',
    options: {
      days: options.days ?? 7,
      limit: options.limit ?? 40,
      includeNoise: options.includeNoise ?? false,
      historyPath: options.historyPath ? '[custom]' : '[default]',
    },
  })

  try {
    const signals = collectChromeHistorySignals(options).map((signal) => ({
      ...signal,
      runId: run.id,
    }))
    insertSignals(database, signals)
    completeSourceRun(database, run.id, {
      status: 'completed',
      itemCount: signals.length,
    })
    return { runId: run.id, signals }
  } catch (error) {
    completeSourceRun(database, run.id, {
      status: 'failed',
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function withCopiedHistoryDb<T>(
  sourcePath: string,
  callback: (dbPath: string) => T,
): T {
  const tempDir = mkdtempSync(join(tmpdir(), 'research-chrome-'))
  const tempPath = join(tempDir, basename(sourcePath))
  try {
    if (statSync(sourcePath).size === 0) {
      throw new Error(`Chrome history database is empty: ${sourcePath}`)
    }
    copyFileSync(sourcePath, tempPath)
    return callback(tempPath)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.trunc(value), max))
}
