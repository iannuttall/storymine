import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { fileSize, getResearchPaths } from '../paths.js'
import {
  type Candidate,
  candidateSchema,
  type Signal,
  type Source,
  type SourceRun,
  signalSchema,
  sourceRunSchema,
} from '../schemas.js'

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  command TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  options_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_runs_source_started
  ON source_runs(source, started_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  source TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  captured_at TEXT NOT NULL,
  privacy_level TEXT NOT NULL,
  weight REAL NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES source_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_source_captured
  ON signals(source, captured_at DESC);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  signal_id TEXT,
  name TEXT NOT NULL,
  url TEXT,
  one_liner TEXT NOT NULL,
  why_interesting TEXT NOT NULL,
  tier TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  score REAL,
  status TEXT NOT NULL,
  FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_status_captured
  ON candidates(status, captured_at DESC);

CREATE TABLE IF NOT EXISTS transcript_files (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  hash TEXT,
  indexed_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcript_files_provider_status
  ON transcript_files(provider, status);

CREATE TABLE IF NOT EXISTS transcript_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  file_id TEXT NOT NULL,
  title TEXT,
  cwd TEXT,
  started_at TEXT,
  updated_at TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(file_id) REFERENCES transcript_files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transcript_sessions_updated
  ON transcript_sessions(provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS transcript_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  text_hash TEXT NOT NULL,
  redaction_count INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  FOREIGN KEY(session_id) REFERENCES transcript_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transcript_chunks_status
  ON transcript_chunks(audit_status, provider);

CREATE TABLE IF NOT EXISTS transcript_findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_id TEXT,
  lesson TEXT NOT NULL,
  why_non_obvious TEXT,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_json TEXT NOT NULL,
  candidate_id TEXT,
  captured_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES transcript_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(chunk_id) REFERENCES transcript_chunks(id) ON DELETE SET NULL,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_findings_category
  ON transcript_findings(category, confidence DESC);
`

let db: Database.Database | undefined

export interface StorageStats {
  dbPath: string
  sizeBytes: number
  counts: Record<string, number>
}

export function openResearchDb(
  path = getResearchPaths().cacheDbFile,
): Database.Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const database = new Database(path)
  initResearchDb(database)
  return database
}

export function getDb(): Database.Database {
  if (db) return db
  db = openResearchDb()
  return db
}

export function closeDbForTests(): void {
  db?.close()
  db = undefined
}

export function initResearchDb(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('foreign_keys = ON')
  database.pragma('temp_store = MEMORY')
  database.pragma('busy_timeout = 5000')
  database.exec(CREATE_SQL)
}

export function stableId(parts: unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('base64url')
    .slice(0, 32)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createSourceRun(
  database: Database.Database,
  input: {
    source: Source
    command: string
    options?: Record<string, unknown>
  },
): SourceRun {
  const run = sourceRunSchema.parse({
    id: `run_${randomUUID()}`,
    source: input.source,
    command: input.command,
    startedAt: nowIso(),
    finishedAt: null,
    status: 'running',
    itemCount: 0,
    error: null,
    options: input.options ?? {},
  })
  database
    .prepare(
      `INSERT INTO source_runs (
        id, source, command, started_at, finished_at, status, item_count,
        error, options_json
      ) VALUES (
        @id, @source, @command, @startedAt, @finishedAt, @status, @itemCount,
        @error, @optionsJson
      )`,
    )
    .run({ ...run, optionsJson: JSON.stringify(run.options) })
  return run
}

export function completeSourceRun(
  database: Database.Database,
  id: string,
  result: { status: 'completed' | 'failed'; itemCount: number; error?: string },
): void {
  database
    .prepare(
      `UPDATE source_runs
       SET finished_at = @finishedAt,
           status = @status,
           item_count = @itemCount,
           error = @error
       WHERE id = @id`,
    )
    .run({
      id,
      finishedAt: nowIso(),
      status: result.status,
      itemCount: result.itemCount,
      error: result.error ?? null,
    })
}

export function insertSignals(
  database: Database.Database,
  signals: Signal[],
): void {
  const insert = database.prepare(
    `INSERT INTO signals (
      id, run_id, source, signal_type, title, url, summary, captured_at,
      privacy_level, weight, metadata_json
    ) VALUES (
      @id, @runId, @source, @signalType, @title, @url, @summary, @capturedAt,
      @privacyLevel, @weight, @metadataJson
    )
    ON CONFLICT(id) DO UPDATE SET
      run_id = excluded.run_id,
      title = excluded.title,
      url = excluded.url,
      summary = excluded.summary,
      captured_at = excluded.captured_at,
      privacy_level = excluded.privacy_level,
      weight = excluded.weight,
      metadata_json = excluded.metadata_json`,
  )
  const write = database.transaction((items: Signal[]) => {
    for (const item of items) {
      const signal = signalSchema.parse(item)
      insert.run({
        ...signal,
        metadataJson: JSON.stringify(signal.metadata),
      })
    }
  })
  write(signals)
}

export function listSignals(
  database: Database.Database,
  options: { source?: Source; limit?: number } = {},
): Signal[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000))
  const rows = database
    .prepare(
      `SELECT
        id,
        run_id AS runId,
        source,
        signal_type AS signalType,
        title,
        url,
        summary,
        captured_at AS capturedAt,
        privacy_level AS privacyLevel,
        weight,
        metadata_json AS metadataJson
      FROM signals
      WHERE (@source IS NULL OR source = @source)
      ORDER BY captured_at DESC
      LIMIT @limit`,
    )
    .all({ source: options.source ?? null, limit }) as Array<
    Omit<Signal, 'metadata'> & { metadataJson: string }
  >
  return rows.map((row) =>
    signalSchema.parse({
      ...row,
      metadata: parseJsonRecord(row.metadataJson),
    }),
  )
}

export function insertCandidates(
  database: Database.Database,
  candidates: Candidate[],
): void {
  const insert = database.prepare(
    `INSERT INTO candidates (
      id, source, signal_id, name, url, one_liner, why_interesting, tier,
      metrics_json, provenance_json, captured_at, score, status
    ) VALUES (
      @id, @source, @signalId, @name, @url, @oneLiner, @whyInteresting,
      @tier, @metricsJson, @provenanceJson, @capturedAt, @score, @status
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      one_liner = excluded.one_liner,
      why_interesting = excluded.why_interesting,
      tier = excluded.tier,
      metrics_json = excluded.metrics_json,
      provenance_json = excluded.provenance_json,
      score = excluded.score,
      status = excluded.status`,
  )
  const write = database.transaction((items: Candidate[]) => {
    for (const item of items) {
      const candidate = candidateSchema.parse(item)
      insert.run({
        ...candidate,
        metricsJson: JSON.stringify(candidate.metrics),
        provenanceJson: JSON.stringify(candidate.provenance),
      })
    }
  })
  write(candidates)
}

export function getStorageStats(
  database: Database.Database = getDb(),
  dbPath = getResearchPaths().cacheDbFile,
): StorageStats {
  const tableNames = [
    ['sourceRuns', 'source_runs'],
    ['signals', 'signals'],
    ['candidates', 'candidates'],
    ['transcriptFiles', 'transcript_files'],
    ['transcriptSessions', 'transcript_sessions'],
    ['transcriptChunks', 'transcript_chunks'],
    ['transcriptFindings', 'transcript_findings'],
  ] as const
  const counts = Object.fromEntries(
    tableNames.map(([key, table]) => {
      const row = database
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number }
      return [key, row.count]
    }),
  )

  return {
    dbPath,
    sizeBytes: existsSync(dbPath) ? fileSize(dbPath) : 0,
    counts,
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}
