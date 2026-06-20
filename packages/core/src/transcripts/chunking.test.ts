import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkTranscriptMessages } from './chunking.js'

test('chunkTranscriptMessages redacts and chunks transcript text', () => {
  const chunks = chunkTranscriptMessages({
    provider: 'codex',
    sessionId: 'session_1',
    messages: [
      {
        role: 'user',
        text: 'Here is OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnopqrstuvwxyz',
      },
      {
        role: 'assistant',
        text: 'Use process env instead.',
      },
    ],
    maxTokens: 20,
  })

  assert.ok(chunks.length >= 1)
  assert.match(chunks[0]?.redactedText ?? '', /\[REDACTED_SECRET\]/)
  assert.ok((chunks[0]?.redactionCount ?? 0) > 0)
})
