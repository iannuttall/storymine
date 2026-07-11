import { basename } from 'node:path'
import type { Artifact, ArtifactKind } from '../artifacts/scan.js'
import type { SessionSummary, TranscriptFinding } from '../schemas.js'

export interface RankedStorySession {
  summary: SessionSummary
  score: number
  reasons: string[]
  matchedArtifacts: Artifact[]
  repeatedOpinions: string[]
}

export interface StoryFields {
  concreteProblem: string
  failedApproaches: string
  nonObviousMove: string
  reusableRecipe: string
  evidence: string
}

export interface StoryValidation {
  ok: boolean
  reasons: string[]
}

const FAILURE_LANGUAGE =
  /\b(fail(ed|s|ing)?|didn'?t work|broke|couldn'?t|gave up|stuck|wrong|error|crash|hallucinat|regress|abandon)\b/i

const GENERIC_TELLS = [
  'make the ai verify',
  'verify its work',
  'write tests',
  'be clear',
  'review the output',
  'double check',
  'think step by step',
  'fence off the spec',
]

const TOOL_WORDS = [
  'git',
  'npm',
  'pnpm',
  'codex',
  'claude',
  'svg',
  'png',
  'sqlite',
  'ffmpeg',
  'docker',
  'astro',
  'wrangler',
  'python',
  'node',
  'bun',
  'cargo',
  'curl',
  'sql',
  'regex',
  'json',
  'cli',
  'api',
]

const OPINION_STOP = new Set([
  'that',
  'this',
  'with',
  'from',
  'have',
  'keeps',
  'keep',
  'when',
  'what',
  'code',
  'time',
  'like',
  'just',
  'over',
  'into',
  'they',
  'them',
  'about',
  'again',
  'still',
  'really',
  'thing',
  'things',
  'model',
])

export function rankStorySessions(
  summaries: SessionSummary[],
  artifacts: Artifact[],
): RankedStorySession[] {
  const repeatedTokens = repeatedOpinionTokens(summaries)
  const ranked = summaries.map((summary) => {
    const reasons: string[] = []
    let score = 0

    const matchedArtifacts = artifacts.filter((artifact) =>
      artifactMatchesSession(artifact, summary.cwd),
    )
    if (matchedArtifacts.length > 0) {
      score += artifactBoost(matchedArtifacts)
      reasons.push(
        `built artifact: ${describeMatchedArtifacts(matchedArtifacts)}`,
      )
    }

    if (summary.toolsCreated.length > 0) {
      score += 1 + Math.min(summary.toolsCreated.length, 4) * 0.25
      reasons.push(`created ${summary.toolsCreated.length} tool(s)`)
    }

    if (hasFailureBreakthrough(summary)) {
      score += 2
      reasons.push('failure then breakthrough arc')
    }

    const repeatedOpinions = summary.opinions.filter((opinion) =>
      opinionHasRepeatedToken(opinion, repeatedTokens),
    )
    if (repeatedOpinions.length > 0) {
      score += 2 + Math.min(repeatedOpinions.length - 1, 2) * 0.5
      reasons.push('repeated opinion across sessions')
    }

    const friction = frictionEntries(summary)
    if (friction.length > 0) {
      score += 1.5 + Math.min(friction.length - 1, 2) * 0.5
      reasons.push('human pushback / unrequested AI work')
    }

    score += Math.min(summary.chunkCount, 20) * 0.02

    return {
      summary,
      score: Number(score.toFixed(3)),
      reasons,
      matchedArtifacts,
      repeatedOpinions,
    }
  })
  return ranked.sort((a, b) => b.score - a.score)
}

const KIND_BASE: Record<ArtifactKind, number> = {
  'new-repo': 5,
  'sandbox-project': 5,
  skill: 3.5,
  'git-repo-active': 3,
}

// Score by the strongest matched artifact kind, not by artifact count. A
// pre-existing repo with dozens of skill files must not outrank a brand-new
// sandbox project or repo built this week.
function artifactBoost(matched: Artifact[]): number {
  const kinds = new Set(matched.map((artifact) => artifact.kind))
  let boost = 0
  for (const kind of kinds) boost = Math.max(boost, KIND_BASE[kind])
  const bestIsSkill = boost === KIND_BASE.skill
  if (kinds.has('skill') && !bestIsSkill) boost += 0.5
  return boost
}

