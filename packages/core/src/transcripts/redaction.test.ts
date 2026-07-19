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

test('redactText removes usernames from home directory paths', () => {
  const result = redactText(
    'Read /Users/ian/dev/private/file.ts and C:\\Users\\ian\\repo\\notes.md',
  )

  assert.equal(result.count, 2)
  assert.equal(result.text, 'Read ~/dev/private/file.ts and ~\\repo\\notes.md')
})
