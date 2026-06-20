import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditPromptForChunk,
  createCommandAuditModel,
  parseAuditResponse,
  type TranscriptAuditModel,
} from './audit.js'

test('parseAuditResponse validates model JSON findings', () => {
  const findings = parseAuditResponse(
    JSON.stringify({
      findings: [
        {
          lesson: 'Use review prompts to catch agent drift.',
          whyNonObvious: 'The useful part is the correction loop.',
          category: 'prompting',
          confidence: 0.8,
          actionForAgent:
            'Ask for a review pass that challenges the implementation.',
          reusableRule:
            'Run a critique pass before accepting broad agent changes.',
          evidence: ['The user rejected a broad implementation.'],
        },
      ],
    }),
  )

  assert.equal(findings.length, 1)
  assert.equal(findings[0]?.category, 'prompting')
  assert.equal(
    findings[0]?.actionForAgent,
    'Ask for a review pass that challenges the implementation.',
  )
})

test('auditPromptForChunk includes redaction contract', () => {
  const prompt = auditPromptForChunk({
    id: 'chunk_1',
    sessionId: 'session_1',
    provider: 'codex',
    sequence: 0,
    tokenEstimate: 100,
    textHash: 'hash',
    redactedText: '[user] Build this',
    redactionCount: 0,
    auditStatus: 'pending',
    metadata: {},
  })

  assert.match(prompt, /Return JSON only/)
  assert.match(prompt, /redacted transcript chunk/)
  assert.match(prompt, /actionForAgent/)
  assert.match(prompt, /Reject generic lessons/)
})

test('model interface supports deterministic fake adapters', async () => {
  const model: TranscriptAuditModel = {
    complete: async () =>
      JSON.stringify({
        findings: [
          {
            lesson: 'Keep CLI wrappers thin.',
            category: 'workflow',
            confidence: 0.7,
            actionForAgent:
              'Put shared behavior in core and keep clients as wrappers.',
            evidence: ['Core owned the behavior.'],
          },
        ],
      }),
  }

  const output = await model.complete('prompt')
  assert.equal(parseAuditResponse(output)[0]?.lesson, 'Keep CLI wrappers thin.')
})

test('createCommandAuditModel times out slow commands', async () => {
  const model = createCommandAuditModel('node -e "setTimeout(()=>{}, 1000)"', {
    timeoutMs: 10,
  })

  await assert.rejects(() => model.complete('prompt'), /timed out/)
})
