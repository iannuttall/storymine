import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  openResearchDb,
  upsertTranscriptChunks,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from '../storage/database.js'
import {
  transcriptChunkToCorpusDocument,
  writeTranscriptSearchCorpus,
} from './corpus.js'
import { getTranscriptChunkView } from './search.js'

test('transcriptChunkToCorpusDocument keeps searchable provenance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-corpus-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedTranscript(db, dir)
    const chunk = getTranscriptChunkView('chunk_1', db)
    assert.ok(chunk)

    const document = transcriptChunkToCorpusDocument(chunk, dir)

    assert.match(document.body, /```json provenance/)
    assert.match(document.body, /"chunkId": "chunk_1"/)
    assert.match(document.body, /Inspect the real screen/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeTranscriptSearchCorpus writes filtered markdown files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-corpus-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedTranscript(db, dir)
    const outputDir = join(dir, 'corpus')

    const result = writeTranscriptSearchCorpus(
      { outputDir, query: 'screen', limit: 10 },
      db,
    )

    assert.equal(result.documents.length, 1)
    const file = result.documents[0]?.path
    assert.ok(file)
    assert.equal(existsSync(file), true)
    assert.match(readFileSync(file, 'utf8'), /"sessionId": "session_1"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function seedTranscript(
  db: ReturnType<typeof openResearchDb>,
  dir: string,
): void {
  upsertTranscriptFiles(db, [
    {
      id: 'file_1',
      provider: 'codex',
      path: join(dir, 'session.jsonl'),
      sizeBytes: 12,
      modifiedAtMs: 1234,
      hash: 'hash_1',
      indexedAt: '2026-06-20T10:00:00.000Z',
      status: 'indexed',
      error: null,
    },
  ])
  upsertTranscriptSession(db, {
    id: 'session_1',
    provider: 'codex',
    fileId: 'file_1',
    title: 'Tidechecker web',
    cwd: '/Users/iannuttall/dev/apps/tidechecker-web',
    startedAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-20T11:00:00.000Z',
    messageCount: 1,
    metadata: {},
  })
  upsertTranscriptChunks(db, [
    {
      id: 'chunk_1',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 1,
      tokenEstimate: 20,
      textHash: 'hash_1',
      redactedText:
        '[user] The copy is generic. Inspect the real screen before rewriting.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
  ])
}
