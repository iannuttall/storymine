import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from './index.js'

test('createServer constructs the research MCP server', () => {
  const server = createServer()
  assert.ok(server)
})
