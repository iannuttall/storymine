import assert from 'node:assert/strict'
import test from 'node:test'
import {
  candidateSchema,
  signalSchema,
  transcriptFindingSchema,
} from './schemas.js'

test('signal schema accepts normalized private signals', () => {
  const parsed = signalSchema.parse({
    id: 'sig_1',
    source: 'app-usage',
    signalType: 'app',
    title: 'Codex',
    summary: 'Heavy usage this week',
    capturedAt: '2026-06-20T10:00:00.000Z',
    privacyLevel: 'private',
    weight: 0.8,
    metadata: { hours: 7.2 },
  })

  assert.equal(parsed.source, 'app-usage')
  assert.equal(parsed.metadata.hours, 7.2)
})

test('candidate schema keeps newsletter fields explicit', () => {
  const parsed = candidateSchema.parse({
    id: 'cand_1',
    source: 'transcript',
    name: 'Prompt course correction',
    oneLiner: 'A lesson on correcting agent drift.',
    whyInteresting: 'It gives builders a reusable review pattern.',
    tier: 'discovery',
    capturedAt: '2026-06-20T10:00:00.000Z',
  })

  assert.equal(parsed.tier, 'discovery')
})

test('transcript finding schema requires evidence', () => {
  assert.throws(() =>
    transcriptFindingSchema.parse({
      id: 'finding_1',
      sessionId: 's1',
      lesson: 'Be specific',
      category: 'prompting',
      confidence: 0.7,
      evidence: [],
      capturedAt: '2026-06-20T10:00:00.000Z',
    }),
  )
})
