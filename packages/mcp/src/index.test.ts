import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from './index.js'

const { test } = createRequire(import.meta.url)(
  'node:test',
) as typeof import('node:test')

test('createServer constructs the research MCP server', () => {
  const server = createServer()
  assert.ok(server)
})
