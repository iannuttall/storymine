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
  type TranscriptChunk,
  type TranscriptFile,
  type TranscriptFinding,
  type TranscriptSession,
  transcriptChunkSchema,
  transcriptFileSchema,
  transcriptFindingSchema,
  transcriptSessionSchema,
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
  redacted_text TEXT NOT NULL,
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
  ensureColumn(
    database,
    'transcript_chunks',
    'redacted_text',
    "TEXT NOT NULL DEFAULT ''",
  )
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{
    name: string
  }>
  if (columns.some((item) => item.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
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

export function upsertTranscriptFiles(
  database: Database.Database,
  files: TranscriptFile[],
): void {
  const insert = database.prepare(
    `INSERT INTO transcript_files (
      id, provider, path, size_bytes, modified_at_ms, hash, indexed_at,
      status, error
    ) VALUES (
      @id, @provider, @path, @sizeBytes, @modifiedAtMs, @hash, @indexedAt,
      @status, @error
    )
    ON CONFLICT(path) DO UPDATE SET
      provider = excluded.provider,
      size_bytes = excluded.size_bytes,
      modified_at_ms = excluded.modified_at_ms,
      hash = excluded.hash,
      indexed_at = CASE
        WHEN transcript_files.hash = excluded.hash THEN transcript_files.indexed_at
        ELSE NULL
      END,
      status = CASE
        WHEN transcript_files.hash = excluded.hash THEN transcript_files.status
        ELSE excluded.status
      END,
      error = excluded.error`,
  )
  const write = database.transaction((items: TranscriptFile[]) => {
    for (const item of items) {
      insert.run(transcriptFileSchema.parse(item))
    }
  })
  write(files)
}

export function listTranscriptFiles(
  database: Database.Database,
  options: { provider?: string; status?: string; limit?: number } = {},
): TranscriptFile[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 10_000))
  const rows = database
    .prepare(
      `SELECT
        id,
        provider,
        path,
        size_bytes AS sizeBytes,
        modified_at_ms AS modifiedAtMs,
        hash,
        indexed_at AS indexedAt,
        status,
        error
      FROM transcript_files
      WHERE (@provider IS NULL OR provider = @provider)
        AND (@status IS NULL OR status = @status)
      ORDER BY modified_at_ms DESC
      LIMIT @limit`,
    )
    .all({
      provider: options.provider ?? null,
      status: options.status ?? null,
      limit,
    }) as TranscriptFile[]
  return rows.map((row) => transcriptFileSchema.parse(row))
}

export function upsertTranscriptSession(
  database: Database.Database,
  session: TranscriptSession,
): void {
  const parsed = transcriptSessionSchema.parse(session)
  database
    .prepare(
      `INSERT INTO transcript_sessions (
        id, provider, file_id, title, cwd, started_at, updated_at,
        message_count, metadata_json
      ) VALUES (
        @id, @provider, @fileId, @title, @cwd, @startedAt, @updatedAt,
        @messageCount, @metadataJson
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        cwd = excluded.cwd,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count,
        metadata_json = excluded.metadata_json`,
    )
    .run({
      ...parsed,
      metadataJson: JSON.stringify(parsed.metadata),
    })
}

export function upsertTranscriptChunks(
  database: Database.Database,
  chunks: TranscriptChunk[],
): void {
  const insert = database.prepare(
    `INSERT INTO transcript_chunks (
      id, session_id, provider, sequence, token_estimate, text_hash,
      redacted_text, redaction_count, audit_status, metadata_json
    ) VALUES (
      @id, @sessionId, @provider, @sequence, @tokenEstimate, @textHash,
      @redactedText, @redactionCount, @auditStatus, @metadataJson
    )
    ON CONFLICT(session_id, sequence) DO UPDATE SET
      token_estimate = excluded.token_estimate,
      text_hash = excluded.text_hash,
      redacted_text = excluded.redacted_text,
      redaction_count = excluded.redaction_count,
      audit_status = CASE
        WHEN transcript_chunks.text_hash = excluded.text_hash THEN transcript_chunks.audit_status
        ELSE excluded.audit_status
      END,
      metadata_json = excluded.metadata_json`,
  )
  const write = database.transaction((items: TranscriptChunk[]) => {
    for (const item of items) {
      const chunk = transcriptChunkSchema.parse(item)
      insert.run({
        ...chunk,
        metadataJson: JSON.stringify(chunk.metadata),
      })
    }
  })
  write(chunks)
}

export function markTranscriptFileIndexed(
  database: Database.Database,
  id: string,
): void {
  database
    .prepare(
      `UPDATE transcript_files
       SET indexed_at = @indexedAt,
           status = 'indexed',
           error = NULL
       WHERE id = @id`,
    )
    .run({ id, indexedAt: nowIso() })
}

export function listTranscriptChunks(
  database: Database.Database,
  options: { status?: string; limit?: number } = {},
): TranscriptChunk[] {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 1000))
  const rows = database
    .prepare(
      `SELECT
        id,
        session_id AS sessionId,
        provider,
        sequence,
        token_estimate AS tokenEstimate,
        text_hash AS textHash,
        redacted_text AS redactedText,
        redaction_count AS redactionCount,
        audit_status AS auditStatus,
        metadata_json AS metadataJson
      FROM transcript_chunks
      WHERE (@status IS NULL OR audit_status = @status)
      ORDER BY rowid ASC
      LIMIT @limit`,
    )
    .all({ status: options.status ?? null, limit }) as Array<
    Omit<TranscriptChunk, 'metadata'> & { metadataJson: string }
  >
  return rows.map((row) =>
    transcriptChunkSchema.parse({
      ...row,
      metadata: parseJsonRecord(row.metadataJson),
    }),
  )
}

export function markTranscriptChunkAuditStatus(
  database: Database.Database,
  id: string,
  status: 'pending' | 'audited' | 'failed',
): void {
  database
    .prepare(
      `UPDATE transcript_chunks SET audit_status = @status WHERE id = @id`,
    )
    .run({ id, status })
}

export function insertTranscriptFindings(
  database: Database.Database,
  findings: TranscriptFinding[],
): void {
  const insert = database.prepare(
    `INSERT INTO transcript_findings (
      id, session_id, chunk_id, lesson, why_non_obvious, category, confidence,
      evidence_json, candidate_id, captured_at, metadata_json
    ) VALUES (
      @id, @sessionId, @chunkId, @lesson, @whyNonObvious, @category,
      @confidence, @evidenceJson, @candidateId, @capturedAt, @metadataJson
    )
    ON CONFLICT(id) DO UPDATE SET
      lesson = excluded.lesson,
      why_non_obvious = excluded.why_non_obvious,
      category = excluded.category,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      candidate_id = excluded.candidate_id,
      metadata_json = excluded.metadata_json`,
  )
  const write = database.transaction((items: TranscriptFinding[]) => {
    for (const item of items) {
      const finding = transcriptFindingSchema.parse(item)
      insert.run({
        ...finding,
        evidenceJson: JSON.stringify(finding.evidence),
        metadataJson: JSON.stringify(finding.metadata),
      })
    }
  })
  write(findings)
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
