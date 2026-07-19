import type Database from 'better-sqlite3'
import {
  type Artifact,
  type ArtifactKind,
  classifyArtifactTopics,
} from '../artifacts/scan.js'
import { topicsOf } from '../artifacts/work.js'
import type { TranscriptSession } from '../schemas.js'
import {
  getDb,
  hasSessionSummary,
  listChunksForSession,
  listTranscriptSessionsInWindow,
} from '../storage/database.js'
import { artifactMatchesSession, storyProjectKey } from './story-ranking.js'

export interface RankedTranscriptSession {
  session: TranscriptSession
  score: number
  reasons: string[]
}

export interface SelectStorySessionsOptions {
  days?: number
  now?: number
  project?: string
  provider?: 'claude' | 'codex'
  limit?: number
  maxPerProject?: number
  includeSummarized?: boolean
  artifacts?: Artifact[]
  topics?: string[]
  database?: Database.Database
}

const FRICTION =
  /<turn_aborted>|\bno no\b|\bstop\b|\bwrong\b|\brevert\b|\bundo\b|why (?:did|are|would) you|too (?:much|far)|over the top|overboard|overengineer|didn'?t ask|unprompted/i
const FAILURE =
  /\b(?:fail(?:ed|ing)?|didn'?t work|doesn'?t work|broke|broken|stuck|error|crash|regress|abandon|wrong)\b/i
const CREATION =
  /\b(?:built|created|shipped|launched|new (?:tool|cli|skill|script|app|package)|turned .{0,30} into)\b/i
const EVIDENCE =
  /\b(?:tests? pass(?:ed|ing)?|build pass(?:ed|ing)?|verified|benchmark|metric|screenshot|shipped|published|released|\d+(?:\.\d+)?%|\d+(?:\.\d+)?px)\b/i

const ARTIFACT_SCORE: Record<ArtifactKind, number> = {
  'new-repo': 6,
  'local-project': 6,
  skill: 4.5,
  'git-repo-active': 3.5,
}

export function selectStorySessions(
  options: SelectStorySessionsOptions = {},
): RankedTranscriptSession[] {
  const database = options.database ?? getDb()
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  const maxPerProject = Math.max(1, Math.min(options.maxPerProject ?? 3, 10))
  const sessions = listTranscriptSessionsInWindow(database, {
    sinceMs: now - days * 86_400_000,
    ...(options.project ? { project: options.project } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    limit: 5000,
  })
  const artifacts = options.artifacts ?? []
  const ranked = sessions
    .filter(
      (session) =>
        options.includeSummarized || !hasSessionSummary(database, session.id),
    )
    .map((session) =>
      rankTranscriptSession(
        session,
        listChunksForSession(database, session.id),
        artifacts,
        options.topics ?? [],
      ),
    )
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        sessionTime(right.session) - sessionTime(left.session) ||
        left.session.id.localeCompare(right.session.id),
    )

  const selected: RankedTranscriptSession[] = []
  const perProject = new Map<string, number>()
  for (const entry of ranked) {
    if (selected.length >= limit) break
    const key = storyProjectKey(entry.session.cwd)
    const used = perProject.get(key) ?? 0
    if (used >= maxPerProject) continue
    perProject.set(key, used + 1)
    selected.push(entry)
  }
  return selected
}

export function rankTranscriptSession(
  session: TranscriptSession,
  chunks: Array<{ redactedText: string; tokenEstimate: number }>,
  artifacts: Artifact[],
  interests: string[] = [],
): RankedTranscriptSession {
  const reasons: string[] = []
  let score = 0

  const matched = artifacts.filter((artifact) =>
    artifactMatchesSession(artifact, session.cwd),
  )
  if (matched.length > 0) {
    score += Math.max(...matched.map((item) => ARTIFACT_SCORE[item.kind]))
    reasons.push('recent work artifact')
    const topicMatches = [
      ...new Set(
        matched.flatMap((artifact) =>
          topicsOf(artifact).map((topic) => topic.topic),
        ),
      ),
    ]
    if (topicMatches.length > 0) {
      score += 1 + Math.min(topicMatches.length - 1, 2) * 0.25
      reasons.push(`preferred topic: ${topicMatches.join(', ')}`)
    }
  }

  let friction = 0
  let failures = 0
  let creation = 0
  let evidence = 0
  for (const chunk of chunks) {
    const text = chunk.redactedText
    if (text.includes('[user]') && FRICTION.test(text)) friction += 1
    if (FAILURE.test(text)) failures += 1
    if (CREATION.test(text)) creation += 1
    if (EVIDENCE.test(text)) evidence += 1
  }
  const topicMatches = classifyArtifactTopics(
    chunks.map((chunk) => chunk.redactedText),
    interests,
  )
  if (score > 0 && topicMatches.length > 0) {
    score += 1 + Math.min(topicMatches.length - 1, 2) * 0.25
    reasons.push(
      `preferred topic: ${topicMatches.map((topic) => topic.topic).join(', ')}`,
    )
  }
  if (friction > 0) {
    score += 1.5 + Math.min(friction, 3) * 0.75
    reasons.push('human correction or pushback')
  }
  if (failures > 0 && evidence > 0) {
    score += 2.5
    reasons.push('failure then evidence of progress')
  }
  if (creation > 0) {
    score += 1.5
    reasons.push('something concrete was built')
  }
  if (evidence > 0) {
    score += 1
    reasons.push('tests, metrics, or shipping evidence')
  }
  if (score > 0) score += Math.min(chunks.length, 20) * 0.02

  return { session, score: Number(score.toFixed(3)), reasons }
}

function sessionTime(session: TranscriptSession): number {
  return Date.parse(session.updatedAt ?? session.startedAt ?? '') || 0
}
