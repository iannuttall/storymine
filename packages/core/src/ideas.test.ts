import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listStoryIdeas, renderStoryIdeasMarkdown } from './ideas.js'
import {
  insertTranscriptFindings,
  openResearchDb,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from './storage/database.js'

test('listStoryIdeas returns publish-safe structured fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storymine-ideas-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    upsertTranscriptFiles(db, [
      {
        id: 'file',
        provider: 'codex',
        path: join(dir, 'session.jsonl'),
        sizeBytes: 10,
        modifiedAtMs: Date.now(),
        hash: 'hash',
        indexedAt: new Date().toISOString(),
        status: 'indexed',
        error: null,
      },
    ])
    upsertTranscriptSession(db, {
      id: 'session',
      provider: 'codex',
      fileId: 'file',
      title: 'logo',
      cwd: '/Users/ian/dev/logo',
      startedAt: null,
      updatedAt: null,
      messageCount: 2,
      metadata: {},
    })
    insertTranscriptFindings(db, [
      {
        id: 'idea-1',
        sessionId: 'session',
        chunkId: null,
        lesson: 'Rebuilt a logo from measured geometry',
        whyNonObvious: 'Measured the intended shape instead of tracing pixels.',
        category: 'story',
        confidence: 0.93,
        evidence: ['All 19 tests passed.'],
        candidateId: null,
        capturedAt: '2026-07-19T10:00:00.000Z',
        metadata: {
          project: 'logo',
          topics: ['AI coding'],
          publication: {
            repository: {
              url: 'https://github.com/example/logo',
              visibility: 'unknown',
            },
            declaredPublicUrls: ['https://logo.example'],
            package: null,
          },
          concreteProblem:
            'The source /Users/ian/dev/logo.png produced hundreds of noisy SVG points when traced.',
          failedApproaches:
            'Automatic tracing in trace.py created path soup and damaged the curved caps.',
          nonObviousMove:
            'Measured circles and shared slopes in measure.py before rebuilding the intended geometry.',
          reusableRecipe:
            'Render output.svg, compare it in metrics.py, tune shared geometry, and repeat until edges align.',
          evidenceItWorked:
            'The final output.svg reached 0.998 silhouette IoU and all 19 tests passed.',
        },
      },
    ])

    const ideas = listStoryIdeas({ status: 'new' }, db)
    assert.equal(ideas.length, 1)
    assert.equal(ideas[0]?.status, 'new')
    assert.deepEqual(ideas[0]?.topics, ['AI coding'])
    assert.equal(
      ideas[0]?.publication.repository?.url,
      'https://github.com/example/logo',
    )
    assert.doesNotMatch(JSON.stringify(ideas), /session/)
    assert.doesNotMatch(JSON.stringify(ideas), /\/Users\/ian/)
    assert.match(renderStoryIdeasMarkdown(ideas), /Non-obvious move/)
    assert.match(renderStoryIdeasMarkdown(ideas), /visibility not checked/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
