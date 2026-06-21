import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
  readTranscriptChunks,
  renderTranscriptChunkMarkdown,
  searchTranscriptChunks,
  tokenizeSearchQuery,
} from './search.js'

test('tokenizeSearchQuery dedupes and keeps useful path-ish terms', () => {
  assert.deepEqual(tokenizeSearchQuery('AI overbuilt /tmp/app overbuilt'), [
    'ai',
    'overbuilt',
    '/tmp/app',
  ])
})

test('searchTranscriptChunks finds redacted chunks with provenance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-search-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedTranscript(db, dir)

    const result = searchTranscriptChunks(
      { query: 'generic copy inspect screen', limit: 10 },
      db,
    )

    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0]?.sessionId, 'session_1')
    assert.equal(result.hits[0]?.sequence, 1)
    assert.match(result.hits[0]?.excerpt ?? '', /copy is generic/)
    assert.match(result.hits[0]?.filePath ?? '', /session\.jsonl/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('searchTranscriptChunks filters by project context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-search-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedTranscript(db, dir)

    const result = searchTranscriptChunks(
      { query: 'generic copy', project: 'binday' },
      db,
    )

    assert.equal(result.hits.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readTranscriptChunks returns sequence context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-search-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedTranscript(db, dir)

    const chunks = readTranscriptChunks(
      { sessionId: 'session_1', sequence: 1, before: 1, after: 1 },
      db,
    )

    assert.deepEqual(
      chunks.map((chunk) => chunk.sequence),
      [0, 1, 2],
    )
    const middle = chunks[1]
    assert.ok(middle)
    assert.match(renderTranscriptChunkMarkdown(middle), /Provider: codex/)
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
    messageCount: 3,
    metadata: {},
  })
  upsertTranscriptChunks(db, [
    {
      id: 'chunk_0',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 0,
      tokenEstimate: 10,
      textHash: 'hash_0',
      redactedText: '[user] Build the page.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
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
    {
      id: 'chunk_2',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 2,
      tokenEstimate: 10,
      textHash: 'hash_2',
      redactedText: '[assistant] I checked the screen and tightened the copy.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
  ])
}
