import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from './sqlite.js'

test('SQLite rows do not expose driver metadata', () => {
  const database = new Database(':memory:')
  database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')
  database.prepare('INSERT INTO items (name) VALUES (?)').run('first')

  assert.deepEqual(database.prepare('SELECT * FROM items').get(), {
    id: 1,
    name: 'first',
  })
  assert.deepEqual(database.prepare('SELECT * FROM items').all(), [
    { id: 1, name: 'first' },
  ])
  database.close()
})

test('SQLite read-only mode cannot change private source databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storymine-sqlite-readonly-'))
  const path = join(dir, 'source with spaces.db')
  try {
    const writable = new Database(path)
    writable.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)')
    writable.close()

    const readonly = new Database(path, {
      readonly: true,
      fileMustExist: true,
    })
    assert.deepEqual(
      readonly.prepare('SELECT COUNT(*) AS count FROM items').get(),
      {
        count: 0,
      },
    )
    assert.throws(
      () => readonly.prepare('INSERT INTO items DEFAULT VALUES').run(),
      /readonly/i,
    )
    readonly.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
