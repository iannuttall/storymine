import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  chromeTimeFromDate,
  collectChromeHistorySignals,
  isNoisyHistoryUrl,
} from './chrome-history.js'

test('isNoisyHistoryUrl filters local and dashboard URLs', () => {
  assert.equal(isNoisyHistoryUrl('http://localhost:3000'), true)
  assert.equal(isNoisyHistoryUrl('https://mail.google.com/mail/u/0'), true)
  assert.equal(isNoisyHistoryUrl('https://example.com/article'), false)
})

test('collectChromeHistorySignals copies and filters history rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-history-'))
  const historyPath = join(dir, 'History')
  try {
    const db = new Database(historyPath)
    db.exec(`
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT,
        title TEXT,
        visit_count INTEGER,
        typed_count INTEGER,
        last_visit_time INTEGER
      );
    `)
    const insert = db.prepare(
      `INSERT INTO urls (
        url, title, visit_count, typed_count, last_visit_time
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    const now = new Date('2026-06-20T10:00:00.000Z')
    insert.run(
      'https://example.com/useful-tool',
      'Useful Tool',
      8,
      1,
      chromeTimeFromDate(now),
    )
    insert.run(
      'http://localhost:8787',
      'Local App',
      50,
      5,
      chromeTimeFromDate(now),
    )
    insert.run(
      'https://old.example.com',
      'Old',
      1,
      0,
      chromeTimeFromDate(new Date('2026-05-01T10:00:00.000Z')),
    )
    db.close()

    const signals = collectChromeHistorySignals({
      historyPath,
      days: 7,
      limit: 10,
      now,
    })

    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.title, 'Useful Tool')
    assert.equal(signals[0]?.metadata.host, 'example.com')
    assert.equal(signals[0]?.metadata.visitCount, 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
