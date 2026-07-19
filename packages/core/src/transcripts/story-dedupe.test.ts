import assert from 'node:assert/strict'
import test from 'node:test'
import type { TranscriptFinding } from '../schemas.js'
import { areDuplicateStories, groupDuplicateStories } from './story-dedupe.js'

const audienceStory = story({
  id: 'audience-1',
  title: 'Made 292,136 X followers searchable without vectors',
  problem:
    'The X API pagination stopped before the complete audience of 292,136 follower profiles had been collected.',
  failed:
    'Repeated pagination requests returned partial pages and a vector database added unnecessary complexity.',
  move: 'Stored each fetched page durably, resumed missing ranges, and indexed normalized profiles with SQLite FTS5.',
  evidence:
    'The final SQLite database contained 292,136 profiles and returned ranked FTS5 searches.',
})

const repeatedAudienceStory = story({
  id: 'audience-2',
  title: 'Built a searchable 292,136-profile audience corpus',
  problem:
    'Pagination failures left a partial X audience instead of all 292,136 profiles.',
  failed:
    'Restarting API pagination lost progress, while vector search was excessive for profile keywords.',
  move: 'Checkpointed every page, resumed the missing ranges, then put normalized profiles into SQLite FTS5.',
  evidence:
    'SQLite held 292,136 profiles and produced ranked full-text results without vectors.',
})

const releaseStory = story({
  id: 'release-1',
  title: 'Released one CLI package from three workspaces',
  problem:
    'The CLI, core, and MCP workspaces could not be installed from one npm package.',
  failed:
    'Publishing each internal workspace exposed implementation packages and broken local dependency links.',
  move: 'Bundled the workspace clients into one public package while keeping internal packages private.',
  evidence:
    'A blank project installed the tarball and ran the CLI help command successfully.',
})

test('story dedupe collapses repeated evidence but keeps separate project stories', () => {
  assert.equal(areDuplicateStories(audienceStory, repeatedAudienceStory), true)
  assert.equal(areDuplicateStories(audienceStory, releaseStory), false)
  assert.deepEqual(
    groupDuplicateStories([
      audienceStory,
      repeatedAudienceStory,
      releaseStory,
    ]).map((group) => group.length),
    [2, 1],
  )
})

function story(input: {
  id: string
  title: string
  problem: string
  failed: string
  move: string
  evidence: string
}): TranscriptFinding {
  return {
    id: input.id,
    sessionId: `session-${input.id}`,
    chunkId: null,
    lesson: input.title,
    whyNonObvious: input.move,
    category: 'story',
    confidence: 0.9,
    evidence: [input.evidence],
    candidateId: null,
    capturedAt: '2026-07-19T12:00:00.000Z',
    metadata: {
      project: 'ilo',
      concreteProblem: input.problem,
      failedApproaches: input.failed,
      nonObviousMove: input.move,
      reusableRecipe: input.move,
      evidenceItWorked: input.evidence,
    },
  }
}
