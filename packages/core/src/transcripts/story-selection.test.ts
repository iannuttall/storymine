import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Artifact } from '../artifacts/scan.js'
import type { TranscriptSession } from '../schemas.js'
import {
  openResearchDb,
  upsertTranscriptChunks,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from '../storage/database.js'
import {
  rankTranscriptSession,
  selectStorySessions,
} from './story-selection.js'

function session(id: string, cwd: string): TranscriptSession {
  return {
    id,
    provider: 'codex',
    fileId: 'file',
    title: id,
    cwd,
    startedAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T11:00:00.000Z',
    messageCount: 4,
    metadata: {},
  }
}

function artifact(path: string): Artifact {
  return {
    kind: 'new-repo',
    path,
    name: path.split('/').at(-1) ?? path,
    firstChangeMs: Date.now(),
    lastChangeMs: Date.now(),
    detail: {},
  }
}

const strongText =
  '[user] The first build failed. Stop and compare the screenshots. [assistant] Created a new CLI and all 19 tests passed.'

test('rankTranscriptSession gives routine chats no story score', () => {
  const ranked = rankTranscriptSession(
    session('routine', '/tmp/routine'),
    [
      {
        redactedText: '[user] Rename this SEO crawler variable.',
        tokenEstimate: 20,
      },
    ],
    [],
    ['SEO'],
  )

  assert.equal(ranked.score, 0)
  assert.deepEqual(ranked.reasons, [])
})

test('selectStorySessions spreads its budget across projects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storymine-selection-'))
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
    const sessions = [
      session('a1', '/Users/me/dev/project-a'),
      session('a2', '/Users/me/dev/project-a'),
      session('b1', '/Users/me/dev/project-b'),
    ]
    for (const item of sessions) {
      upsertTranscriptSession(db, item)
      upsertTranscriptChunks(db, [
        {
          id: `chunk-${item.id}`,
          sessionId: item.id,
          provider: 'codex',
          sequence: 0,
          tokenEstimate: 50,
          textHash: `hash-${item.id}`,
          redactedText: strongText,
          redactionCount: 0,
          auditStatus: 'pending',
          metadata: {},
        },
      ])
    }

    const selected = selectStorySessions({
      days: 7,
      now: Date.parse('2026-07-19T12:00:00.000Z'),
      limit: 2,
      maxPerProject: 1,
      artifacts: [
        artifact('/Users/me/dev/project-a'),
        artifact('/Users/me/dev/project-b'),
      ],
      database: db,
    })

    assert.equal(selected.length, 2)
    assert.deepEqual(
      new Set(selected.map((entry) => entry.session.cwd)),
      new Set(['/Users/me/dev/project-a', '/Users/me/dev/project-b']),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
