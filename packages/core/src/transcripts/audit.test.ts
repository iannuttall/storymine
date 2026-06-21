import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  openResearchDb,
  upsertTranscriptChunks,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from '../storage/database.js'
import {
  auditPromptForChunk,
  createCommandAuditModel,
  parseAuditResponse,
  selectTranscriptChunksForAudit,
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
          plainEnglishWhy:
            'It makes the AI slow down and check weak assumptions before doing expensive work.',
          mistakeToAvoid:
            'Letting a broad plan become implementation too soon.',
          betterMove:
            'Ask for a critique pass that finds weak assumptions first.',
          examplePrompt:
            'Before coding, list the risky assumptions in your plan and what would prove them wrong.',
          alphaType: 'course-correction',
          interventionType: 'pushback',
          skillPotential: 'workflow',
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
  assert.equal(findings[0]?.interventionType, 'pushback')
  assert.equal(
    findings[0]?.plainEnglishWhy,
    'It makes the AI slow down and check weak assumptions before doing expensive work.',
  )
  assert.equal(findings[0]?.skillPotential, 'workflow')
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
  assert.match(prompt, /prompting alpha/)
  assert.match(prompt, /alphaScore/)
  assert.match(prompt, /human intervention moments/)
  assert.match(prompt, /interventionType/)
  assert.match(prompt, /plainEnglishWhy/)
  assert.match(prompt, /skillPotential/)
  assert.match(prompt, /pushed back/)
  assert.match(prompt, /smart beginners/)
  assert.match(prompt, /slogans/)
  assert.match(prompt, /one task at a time/)
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

test('parseAuditResponse rejects AI-smell quick tips', () => {
  const findings = parseAuditResponse(
    JSON.stringify({
      findings: [
        modelFinding(
          'Turn a recommendation into an execution loop, not a wishlist.',
        ),
        modelFinding(
          'Before an AI rebuilds anything, make it produce a feature parity plan.',
        ),
        modelFinding(
          'Ask AI to compare against the old system: then write the plan.',
        ),
        modelFinding(
          'Ask AI to produce a greenfield plan before it writes code.',
        ),
        modelFinding('Give agents a finish line, not just a task list.'),
        modelFinding(
          'After an agent changes infra config, ask whether the fix is local, committed, and complete.',
        ),
        modelFinding(
          'Ask AI to batch API calls and make the process idempotent.',
        ),
        modelFinding(
          'Use a verified first implementation as the spec for the second one.',
        ),
      ],
    }),
  )

  assert.equal(findings.length, 0)
})

function modelFinding(quickTip: string): Record<string, unknown> {
  return {
    quickTip,
    whyItWorks: 'It names a reusable prompting move.',
    plainEnglishWhy:
      'It makes the agent do clearer work that another person can check.',
    mistakeToAvoid: 'Accepting vague model output.',
    betterMove: 'Ask for the concrete next action and verification step.',
    examplePrompt:
      'Turn this into a checklist with one task, one test step, and one commit per item.',
    alphaType: 'scope-control',
    interventionType: 'steer',
    skillPotential: 'workflow',
    alphaScore: 0.9,
    category: 'prompting',
    confidence: 0.9,
    evidence: ['The user asked for a clearer execution loop.'],
  }
}

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

test('selectTranscriptChunksForAudit filters and dedupes chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-audit-select-'))
  try {
    const db = openResearchDb(join(dir, 'test.db'))
    seedAuditSelectionTranscript(db, dir)

    const selected = selectTranscriptChunksForAudit(
      {
        query: 'inspect screen',
        project: 'tidechecker',
        limit: 10,
      },
      db,
    )

    assert.deepEqual(
      selected.map((chunk) => chunk.id),
      ['chunk_1'],
    )

    const withDuplicates = selectTranscriptChunksForAudit(
      {
        query: 'inspect screen',
        project: 'tidechecker',
        limit: 10,
        includeDuplicates: true,
      },
      db,
    )

    assert.deepEqual(
      withDuplicates.map((chunk) => chunk.id),
      ['chunk_1', 'chunk_2'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function seedAuditSelectionTranscript(
  db: ReturnType<typeof openResearchDb>,
  dir: string,
): void {
  upsertTranscriptFiles(db, [
    {
      id: 'file_1',
      provider: 'codex',
      path: join(dir, 'session.jsonl'),
      sizeBytes: 12,
      modifiedAtMs: 1234,
      hash: 'hash_1',
      indexedAt: '2026-06-20T10:00:00.000Z',
      status: 'indexed',
      error: null,
    },
  ])
  upsertTranscriptSession(db, {
    id: 'session_1',
    provider: 'codex',
    fileId: 'file_1',
    title: 'Tidechecker web',
    cwd: '/Users/iannuttall/dev/apps/tidechecker-web',
    startedAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-20T11:00:00.000Z',
    messageCount: 3,
    metadata: {},
  })
  upsertTranscriptChunks(db, [
    {
      id: 'chunk_1',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 0,
      tokenEstimate: 20,
      textHash: 'same_hash',
      redactedText:
        '[user] Inspect screen output before rewriting generic copy.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
    {
      id: 'chunk_2',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 1,
      tokenEstimate: 20,
      textHash: 'same_hash',
      redactedText:
        '[user] Inspect screen output before rewriting generic copy.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
    {
      id: 'chunk_3',
      sessionId: 'session_1',
      provider: 'codex',
      sequence: 2,
      tokenEstimate: 20,
      textHash: 'other_hash',
      redactedText: '[user] Build unrelated output.',
      redactionCount: 0,
      auditStatus: 'pending',
      metadata: {},
    },
  ])
}
