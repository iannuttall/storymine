import type Database from 'better-sqlite3'
import type { TranscriptChunk, TranscriptProvider } from '../schemas.js'
import { getDb } from '../storage/database.js'

export interface TranscriptChunkView extends TranscriptChunk {
  sessionTitle: string | null
  sessionCwd: string | null
  sessionStartedAt: string | null
  sessionUpdatedAt: string | null
  filePath: string
  excerpt: string
}

export interface SearchTranscriptChunksOptions {
  query?: string
  provider?: TranscriptProvider
  project?: string
  status?: 'pending' | 'audited' | 'failed'
  limit?: number
}

export interface SearchTranscriptChunksResult {
  query: string | null
  terms: string[]
  hits: TranscriptChunkView[]
}

export interface ReadTranscriptChunksOptions {
  sessionId: string
  sequence?: number
  before?: number
  after?: number
  limit?: number
}

interface TranscriptChunkRow
  extends Omit<TranscriptChunk, 'metadata'>,
    Omit<TranscriptChunkView, keyof TranscriptChunk> {
  metadataJson: string
}

export function searchTranscriptChunks(
  options: SearchTranscriptChunksOptions = {},
  database: Database.Database = getDb(),
): SearchTranscriptChunksResult {
  const terms = tokenizeSearchQuery(options.query ?? '')
  const projectTerms = tokenizeSearchQuery(options.project ?? '')
  const limit = clampLimit(options.limit, 20, 200)
  const conditions = [
    '(@provider IS NULL OR c.provider = @provider)',
    '(@status IS NULL OR c.audit_status = @status)',
  ]
  const params: Record<string, unknown> = {
    provider: options.provider ?? null,
    status: options.status ?? null,
    limit,
  }

  appendTermConditions({
    conditions,
    params,
    terms,
    prefix: 'term',
    columns: ['c.redacted_text', 's.title', 's.cwd', 'f.path'],
  })
  appendTermConditions({
    conditions,
    params,
    terms: projectTerms,
    prefix: 'project',
    columns: ['s.title', 's.cwd', 'f.path'],
  })

  const rows = database
    .prepare(
      `SELECT
        c.id,
        c.session_id AS sessionId,
        c.provider,
        c.sequence,
        c.token_estimate AS tokenEstimate,
        c.text_hash AS textHash,
        c.redacted_text AS redactedText,
        c.redaction_count AS redactionCount,
        c.audit_status AS auditStatus,
        c.metadata_json AS metadataJson,
        s.title AS sessionTitle,
        s.cwd AS sessionCwd,
        s.started_at AS sessionStartedAt,
        s.updated_at AS sessionUpdatedAt,
        f.path AS filePath
      FROM transcript_chunks c
      JOIN transcript_sessions s ON s.id = c.session_id
      JOIN transcript_files f ON f.id = s.file_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(s.updated_at, s.started_at, '') DESC, c.sequence ASC
      LIMIT @limit`,
    )
    .all(params) as TranscriptChunkRow[]

  return {
    query: options.query?.trim() || null,
    terms,
    hits: rows.map((row) => chunkViewFromRow(row, terms)),
  }
}

export function getTranscriptChunkView(
  id: string,
  database: Database.Database = getDb(),
): TranscriptChunkView | null {
  const row = database
    .prepare(
      `SELECT
        c.id,
        c.session_id AS sessionId,
        c.provider,
        c.sequence,
        c.token_estimate AS tokenEstimate,
        c.text_hash AS textHash,
        c.redacted_text AS redactedText,
        c.redaction_count AS redactionCount,
        c.audit_status AS auditStatus,
        c.metadata_json AS metadataJson,
        s.title AS sessionTitle,
        s.cwd AS sessionCwd,
        s.started_at AS sessionStartedAt,
        s.updated_at AS sessionUpdatedAt,
        f.path AS filePath
      FROM transcript_chunks c
      JOIN transcript_sessions s ON s.id = c.session_id
      JOIN transcript_files f ON f.id = s.file_id
      WHERE c.id = @id`,
    )
    .get({ id }) as TranscriptChunkRow | undefined
  return row ? chunkViewFromRow(row, []) : null
}

