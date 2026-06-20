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
      provenance: {
        category: 'prompting',
        alphaType: 'course-correction',
        alphaScore: 0.9,
        actionForAgent: 'Ask the AI to critique the plan before coding.',
        mistakeToAvoid: 'Accepting broad implementation plans too quickly.',
        examplePrompt:
          'Before coding, critique this plan and list the assumptions.',
        reusableRule: 'Challenge broad agent changes before accepting them.',
        evidence: ['The user corrected the agent after it drifted.'],
      },
      capturedAt: '2026-06-20T10:00:00.000Z',
      score: null,
      status: 'new',
    },
  ])

  assert.match(markdown, /Correct agent drift/)
  assert.match(markdown, /Use review prompts/)
  assert.match(markdown, /Alpha type/)
  assert.match(markdown, /Alpha score/)
  assert.match(markdown, /Better move/)
  assert.match(markdown, /Ask the AI to critique/)
  assert.match(markdown, /Example prompt/)
})
