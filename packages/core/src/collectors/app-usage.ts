import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { type Signal, signalSchema } from '../schemas.js'
import {
  completeSourceRun,
  createSourceRun,
  getDb,
  insertSignals,
  stableId,
} from '../storage/database.js'

const appleEpochOffsetSeconds = 978307200

export interface AppUsageOptions {
  dbPath?: string
  days?: number
  limit?: number
  now?: Date
}

export interface StoredAppUsageResult {
  runId: string
  signals: Signal[]
}

interface AppUsageRow {
  app: string
  seconds: number
  hours: number
}

export function defaultKnowledgeDbPath(): string {
  return join(homedir(), 'Library/Application Support/Knowledge/knowledgeC.db')
}

export function collectAppUsageSignals(
  options: AppUsageOptions = {},
): Signal[] {
  const dbPath = options.dbPath ?? defaultKnowledgeDbPath()
  if (!existsSync(dbPath)) {
    throw new Error(`Screen Time database not found: ${dbPath}`)
  }

  const days = clampInt(options.days ?? 7, 1, 30)
  const limit = clampInt(options.limit ?? 30, 1, 200)
  const now = options.now ?? new Date()
  const nowUnixSeconds = Math.floor(now.getTime() / 1000)
  const sinceAppleSeconds =
    nowUnixSeconds - days * 86400 - appleEpochOffsetSeconds
  const capturedAt = now.toISOString()

  const database = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = database
      .prepare(
        `SELECT
          ZVALUESTRING AS app,
          SUM(ZENDDATE - ZSTARTDATE) AS seconds,
          ROUND(SUM(ZENDDATE - ZSTARTDATE) / 3600.0, 2) AS hours
        FROM ZOBJECT
        WHERE ZSTREAMNAME = '/app/usage'
          AND ZVALUESTRING IS NOT NULL
          AND ZVALUESTRING != ''
          AND ZSTARTDATE > @sinceAppleSeconds
          AND ZENDDATE > ZSTARTDATE
        GROUP BY ZVALUESTRING
        ORDER BY seconds DESC
        LIMIT @limit`,
      )
      .all({ sinceAppleSeconds, limit }) as AppUsageRow[]

    const maxSeconds = Math.max(...rows.map((row) => row.seconds), 1)
    return rows.map((row) =>
      signalSchema.parse({
        id: stableId(['app-usage', row.app, days, capturedAt.slice(0, 10)]),
        source: 'app-usage',
        signalType: 'app',
        title: row.app,
        summary: `${row.hours.toFixed(1)} hours used over ${days} days`,
        capturedAt,
        privacyLevel: 'private',
        weight: Math.min(row.seconds / maxSeconds, 1),
        metadata: {
          app: row.app,
          seconds: Math.round(row.seconds),
          hours: row.hours,
          days,
        },
      }),
    )
  } finally {
    database.close()
  }
}

export function collectAndStoreAppUsage(
  options: AppUsageOptions = {},
): StoredAppUsageResult {
  const database = getDb()
  const run = createSourceRun(database, {
    source: 'app-usage',
    command: 'research me apps',
    options: {
      days: options.days ?? 7,
      limit: options.limit ?? 30,
      dbPath: options.dbPath ? '[custom]' : '[default]',
    },
  })

  try {
    const signals = collectAppUsageSignals(options).map((signal) => ({
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

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.trunc(value), max))
}
