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
          payload: {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'Do hidden setup.' }],
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Duplicate event.' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '# AGENTS.md instructions\n<environment_context />',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<skill>noise</skill>' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '<subagent_notification>{}</subagent_notification>',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Build this.' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'Running checks.' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Use a store.' }],
          },
        }),
      ].join('\n'),
    )

    const parsed = parseTranscriptFile({
      provider: 'codex',
      path,
      fileId: 'file_1',
    })

    assert.equal(parsed.session.id, 'codex_1')
    assert.deepEqual(
      parsed.messages.map((message) => [message.role, message.text]),
      [
        ['user', 'Build this.'],
        ['assistant', 'Use a store.'],
      ],
    )
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
