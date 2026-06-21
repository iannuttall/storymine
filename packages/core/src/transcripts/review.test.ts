import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  insertTranscriptFindings,
  openResearchDb,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from '../storage/database.js'
import {
  listTranscriptFindingReviews,
  renderTranscriptFindingReviewsMarkdown,
  reviewStatusForFinding,
  reviewTranscriptFinding,
} from './review.js'

test('reviewTranscriptFinding stores review status in metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-review-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedFinding(db, dir)

    const reviewed = reviewTranscriptFinding(
      { id: 'finding_1', status: 'approved', notes: 'Strong prompt lesson.' },
      db,
    )

    assert.equal(reviewStatusForFinding(reviewed), 'approved')
    assert.equal(reviewed.metadata.reviewNotes, 'Strong prompt lesson.')
    assert.equal(
      listTranscriptFindingReviews({ status: 'unreviewed' }, db).length,
      0,
    )
    assert.equal(
      listTranscriptFindingReviews({ status: 'approved' }, db).length,
      1,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderTranscriptFindingReviewsMarkdown is agent-readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-review-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedFinding(db, dir)

    const markdown = renderTranscriptFindingReviewsMarkdown(
      listTranscriptFindingReviews({}, db),
    )

    assert.match(markdown, /Finding ID: finding_1/)
    assert.match(markdown, /Example prompt:/)
    assert.match(markdown, /Evidence:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function seedFinding(db: ReturnType<typeof openResearchDb>, dir: string): void {
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
    title: 'Session',
    cwd: null,
    startedAt: null,
    updatedAt: null,
    messageCount: 1,
    metadata: {},
  })
  insertTranscriptFindings(db, [
    {
      id: 'finding_1',
      sessionId: 'session_1',
      chunkId: null,
      lesson: 'Ask AI to inspect real output before rewriting.',
      whyNonObvious: 'It turns vague critique into grounded revision.',
      category: 'prompting',
      confidence: 0.88,
      evidence: ['The user rejected generic copy and requested inspection.'],
      candidateId: null,
      capturedAt: '2026-06-20T10:00:00.000Z',
      metadata: {
        alphaType: 'verification-loop',
        examplePrompt:
          'Inspect the actual output first, then rewrite only what is visibly weak.',
      },
    },
  ])
}
