import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TranscriptProvider } from '../schemas.js'
import { getDb } from '../storage/database.js'
import type Database from '../storage/sqlite.js'
import { searchTranscriptChunks, type TranscriptChunkView } from './search.js'

export interface TranscriptCorpusOptions {
  outputDir: string
  query?: string
  provider?: TranscriptProvider
  project?: string
  status?: 'pending' | 'audited' | 'failed'
  limit?: number
}

export interface TranscriptCorpusDocument {
  id: string
  path: string
  title: string
  chunkId: string
  sessionId: string
  sequence: number
  body: string
}

export interface TranscriptCorpusResult {
  outputDir: string
  documents: TranscriptCorpusDocument[]
}

export function writeTranscriptSearchCorpus(
  options: TranscriptCorpusOptions,
  database: Database.Database = getDb(),
): TranscriptCorpusResult {
  const outputDir = options.outputDir
  mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  const result = searchTranscriptChunks(
    {
      ...(options.query ? { query: options.query } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.project ? { project: options.project } : {}),
      ...(options.status ? { status: options.status } : {}),
      limit: options.limit ?? 100,
    },
    database,
  )
  const documents = result.hits.map((chunk) =>
    transcriptChunkToCorpusDocument(chunk, outputDir),
  )
  for (const document of documents) {
    writeFileSync(document.path, document.body)
  }
  return { outputDir, documents }
}

export function transcriptChunkToCorpusDocument(
  chunk: TranscriptChunkView,
  outputDir: string,
): TranscriptCorpusDocument {
  const id = `${chunk.provider}-${chunk.sessionId}-${chunk.sequence}`
  const title = `${chunk.sessionTitle ?? chunk.sessionId} #${chunk.sequence}`
  const path = join(outputDir, `${safeFilename(id)}.md`)
  const metadata = {
    id,
    chunkId: chunk.id,
    provider: chunk.provider,
    sessionId: chunk.sessionId,
    sequence: chunk.sequence,
    auditStatus: chunk.auditStatus,
    tokenEstimate: chunk.tokenEstimate,
    redactionCount: chunk.redactionCount,
    textHash: chunk.textHash,
    sessionTitle: chunk.sessionTitle,
    sessionCwd: chunk.sessionCwd,
    sessionStartedAt: chunk.sessionStartedAt,
    sessionUpdatedAt: chunk.sessionUpdatedAt,
    filePath: chunk.filePath,
  }
  const body = [
    `# ${title}`,
    '',
    '```json provenance',
    JSON.stringify(metadata, null, 2),
    '```',
    '',
    '## Transcript Chunk',
    '',
    chunk.redactedText,
    '',
  ].join('\n')
  return {
    id,
    path,
    title,
    chunkId: chunk.id,
    sessionId: chunk.sessionId,
    sequence: chunk.sequence,
    body,
  }
}

function safeFilename(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
}