function describeMatchedArtifacts(matched: Artifact[]): string {
  const counts = new Map<ArtifactKind, number>()
  for (const artifact of matched) {
    counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([kind, count]) => (count > 1 ? `${kind} x${count}` : kind))
    .join(', ')
}

export function frictionEntries(summary: SessionSummary): string[] {
  const value = summary.metadata?.friction
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function artifactMatchesSession(
  artifact: Artifact,
  cwd: string | null,
): boolean {
  if (!cwd) return false
  const a = artifact.path.toLowerCase().replace(/\/+$/, '')
  const c = cwd.toLowerCase().replace(/\/+$/, '')
  if (!a || !c) return false
  if (a === c) return true
  if (c.startsWith(`${a}/`) || a.startsWith(`${c}/`)) return true
  return basename(a) === basename(c) && basename(a).length >= 3
}

function hasFailureBreakthrough(summary: SessionSummary): boolean {
  const hasFailure =
    summary.failedApproaches.length > 0 ||
    (summary.problems !== null && FAILURE_LANGUAGE.test(summary.problems))
  const hasWin =
    (summary.whatWorked !== null && summary.whatWorked.trim().length > 0) ||
    summary.toolsCreated.length > 0
  return hasFailure && hasWin
}

function repeatedOpinionTokens(summaries: SessionSummary[]): Set<string> {
  const tokenSessions = new Map<string, Set<string>>()
  for (const summary of summaries) {
    const tokens = new Set<string>()
    for (const opinion of summary.opinions) {
      for (const token of opinionTokens(opinion)) tokens.add(token)
    }
    for (const token of tokens) {
      const set = tokenSessions.get(token) ?? new Set<string>()
      set.add(summary.sessionId)
      tokenSessions.set(token, set)
    }
  }
  const repeated = new Set<string>()
  for (const [token, sessions] of tokenSessions) {
    if (sessions.size >= 2) repeated.add(token)
  }
  return repeated
}

function opinionHasRepeatedToken(
  opinion: string,
  repeated: Set<string>,
): boolean {
  return opinionTokens(opinion).some((token) => repeated.has(token))
}

function opinionTokens(opinion: string): string[] {
  const tokens = new Set<string>()
  for (const raw of opinion.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    if (/\d/.test(raw) && raw.length >= 2) {
      tokens.add(raw)
      continue
    }
    if (raw.length >= 4 && !OPINION_STOP.has(raw)) tokens.add(raw)
  }
  return [...tokens]
}

export function validateStoryFields(fields: StoryFields): StoryValidation {
  const reasons: string[] = []
  const checks: Array<[keyof StoryFields, number]> = [
    ['concreteProblem', 40],
    ['failedApproaches', 30],
    ['nonObviousMove', 40],
    ['reusableRecipe', 40],
    ['evidence', 20],
  ]
  for (const [field, min] of checks) {
    const value = (fields[field] ?? '').trim()
    if (value.length < min) {
      reasons.push(`${field} too short (${value.length} < ${min})`)
    }
  }
  const combined = Object.values(fields).join(' ').toLowerCase()
  if (!referencesConcreteArtifact(combined)) {
    reasons.push('no concrete file, command, or tool referenced')
  }
  for (const tell of GENERIC_TELLS) {
    if (combined.includes(tell)) {
      reasons.push(`generic advice detected: "${tell}"`)
      break
    }
  }
  return { ok: reasons.length === 0, reasons }
}

function referencesConcreteArtifact(text: string): boolean {
  if (/`[^`]+`/.test(text)) return true
  if (/\/[a-z0-9._-]+/i.test(text)) return true
  if (/\b[a-z0-9._-]+\.[a-z]{1,6}\b/i.test(text)) return true
  return TOOL_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text))
}

export function storyFieldsFromMetadata(
  metadata: Record<string, unknown>,
): StoryFields {
  return {
    concreteProblem: asText(metadata.concreteProblem),
    failedApproaches: asText(metadata.failedApproaches),
    nonObviousMove: asText(metadata.nonObviousMove),
    reusableRecipe: asText(metadata.reusableRecipe),
    evidence: asText(metadata.evidenceItWorked),
  }
}

export function isCompleteStoryFinding(finding: TranscriptFinding): boolean {
  if (finding.category !== 'story') return true
  return validateStoryFields(storyFieldsFromMetadata(finding.metadata)).ok
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
