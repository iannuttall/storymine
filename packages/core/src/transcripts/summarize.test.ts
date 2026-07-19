import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  getSessionSummary,
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

test('summarizeSessions rejects invalid model output and retries it later', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-summarize-invalid-'))
  try {
    const db = seedSession(join(dir, 'test.db'))
    const invalid = countingModel('I could not produce JSON.')
    const first = await summarizeSessions({
      model: invalid,
      days: 365,
      database: db,
      now: Date.now(),
    })

    assert.equal(first.summarized, 0)
    assert.equal(first.failed, 1)
    assert.match(first.failures[0]?.reason ?? '', /valid session summary/)
    assert.equal(getSessionSummary(db, 'session_1'), null)

    const valid = countingModel(RESPONSE)
    const second = await summarizeSessions({
      model: valid,
      days: 365,
      database: db,
      now: Date.now(),
    })
    assert.equal(second.summarized, 1)
    assert.equal(valid.calls, 1)
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

test('summarizeSessions overlaps model calls up to the concurrency limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-summarize-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    upsertTranscriptFiles(db, [
      {
        id: 'file_1',
        provider: 'claude',
        path: join('/tmp', 'many.jsonl'),
        sizeBytes: 100,
        modifiedAtMs: Date.now(),
        hash: 'hash_many',
        indexedAt: null,
        status: 'indexed',
        error: null,
      },
    ])
    for (let index = 0; index < 6; index += 1) {
      upsertTranscriptSession(db, {
        id: `session_${index}`,
        provider: 'claude',
        fileId: 'file_1',
        title: `session ${index}`,
        cwd: '/Users/me/dev/example',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 1,
        metadata: {},
      })
      upsertTranscriptChunks(db, [
        {
          id: `chunk_${index}`,
          sessionId: `session_${index}`,
          provider: 'claude',
          sequence: 0,
          tokenEstimate: 20,
          textHash: `hash_${index}`,
          redactedText: '[user] Example work.',
          redactionCount: 0,
          auditStatus: 'pending',
          metadata: {},
        },
      ])
    }
    let active = 0
    let maxActive = 0
    const model: TranscriptAuditModel = {
      async complete() {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return RESPONSE
      },
    }
    const result = await summarizeSessions({
      model,
      days: 365,
      concurrency: 3,
      database: db,
      now: Date.now(),
    })
    assert.equal(result.summarized, 6)
    assert.equal(result.failed, 0)
    assert.ok(maxActive >= 2, `expected overlap, saw maxActive=${maxActive}`)
    assert.ok(maxActive <= 3, `expected cap of 3, saw maxActive=${maxActive}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('summarizePrompt keeps friction chunks when truncating long sessions', async () => {
  const { summarizePrompt } = await import('./summarize.js')
  const session = {
    id: 'session_long',
    provider: 'codex',
    cwd: '/Users/me/dev/cli/seo',
    title: 'long session',
  }
  const chunk = (id: number, text: string, tokens = 2000) => ({
    id: `chunk_${id}`,
    sessionId: 'session_long',
    provider: 'codex' as const,
    sequence: id,
    tokenEstimate: tokens,
    textHash: `h_${id}`,
    redactedText: text,
    redactionCount: 0,
    auditStatus: 'pending' as const,
    metadata: {},
  })
  const chunks = [
    chunk(0, '[user] build the seo report command'),
    chunk(1, '[assistant] working on reports'),
    chunk(
      2,
      '[assistant] I also refactored the primitives bucket into four files',
    ),
    chunk(
      3,
      '[user] no no no. we should not be hard coding ANYTHING for specific sites',
    ),
    chunk(4, '[assistant] reverting the hardcoded rules'),
    chunk(5, '[assistant] reports now pass checks'),
    chunk(6, '[user] great, ship it'),
  ]
  const prompt = summarizePrompt(session, chunks, 6000)
  assert.ok(
    prompt.includes('no no no. we should not be hard coding'),
    'friction chunk in the middle must survive truncation',
  )
  assert.ok(prompt.includes('omitted for length'))
})
