import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Artifact } from '../artifacts/scan.js'
import {
  openResearchDb,
  upsertSessionSummary,
  upsertTranscriptChunks,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from '../storage/database.js'
import type { TranscriptAuditModel } from './audit.js'
import { mineStories, parseStoryResponse } from './stories.js'

const STORY = JSON.stringify({
  title: 'Rebuilt a logo from measured geometry',
  concreteProblem:
    'The source /Users/ian/dev/logo.png was antialiased and ordinary tracing produced hundreds of noisy SVG points.',
  failedApproaches:
    'Automatic tracing in trace.py created path soup and threshold masks damaged the curved caps.',
  nonObviousMove:
    'The useful move was to measure circles and shared slopes in measure.py, then rebuild the intended geometry.',
  reusableRecipe:
    'Render the SVG, compare it with the PNG in metrics.py, tune the shared geometry, and repeat until the edges align.',
  evidence:
    'The final output.svg reached 0.998 silhouette IoU and all 19 reconstruction tests passed.',
  confidence: 0.94,
})

test('parseStoryResponse rejects low-confidence stories', () => {
  const weak = JSON.stringify({ ...JSON.parse(STORY), confidence: 0.2 })
  assert.equal(parseStoryResponse(weak), null)
})

test('mineStories rejects repeat sessions for the same story', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storymine-stories-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    upsertTranscriptFiles(db, [
      {
        id: 'file',
        provider: 'codex',
        path: join(dir, 'sessions.jsonl'),
        sizeBytes: 10,
        modifiedAtMs: Date.now(),
        hash: 'hash',
        indexedAt: new Date().toISOString(),
        status: 'indexed',
        error: null,
      },
    ])
    for (const id of ['session-a', 'session-b']) {
      upsertTranscriptSession(db, {
        id,
        provider: 'codex',
        fileId: 'file',
        title: 'logo reconstruction',
        cwd: '/Users/ian/dev/logo-tool',
        startedAt: '2026-07-18T10:00:00.000Z',
        updatedAt: '2026-07-18T11:00:00.000Z',
        messageCount: 2,
        metadata: {},
      })
      upsertTranscriptChunks(db, [
        {
          id: `chunk-${id}`,
          sessionId: id,
          provider: 'codex',
          sequence: 0,
          tokenEstimate: 100,
          textHash: `hash-${id}`,
          redactedText:
            '[user] Rebuild the logo. [assistant] All tests passed.',
          redactionCount: 0,
          auditStatus: 'pending',
          metadata: {},
        },
      ])
      upsertSessionSummary(db, {
        sessionId: id,
        provider: 'codex',
        cwd: '/Users/ian/dev/logo-tool',
        title: 'logo reconstruction',
        summary: 'Rebuilt an antialiased logo from measured SVG geometry.',
        built: 'SVG reconstruction tool',
        problems: 'Automatic tracing failed.',
        failedApproaches: ['Automatic tracing created path soup.'],
        whatWorked: 'Measured geometry and render comparison.',
        toolsCreated: ['logo CLI'],
        opinions: [],
        model: null,
        chunkCount: 4,
        createdAt: '2026-07-19T10:00:00.000Z',
        metadata: {},
      })
    }
    let calls = 0
    const model: TranscriptAuditModel = {
      async complete() {
        calls += 1
        return STORY
      },
    }
    const artifacts: Artifact[] = [
      {
        kind: 'new-repo',
        path: '/Users/ian/dev/logo-tool',
        name: 'logo-tool',
        firstChangeMs: Date.now(),
        lastChangeMs: Date.now(),
        detail: {
          workType: 'new-tool',
          topics: [{ topic: 'AI coding', score: 0.9, matches: ['ai coding'] }],
          links: {
            repositoryUrl: 'https://github.com/example/logo-tool',
            publicUrls: ['https://logo-tool.example'],
            packageName: 'logo-tool',
            packagePrivate: false,
          },
        },
      },
    ]

    const result = await mineStories({
      model,
      days: 7,
      now: Date.parse('2026-07-19T12:00:00.000Z'),
      limit: 2,
      maxPerProject: 2,
      artifacts,
      database: db,
    })

    assert.equal(calls, 2)
    assert.equal(result.storiesCreated, 1)
    assert.equal(result.rejected, 1)
    assert.deepEqual(result.rejections[0]?.reasons, [
      'duplicate of an existing story idea',
    ])
    assert.equal(result.findings[0]?.metadata.supportingFindings, 2)
    assert.deepEqual(result.findings[0]?.metadata.topics, ['AI coding'])
    assert.doesNotMatch(JSON.stringify(result.findings), /\/Users\/ian/)
    assert.match(JSON.stringify(result.findings), /~\/dev\/logo\.png/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
