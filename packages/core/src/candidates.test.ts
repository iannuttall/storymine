import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  listStoredCandidates,
  promoteTranscriptFindings,
  renderCandidatesMarkdown,
} from './candidates.js'
import { resetResearchPathsForTests } from './paths.js'
import {
  closeDbForTests,
  getDb,
  insertTranscriptFindings,
  upsertTranscriptChunks,
  upsertTranscriptFiles,
  upsertTranscriptSession,
} from './storage/database.js'

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

test('promoteTranscriptFindings clusters semantic repeats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-candidates-'))
  const previousCache = process.env.RESEARCH_CACHE_DIR
  try {
    closeDbForTests()
    resetResearchPathsForTests()
    process.env.RESEARCH_CACHE_DIR = dir
    const db = getDb()
    upsertTranscriptFiles(db, [
      {
        id: 'file_1',
        provider: 'claude',
        path: join(dir, 'session.jsonl'),
        sizeBytes: 1,
        modifiedAtMs: 1,
        hash: 'hash',
        indexedAt: null,
        status: 'indexed',
        error: null,
      },
    ])
    upsertTranscriptSession(db, {
      id: 'session_1',
      provider: 'claude',
      fileId: 'file_1',
      title: 'Session',
      cwd: null,
      startedAt: null,
      updatedAt: null,
      messageCount: 1,
      metadata: {},
    })
    upsertTranscriptChunks(db, [
      {
        id: 'chunk_1',
        sessionId: 'session_1',
        provider: 'claude',
        sequence: 0,
        tokenEstimate: 100,
        textHash: 'hash_1',
        redactedText: '[user] Rewrite this',
        redactionCount: 0,
        auditStatus: 'audited',
        metadata: {},
      },
    ])
    insertTranscriptFindings(db, [
      {
        id: 'finding_1',
        sessionId: 'session_1',
        chunkId: 'chunk_1',
        lesson:
          "Don't tell AI to sound human; give it a concrete ban list of AI tells.",
        whyNonObvious:
          'A concrete ban list gives the model checkable patterns.',
        category: 'prompting',
        confidence: 0.8,
        evidence: ['The user listed banned AI writing tells.'],
        candidateId: null,
        capturedAt: '2026-06-20T10:00:00.000Z',
        metadata: {
          alphaType: 'prompt-pattern',
          alphaScore: 0.84,
          mistakeToAvoid: 'Asking for less robotic writing.',
          examplePrompt: 'Ban em dashes and rule-of-three intros.',
        },
      },
      {
        id: 'finding_2',
        sessionId: 'session_1',
        chunkId: 'chunk_1',
        lesson:
          'To strip robot tone, hand AI a named list of model fingerprints to remove.',
        whyNonObvious:
          'Specific tells beat vague feedback like make it natural.',
        category: 'prompting',
        confidence: 0.9,
        evidence: ['The checklist included exact phrases to grep.'],
        candidateId: null,
        capturedAt: '2026-06-20T10:01:00.000Z',
        metadata: {
          alphaType: 'prompt-pattern',
          alphaScore: 0.85,
          mistakeToAvoid: 'Saying make this sound human.',
          examplePrompt: 'Scan for AI tells and list what changed.',
        },
      },
      {
        id: 'finding_3',
        sessionId: 'session_1',
        chunkId: 'chunk_1',
        lesson:
          "When examples are illustrative, tell AI they aren't the full spec.",
        whyNonObvious:
          'Models overfit to the concrete examples unless told to explore.',
        category: 'prompting',
        confidence: 0.85,
        evidence: ['The AI ran with three examples and skipped discovery.'],
        candidateId: null,
        capturedAt: '2026-06-20T10:02:00.000Z',
        metadata: {
          alphaType: 'course-correction',
          alphaScore: 0.82,
          mistakeToAvoid: 'Letting examples become the whole task.',
          examplePrompt:
            'These examples are illustrative; inspect the source first.',
        },
      },
    ])

    const result = promoteTranscriptFindings({
      minConfidence: 0.7,
      limit: 10,
    })
    const candidates = listStoredCandidates({ limit: 10 })

    assert.equal(result.promoted, 2)
    assert.equal(candidates.length, 2)
    const writingCandidate = candidates.find((candidate) =>
      candidate.oneLiner.includes('robot'),
    )
    assert.ok(writingCandidate)
    assert.equal(writingCandidate.provenance.duplicateCount, 2)
    assert.deepEqual(writingCandidate.provenance.mergedFindingIds, [
      'finding_2',
      'finding_1',
    ])
    assert.deepEqual(writingCandidate.provenance.evidence, [
      'The checklist included exact phrases to grep.',
      'The user listed banned AI writing tells.',
    ])
  } finally {
    closeDbForTests()
    if (previousCache === undefined) {
      delete process.env.RESEARCH_CACHE_DIR
    } else {
      process.env.RESEARCH_CACHE_DIR = previousCache
    }
    resetResearchPathsForTests()
    rmSync(dir, { recursive: true, force: true })
  }
})
