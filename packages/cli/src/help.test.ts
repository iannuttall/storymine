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
