import type { TranscriptFinding } from '../schemas.js'
import { storyFieldsFromMetadata } from './story-ranking.js'

const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'also',
  'been',
  'before',
  'being',
  'built',
  'could',
  'despite',
  'each',
  'every',
  'from',
  'have',
  'into',
  'made',
  'more',
  'only',
  'other',
  'over',
  'same',
  'than',
  'that',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'through',
  'using',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'without',
  'would',
])

export function areDuplicateStories(
  left: TranscriptFinding,
  right: TranscriptFinding,
): boolean {
  if (left.id === right.id) return true
  if (left.category !== 'story' || right.category !== 'story') return false

  const leftProject = projectKey(left)
  const rightProject = projectKey(right)
  const sameProject =
    leftProject !== null &&
    rightProject !== null &&
    leftProject === rightProject
  const leftTitle = tokens(left.lesson)
  const rightTitle = tokens(right.lesson)
  const leftBody = storyTokens(left)
  const rightBody = storyTokens(right)
  const titleJaccard = jaccard(leftTitle, rightTitle)
  const bodyJaccard = jaccard(leftBody, rightBody)
  const bodyContainment = containment(leftBody, rightBody)
  const sharedBodyTokens = intersectionSize(leftBody, rightBody)
  const sharedNumber = [...leftBody].some(
    (token) => /^\d{2,}$/.test(token) && rightBody.has(token),
  )

  if (!sameProject) {
    return titleJaccard >= 0.65 && bodyJaccard >= 0.6
  }
  if (titleJaccard >= 0.4 && bodyContainment >= 0.5) return true
  if (bodyJaccard >= 0.5 && sharedBodyTokens >= 8) return true
  return sharedNumber && bodyContainment >= 0.42 && sharedBodyTokens >= 6
}

export function groupDuplicateStories(
  findings: TranscriptFinding[],
): TranscriptFinding[][] {
  const groups: TranscriptFinding[][] = []
  for (const finding of findings) {
    const group = groups.find((items) =>
      items.some((item) => areDuplicateStories(item, finding)),
    )
    if (group) group.push(finding)
    else groups.push([finding])
  }
  return groups
}

function storyTokens(finding: TranscriptFinding): Set<string> {
  const fields = storyFieldsFromMetadata(finding.metadata)
  return tokens(
    [
      finding.lesson,
      fields.concreteProblem,
      fields.failedApproaches,
      fields.nonObviousMove,
      fields.evidence,
    ].join(' '),
  )
}

function tokens(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
  return new Set(
    normalized
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 3 && !STOP_WORDS.has(token) && !/^\d$/.test(token),
      ),
  )
}

function projectKey(finding: TranscriptFinding): string | null {
  const project = finding.metadata.project
  return typeof project === 'string' && project.trim()
    ? project.trim().toLowerCase()
    : null
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0
  for (const token of left) if (right.has(token)) count += 1
  return count
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  const intersection = intersectionSize(left, right)
  return intersection / (left.size + right.size - intersection)
}

function containment(left: Set<string>, right: Set<string>): number {
  const smallest = Math.min(left.size, right.size)
  if (smallest === 0) return 0
  return intersectionSize(left, right) / smallest
}
