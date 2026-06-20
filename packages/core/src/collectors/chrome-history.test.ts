import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  canonicalizeHistoryUrl,
  chromeTimeFromDate,
  collectChromeHistorySignals,
  isNoisyHistoryUrl,
} from './chrome-history.js'

test('isNoisyHistoryUrl filters local and dashboard URLs', () => {
  assert.equal(isNoisyHistoryUrl('http://localhost:3000'), true)
  assert.equal(isNoisyHistoryUrl('https://mail.google.com/mail/u/0'), true)
  assert.equal(isNoisyHistoryUrl('https://dashboard.stripe.com/'), true)
  assert.equal(isNoisyHistoryUrl('https://keep.md/settings'), true)
  assert.equal(isNoisyHistoryUrl('https://example.com/article'), false)
})

test('canonicalizeHistoryUrl removes tracking-only URL parts', () => {
  assert.equal(
    canonicalizeHistoryUrl('https://example.com/article/?utm_source=x#top'),
    'https://example.com/article',
  )
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
      'https://example.com/useful-tool?ref=one',
      'Useful Tool',
      8,
      1,
      chromeTimeFromDate(now),
    )
    insert.run(
      'https://example.com/useful-tool?ref=two',
      'Useful Tool Later',
      4,
      2,
      chromeTimeFromDate(new Date('2026-06-20T10:01:00.000Z')),
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
    assert.equal(signals[0]?.title, 'Useful Tool Later')
    assert.equal(signals[0]?.metadata.host, 'example.com')
    assert.equal(signals[0]?.metadata.visitCount, 12)
    assert.equal(signals[0]?.metadata.typedCount, 3)
    assert.equal(signals[0]?.url, 'https://example.com/useful-tool')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
