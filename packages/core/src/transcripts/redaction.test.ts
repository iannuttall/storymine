import assert from 'node:assert/strict'
import test from 'node:test'
import { redactText } from './redaction.js'

test('redactText removes obvious secrets and emails', () => {
  const result = redactText(
    'email ian@example.com and token OPENAI_API_KEY=sk-proj-abcdef1234567890',
  )

  assert.equal(result.count, 2)
  assert.match(result.text, /\[REDACTED_EMAIL\]/)
  assert.match(result.text, /\[REDACTED_SECRET\]/)
})
