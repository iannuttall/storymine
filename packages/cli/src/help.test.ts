import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { test } = createRequire(import.meta.url)(
  'node:test',
) as typeof import('node:test')

test('research --help prints command help', () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.execPath,
    [join(distDir, 'index.js'), '--help'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /research/)
  assert.match(result.stdout, /me/)
  assert.match(result.stdout, /candidates/)
})

test('research me transcripts search --help prints search help', () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.execPath,
    [join(distDir, 'index.js'), 'me', 'transcripts', 'search', '--help'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Search parsed transcript chunks/)
  assert.match(result.stdout, /--query/)
})

test('research me transcripts export-corpus --help prints export help', () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.execPath,
    [join(distDir, 'index.js'), 'me', 'transcripts', 'export-corpus', '--help'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /semantic-ready markdown/)
  assert.match(result.stdout, /--output/)
})

test('research me transcripts audit --help prints selection filters', () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.execPath,
    [join(distDir, 'index.js'), 'me', 'transcripts', 'audit', '--help'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /--query/)
  assert.match(result.stdout, /--project/)
  assert.match(result.stdout, /--includeDuplicates/)
})

test('research findings review --help prints review help', () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.execPath,
    [join(distDir, 'index.js'), 'findings', 'review', '--help'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /List transcript findings/)
  assert.match(result.stdout, /--markdown/)
})
