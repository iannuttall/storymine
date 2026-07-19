import assert from 'node:assert/strict'
import test from 'node:test'
import type { Artifact } from '../artifacts/scan.js'
import type { SessionSummary, TranscriptFinding } from '../schemas.js'
import {
  isCompleteStoryFinding,
  rankStorySessions,
  storyProjectKey,
  validateStoryFields,
} from './story-ranking.js'

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 'session',
    provider: 'claude',
    cwd: null,
    title: null,
    summary: 'A session.',
    built: null,
    problems: null,
    failedApproaches: [],
    whatWorked: null,
    toolsCreated: [],
    opinions: [],
    model: null,
    chunkCount: 5,
    createdAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  }
}

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    kind: 'local-project',
    path: '/Users/me/dev/sandbox/png-to-svg',
    name: 'png-to-svg',
    firstChangeMs: null,
    lastChangeMs: Date.now(),
    detail: {},
    ...overrides,
  }
}

test('rankStorySessions boosts sessions that built a matched artifact', () => {
  const built = summary({
    sessionId: 'built',
    cwd: '/Users/me/dev/sandbox/png-to-svg',
    toolsCreated: ['png2svg CLI'],
  })
  const idle = summary({ sessionId: 'idle', cwd: '/Users/me/dev/other' })
  const ranked = rankStorySessions([idle, built], [artifact({})])
  assert.equal(ranked[0]?.summary.sessionId, 'built')
  assert.ok(ranked[0]?.matchedArtifacts.length === 1)
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0))
})

test('rankStorySessions does not rank empty fallback summaries', () => {
  const empty = summary({
    sessionId: 'empty',
    summary: 'No summary was produced for this session.',
    chunkCount: 20,
  })
  const ranked = rankStorySessions([empty], [artifact({})])

  assert.equal(ranked[0]?.score, 0)
  assert.deepEqual(ranked[0]?.reasons, [])
})

test('storyProjectKey groups worktrees with their real project', () => {
  assert.equal(
    storyProjectKey('/Users/me/conductor/workspaces/keep/lilongwe'),
    'keep',
  )
  assert.equal(storyProjectKey('/Users/me/.codex/worktrees/1234/seo'), 'seo')
})

test('rankStorySessions does not let skill count outrank a new project', () => {
  const skillHeavyRepo = Array.from({ length: 40 }, (_, index) =>
    artifact({
      kind: 'skill',
      path: `/Users/me/dev/cli/seo/skills/s${index}/SKILL.md`,
      name: `s${index}`,
    }),
  )
  const repoArtifact = artifact({
    kind: 'git-repo-active',
    path: '/Users/me/dev/cli/seo',
    name: 'seo',
  })
  const sandbox = artifact({})
  const seoSession = summary({
    sessionId: 'seo',
    cwd: '/Users/me/dev/cli/seo',
    toolsCreated: ['report engine'],
  })
  const sandboxSession = summary({
    sessionId: 'sandbox',
    cwd: '/Users/me/dev/sandbox/png-to-svg',
    toolsCreated: ['png2svg CLI'],
  })
  const ranked = rankStorySessions(
    [seoSession, sandboxSession],
    [repoArtifact, sandbox, ...skillHeavyRepo],
  )
  assert.equal(ranked[0]?.summary.sessionId, 'sandbox')
})

test('rankStorySessions flags opinions repeated across sessions', () => {
  const a = summary({
    sessionId: 'a',
    opinions: ['GPT-5.6 keeps overengineering everything unprompted'],
  })
  const b = summary({
    sessionId: 'b',
    opinions: ['the model overengineering habit wastes hours'],
  })
  const c = summary({
    sessionId: 'c',
    opinions: ['the onboarding copy should be simpler'],
  })
  const ranked = rankStorySessions([a, b, c], [])
  const byId = new Map(ranked.map((entry) => [entry.summary.sessionId, entry]))
  assert.ok((byId.get('a')?.repeatedOpinions.length ?? 0) > 0)
  assert.ok((byId.get('b')?.repeatedOpinions.length ?? 0) > 0)
  assert.equal(byId.get('c')?.repeatedOpinions.length, 0)
})

test('validateStoryFields requires five concrete fields', () => {
  const good = {
    concreteProblem:
      'The source /Users/me/s.png was a 960x838 antialiased logo with no SVG conic gradient primitive.',
    failedApproaches:
      'Naive tracing in trace.py produced path soup and threshold masks misread antialiasing.',
    nonObviousMove:
      'Measured the intended geometry with measure.py, fitting caps as circles instead of tracing pixels.',
    reusableRecipe:
      'Render with resvg-py, fit circles and shared slopes, then iterate using metrics.json comparisons.',
    evidence:
      'Reached 0.998 silhouette IoU and 0.21px mean edge distance across 370175 pixels.',
  }
  assert.equal(validateStoryFields(good).ok, true)

  const generic = {
    concreteProblem: 'The AI kept doing the wrong thing during the build.',
    failedApproaches: 'We tried a few things that did not work well.',
    nonObviousMove: 'Make the AI verify its work before continuing.',
    reusableRecipe: 'Write tests and review the output carefully every time.',
    evidence: 'It worked better afterwards.',
  }
  const result = validateStoryFields(generic)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.length > 0)
})

test('isCompleteStoryFinding rejects a story finding missing fields', () => {
  const base: TranscriptFinding = {
    id: 'finding',
    sessionId: 'session',
    chunkId: null,
    lesson: 'A story',
    whyNonObvious: null,
    category: 'story',
    confidence: 0.9,
    evidence: ['some evidence'],
    candidateId: null,
    capturedAt: new Date().toISOString(),
    metadata: {
      concreteProblem: 'short',
      failedApproaches: 'short',
      nonObviousMove: 'short',
      reusableRecipe: 'short',
      evidenceItWorked: 'short',
    },
  }
  assert.equal(isCompleteStoryFinding(base), false)

  const nonStory: TranscriptFinding = { ...base, category: 'prompting' }
  assert.equal(isCompleteStoryFinding(nonStory), true)
})
