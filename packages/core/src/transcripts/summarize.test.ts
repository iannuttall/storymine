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
import type { TranscriptAuditModel } from './audit.js'
import { summarizeSessions } from './summarize.js'

function seedSession(dbPath: string): ReturnType<typeof openResearchDb> {
  const db = openResearchDb(dbPath)
  upsertTranscriptFiles(db, [
    {
      id: 'file_1',
      provider: 'claude',
      path: join('/tmp', 'session.jsonl'),
      sizeBytes: 100,
      modifiedAtMs: Date.now(),
      hash: 'hash_1',
      indexedAt: null,
      status: 'indexed',
      error: null,
    },
  ])
  upsertTranscriptSession(db, {
    id: 'session_1',
    provider: 'claude',
    fileId: 'file_1',
    title: 'png2svg build',
    cwd: '/Users/me/dev/sandbox/png-to-svg',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 2,
    metadata: {},
  })
  upsertTranscriptChunks(db, [
    {
      id: 'chunk_1',
      sessionId: 'session_1',
      provider: 'claude',
      sequence: 0,
      tokenEstimate: 20,
      textHash: 'hash_c1',
      redactedText: '[user] Build a png2svg tool that traces the logo.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
  ])
  return db
}

function countingModel(response: string): TranscriptAuditModel & {
  calls: number
} {
  return {
    calls: 0,
    async complete() {
      this.calls += 1
      return response
    },
  }
}

const RESPONSE = JSON.stringify({
  summary: 'Built a png2svg CLI to reconstruct a logo as native SVG geometry.',
  built: 'png2svg reconstruction CLI',
  problems: 'resvg was unavailable',
  failedApproaches: ['naive tracing produced path soup'],
  whatWorked: 'geometry-first fitting with resvg-py',
  toolsCreated: ['png2svg CLI'],
  opinions: ['generic tracers are the wrong tool'],
})

test('summarizeSessions is idempotent and resumable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-summarize-'))
  try {
    const db = seedSession(join(dir, 'test.db'))
    const model = countingModel(RESPONSE)

    const first = await summarizeSessions({
      model,
      days: 365,
      database: db,
      now: Date.now(),
    })
    assert.equal(first.summarized, 1)
    assert.equal(model.calls, 1)
    assert.equal(first.summaries[0]?.toolsCreated[0], 'png2svg CLI')

    // Second run skips the already-summarized session (no new model call).
    const second = await summarizeSessions({
      model,
      days: 365,
      database: db,
      now: Date.now(),
    })
    assert.equal(second.summarized, 0)
    assert.equal(second.skipped, 1)
    assert.equal(model.calls, 1)

    // Force re-summarizes.
    const forced = await summarizeSessions({
      model,
      days: 365,
      database: db,
      force: true,
      now: Date.now(),
    })
    assert.equal(forced.summarized, 1)
    assert.equal(model.calls, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('summarizeSessions skips sessions with no chunks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-summarize-empty-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    upsertTranscriptFiles(db, [
      {
        id: 'file_1',
        provider: 'codex',
        path: join('/tmp', 'empty.jsonl'),
        sizeBytes: 10,
        modifiedAtMs: Date.now(),
        hash: 'h',
        indexedAt: null,
        status: 'indexed',
        error: null,
      },
    ])
    upsertTranscriptSession(db, {
      id: 'empty_session',
      provider: 'codex',
      fileId: 'file_1',
      title: null,
      cwd: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      metadata: {},
    })
    const model = countingModel(RESPONSE)
    const result = await summarizeSessions({
      model,
      days: 365,
      database: db,
      now: Date.now(),
    })
    assert.equal(result.summarized, 0)
    assert.equal(result.skipped, 1)
    assert.equal(model.calls, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
