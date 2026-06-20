import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { collectAppUsageSignals } from './app-usage.js'

const appleEpochOffsetSeconds = 978307200

test('collectAppUsageSignals groups app usage by hours', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-apps-'))
  const dbPath = join(dir, 'knowledge.db')
  try {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE ZOBJECT (
        ZSTREAMNAME TEXT,
        ZVALUESTRING TEXT,
        ZSTARTDATE REAL,
        ZENDDATE REAL
      );
    `)
    const nowUnix = Date.parse('2026-06-20T10:00:00.000Z') / 1000
    const nowApple = nowUnix - appleEpochOffsetSeconds
    const insert = db.prepare(
      `INSERT INTO ZOBJECT (
        ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE
      ) VALUES (?, ?, ?, ?)`,
    )
    insert.run('/app/usage', 'Codex', nowApple - 3600, nowApple)
    insert.run('/app/usage', 'Codex', nowApple - 7200, nowApple - 3600)
    insert.run('/app/usage', 'Chrome', nowApple - 1800, nowApple)
    insert.run('/other', 'Noise', nowApple - 1800, nowApple)
    db.close()

    const signals = collectAppUsageSignals({
      dbPath,
      days: 7,
      limit: 10,
      now: new Date('2026-06-20T10:00:00.000Z'),
    })

    assert.equal(signals.length, 2)
    assert.equal(signals[0]?.title, 'Codex')
    assert.equal(signals[0]?.metadata.hours, 2)
    assert.equal(signals[1]?.title, 'Chrome')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
