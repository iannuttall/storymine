import assert from 'node:assert/strict'
import test from 'node:test'
import { renderCandidatesMarkdown } from './candidates.js'

test('renderCandidatesMarkdown produces agent-readable markdown', () => {
  const markdown = renderCandidatesMarkdown([
    {
      id: 'cand_1',
      source: 'transcript',
      signalId: null,
      name: 'Correct agent drift',
      url: null,
      oneLiner: 'Use review prompts to catch drift.',
      whyInteresting: 'This is reusable by non-coders.',
      tier: 'discovery',
      metrics: {},
      provenance: { category: 'prompting' },
      capturedAt: '2026-06-20T10:00:00.000Z',
      score: null,
      status: 'new',
    },
  ])

  assert.match(markdown, /Correct agent drift/)
  assert.match(markdown, /Use review prompts/)
})
