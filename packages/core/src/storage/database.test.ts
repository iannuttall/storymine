import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  completeSourceRun,
  createSourceRun,
  getStorageStats,
  insertSignals,
  listSignals,
  openResearchDb,
} from './database.js'

test('database stores source runs and signals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-db-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    const run = createSourceRun(db, {
      source: 'app-usage',
      command: 'research me apps',
      options: { days: 7 },
    })

    insertSignals(db, [
      {
        id: 'sig_test',
        runId: run.id,
        source: 'app-usage',
        signalType: 'app',
        title: 'Codex',
        url: null,
        summary: 'Heavy usage',
        capturedAt: '2026-06-20T10:00:00.000Z',
        privacyLevel: 'private',
        weight: 0.7,
        metadata: { hours: 4.5 },
      },
    ])
    completeSourceRun(db, run.id, { status: 'completed', itemCount: 1 })

    const signals = listSignals(db, { source: 'app-usage' })
    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.title, 'Codex')

    const stats = getStorageStats(db, join(dir, 'test.db'))
    assert.equal(stats.counts.sourceRuns, 1)
    assert.equal(stats.counts.signals, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
