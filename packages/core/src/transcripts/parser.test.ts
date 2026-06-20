import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseTranscriptFile } from './parser.js'

test('parseTranscriptFile extracts codex messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-parser-'))
  const path = join(dir, 'codex.jsonl')
  try {
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-06-20T10:00:00.000Z',
          payload: { id: 'codex_1', cwd: '/tmp/project' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { role: 'assistant', content: [{ text: 'Use a store.' }] },
        }),
      ].join('\n'),
    )

    const parsed = parseTranscriptFile({
      provider: 'codex',
      path,
      fileId: 'file_1',
    })

    assert.equal(parsed.session.id, 'codex_1')
    assert.equal(parsed.messages.length, 1)
    assert.equal(parsed.messages[0]?.text, 'Use a store.')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseTranscriptFile extracts claude messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-parser-'))
  const path = join(dir, 'claude.jsonl')
  try {
    writeFileSync(
      path,
      JSON.stringify({
        type: 'user',
        sessionId: 'claude_1',
        cwd: '/tmp/project',
        timestamp: '2026-06-20T10:00:00.000Z',
        message: { role: 'user', content: 'Build this.' },
      }),
    )

    const parsed = parseTranscriptFile({
      provider: 'claude',
      path,
      fileId: 'file_1',
    })

    assert.equal(parsed.session.id, 'claude_1')
    assert.equal(parsed.messages[0]?.role, 'user')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