export function readTranscriptChunks(
  options: ReadTranscriptChunksOptions,
  database: Database.Database = getDb(),
): TranscriptChunkView[] {
  const before = clampContext(options.before, 0, 20)
  const after = clampContext(options.after, 0, 20)
  const limit = clampLimit(options.limit, 20, 100)
  const sequence = options.sequence
  const hasSequence = sequence !== undefined
  const lower = hasSequence ? Math.max(0, sequence - before) : 0
  const upper = hasSequence ? sequence + after : Number.MAX_SAFE_INTEGER
  const rows = database
    .prepare(
      `SELECT
        c.id,
        c.session_id AS sessionId,
        c.provider,
        c.sequence,
        c.token_estimate AS tokenEstimate,
        c.text_hash AS textHash,
        c.redacted_text AS redactedText,
        c.redaction_count AS redactionCount,
        c.audit_status AS auditStatus,
        c.metadata_json AS metadataJson,
        s.title AS sessionTitle,
        s.cwd AS sessionCwd,
        s.started_at AS sessionStartedAt,
        s.updated_at AS sessionUpdatedAt,
        f.path AS filePath
      FROM transcript_chunks c
      JOIN transcript_sessions s ON s.id = c.session_id
      JOIN transcript_files f ON f.id = s.file_id
      WHERE c.session_id = @sessionId
        AND c.sequence >= @lower
        AND c.sequence <= @upper
      ORDER BY c.sequence ASC
      LIMIT @limit`,
    )
    .all({
      sessionId: options.sessionId,
      lower,
      upper,
      limit,
    }) as TranscriptChunkRow[]
  return rows.map((row) => chunkViewFromRow(row, []))
}

export function renderTranscriptChunkMarkdown(
  chunk: TranscriptChunkView,
): string {
  return [
    `# ${chunk.sessionTitle ?? chunk.sessionId}`,
    '',
    `- Provider: ${chunk.provider}`,
    `- Session: ${chunk.sessionId}`,
    `- Chunk: ${chunk.sequence}`,
    `- Status: ${chunk.auditStatus}`,
    `- Tokens: ${chunk.tokenEstimate}`,
    `- File: ${chunk.filePath}`,
    ...(chunk.sessionCwd ? [`- CWD: ${chunk.sessionCwd}`] : []),
    '',
    chunk.redactedText,
    '',
  ].join('\n')
}

export function tokenizeSearchQuery(query: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of query
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)) {
    if (seen.has(item)) continue
    seen.add(item)
    terms.push(item)
  }
  return terms.slice(0, 12)
}

function appendTermConditions(input: {
  conditions: string[]
  params: Record<string, unknown>
  terms: string[]
  prefix: string
  columns: string[]
}): void {
  for (let index = 0; index < input.terms.length; index += 1) {
    const key = `${input.prefix}${index}`
    input.params[key] = `%${escapeLike(input.terms[index] ?? '')}%`
    input.conditions.push(
      `(${input.columns
        .map(
          (column) => `LOWER(COALESCE(${column}, '')) LIKE @${key} ESCAPE '\\'`,
        )
        .join(' OR ')})`,
    )
  }
}

function chunkViewFromRow(
  row: TranscriptChunkRow,
  terms: string[],
): TranscriptChunkView {
  const redactedText = row.redactedText
  return {
    id: row.id,
    sessionId: row.sessionId,
    provider: row.provider,
    sequence: row.sequence,
    tokenEstimate: row.tokenEstimate,
    textHash: row.textHash,
    redactedText,
    redactionCount: row.redactionCount,
    auditStatus: row.auditStatus,
    metadata: parseJsonRecord(row.metadataJson),
    sessionTitle: row.sessionTitle,
    sessionCwd: row.sessionCwd,
    sessionStartedAt: row.sessionStartedAt,
    sessionUpdatedAt: row.sessionUpdatedAt,
    filePath: row.filePath,
    excerpt: excerptForTerms(redactedText, terms),
  }
}

function excerptForTerms(text: string, terms: string[]): string {
  const normalized = text.toLowerCase()
  const firstIndex = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  const start = Math.max(0, (firstIndex ?? 0) - 120)
  const end = Math.min(text.length, start + 320)
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim()
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${excerpt}${suffix}`
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return Math.max(1, Math.min(value ?? fallback, max))
}

function clampContext(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return Math.max(0, Math.min(value ?? fallback, max))
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}
