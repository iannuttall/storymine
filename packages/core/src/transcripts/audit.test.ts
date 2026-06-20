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
          quickTip:
            'Ask the AI to challenge its own plan before it writes code.',
          whyItWorks: 'The useful part is the correction loop.',
          mistakeToAvoid:
            'Letting a broad plan become implementation too soon.',
          betterMove:
            'Ask for a critique pass that finds weak assumptions first.',
          examplePrompt:
            'Before coding, list the risky assumptions in your plan and what would prove them wrong.',
          alphaType: 'course-correction',
          alphaScore: 0.9,
          category: 'prompting',
          confidence: 0.8,
          evidence: ['The user rejected a broad implementation.'],
        },
      ],
    }),
  )

  assert.equal(findings.length, 1)
  assert.equal(findings[0]?.category, 'prompting')
  assert.equal(
    findings[0]?.actionForAgent,
    'Ask for a critique pass that finds weak assumptions first.',
  )
  assert.equal(
    findings[0]?.examplePrompt,
    'Before coding, list the risky assumptions in your plan and what would prove them wrong.',
  )
  assert.equal(findings[0]?.alphaScore, 0.9)
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
  assert.match(prompt, /quickTip/)
  assert.match(prompt, /examplePrompt/)
  assert.match(prompt, /AI-usage alpha/)
  assert.match(prompt, /alphaScore/)
})

test('parseAuditResponse rejects low-alpha findings', () => {
  const findings = parseAuditResponse(
    JSON.stringify({
      findings: [
        {
          quickTip: 'Use an indexer for transcript processing.',
          whyItWorks: 'It is more scalable.',
          mistakeToAvoid: 'Processing too much data at once.',
          betterMove: 'Build an indexer.',
          examplePrompt: 'Build an indexer.',
          alphaType: 'verification-loop',
          alphaScore: 0.4,
          category: 'workflow',
          confidence: 0.9,
          evidence: ['The project used an indexer.'],
        },
      ],
    }),
  )

  assert.equal(findings.length, 0)
})

test('model interface supports deterministic fake adapters', async () => {
  const model: TranscriptAuditModel = {
    complete: async () =>
      JSON.stringify({
        findings: [
          {
            quickTip:
              'Ask the AI to justify copied patterns before accepting them.',
            whyItWorks: 'It catches cargo-culting from nearby examples.',
            mistakeToAvoid: 'Letting the AI copy sibling-project tooling.',
            betterMove:
              'Ask why the copied pattern fits this project and workflow.',
            examplePrompt:
              'Why does this pattern fit this repo instead of a simpler option?',
            alphaType: 'agent-failure',
            alphaScore: 0.85,
            category: 'agent-behaviour',
            confidence: 0.7,
            evidence: ['The AI copied build tooling from another project.'],
          },
        ],
      }),
  }

  const output = await model.complete('prompt')
  assert.equal(
    parseAuditResponse(output)[0]?.lesson,
    'Ask the AI to justify copied patterns before accepting them.',
  )
})

test('createCommandAuditModel times out slow commands', async () => {
  const model = createCommandAuditModel('node -e "setTimeout(()=>{}, 1000)"', {
    timeoutMs: 10,
  })

  await assert.rejects(() => model.complete('prompt'), /timed out/)
})
