import {
  type Candidate,
  candidateSchema,
  type TranscriptFinding,
} from './schemas.js'
import {
  attachCandidateToFinding,
  getDb,
  insertCandidates,
  listCandidates,
  listTranscriptFindings,
  nowIso,
  stableId,
} from './storage/database.js'
import { isCompleteStoryFinding } from './transcripts/story-ranking.js'

export interface PromoteFindingsOptions {
  minConfidence?: number
  limit?: number
  force?: boolean
  maxPerAlphaType?: number
  includeUnreviewed?: boolean
}

export interface PromoteFindingsResult {
  promoted: number
  candidates: Candidate[]
}

export function promoteTranscriptFindings(
  options: PromoteFindingsOptions = {},
): PromoteFindingsResult {
  const database = getDb()
  const groups = groupFindings(
    listTranscriptFindings(database, {
      minConfidence: options.minConfidence ?? 0.7,
      withoutCandidate: !options.force,
      ...(!options.includeUnreviewed
        ? { reviewStatus: 'approved' as const }
        : {}),
      limit: 1000,
    }).filter(isCompleteStoryFinding),
  )
  const findings = diversifyFindings(
    groups,
    options.maxPerAlphaType ?? 4,
  ).slice(0, options.limit ?? 25)
  const candidates = findings.map((group) =>
    candidateFromFinding(group.primary, group),
  )
  insertCandidates(database, candidates)
  for (let index = 0; index < findings.length; index += 1) {
    const group = findings[index]
    const candidate = candidates[index]
    if (group && candidate) {
      for (const finding of group.findings) {
        attachCandidateToFinding(database, finding.id, candidate.id)
      }
    }
  }
  return { promoted: candidates.length, candidates }
}

export function listStoredCandidates(
  options: { status?: string; limit?: number } = {},
): Candidate[] {
  return listCandidates(getDb(), options)
}

export function renderCandidatesMarkdown(candidates: Candidate[]): string {
  const lines = ['# Research Candidates', '']
  for (const candidate of candidates) {
    lines.push(`## ${candidate.name}`)
    lines.push('')
    if (candidate.url) lines.push(candidate.url, '')
    lines.push(`- Source: ${candidate.source}`)
    lines.push(`- Tier: ${candidate.tier}`)
    if (candidate.score !== null) lines.push(`- Score: ${candidate.score}`)
    const alphaType = asString(candidate.provenance.alphaType)
    if (alphaType) lines.push(`- Alpha type: ${alphaType}`)
    const alphaScore = asNumber(candidate.provenance.alphaScore)
    if (alphaScore !== null) lines.push(`- Alpha score: ${alphaScore}`)
    lines.push(`- Summary: ${candidate.oneLiner}`)
    lines.push(`- Why this matters: ${candidate.whyInteresting}`)
    const actionForAgent = asString(candidate.provenance.actionForAgent)
    if (actionForAgent) lines.push(`- Better move: ${actionForAgent}`)
    const duplicateCount = asNumber(candidate.provenance.duplicateCount)
    if (duplicateCount !== null && duplicateCount > 1) {
      lines.push(`- Supported by: ${duplicateCount} similar findings`)
    }
    const mistakeToAvoid = asString(candidate.provenance.mistakeToAvoid)
    if (mistakeToAvoid) lines.push(`- Avoid: ${mistakeToAvoid}`)
    const examplePrompt = asString(candidate.provenance.examplePrompt)
    if (examplePrompt) lines.push(`- Example prompt: ${examplePrompt}`)
    const reusableRule = asString(candidate.provenance.reusableRule)
    if (reusableRule) lines.push(`- Reusable rule: ${reusableRule}`)
    const evidence = asStringArray(candidate.provenance.evidence)
    if (evidence.length > 0) {
      lines.push('- Evidence:')
      for (const item of evidence) lines.push(`  - ${item}`)
    }
    const category = asString(candidate.provenance.category)
    if (category) lines.push(`- Category: ${category}`)
    const findingId = asString(candidate.provenance.findingId)
    if (findingId) lines.push(`- Finding ID: ${findingId}`)
    const sessionId = asString(candidate.provenance.sessionId)
    if (sessionId) lines.push(`- Session ID: ${sessionId}`)
    const chunkId = asString(candidate.provenance.chunkId)
    if (chunkId) lines.push(`- Chunk ID: ${chunkId}`)
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

export function candidateFromFinding(
  finding: TranscriptFinding,
  group?: FindingGroup,
): Candidate {
  const actionForAgent = asString(finding.metadata.actionForAgent)
  const reusableRule = asString(finding.metadata.reusableRule)
  const mistakeToAvoid = asString(finding.metadata.mistakeToAvoid)
  const examplePrompt = asString(finding.metadata.examplePrompt)
  const alphaScore = asNumber(finding.metadata.alphaScore)
  const alphaType = asString(finding.metadata.alphaType)
  const evidence = group?.evidence ?? finding.evidence
  return candidateSchema.parse({
    id: stableId(['candidate', 'transcript', finding.id]),
    source: 'transcript',
    signalId: null,
    name: titleFromLesson(finding.lesson, alphaType),
    url: null,
    oneLiner: finding.lesson,
    whyInteresting: whyInterestingFromFinding(finding),
    tier: 'discovery',
    metrics: {
      confidence: finding.confidence,
      ...(alphaScore !== null ? { alphaScore } : {}),
    },
    provenance: {
      findingId: finding.id,
      ...(group && group.findings.length > 1
        ? {
            mergedFindingIds: group.findings.map((item) => item.id),
            duplicateCount: group.findings.length,
          }
        : {}),
      sessionId: finding.sessionId,
      chunkId: finding.chunkId,
      category: finding.category,
      evidence,
      ...(actionForAgent ? { actionForAgent } : {}),
      ...(reusableRule ? { reusableRule } : {}),
      ...(mistakeToAvoid ? { mistakeToAvoid } : {}),
      ...(examplePrompt ? { examplePrompt } : {}),
      ...(alphaScore !== null ? { alphaScore } : {}),
      ...(alphaType ? { alphaType } : {}),
    },
    capturedAt: nowIso(),
    score: null,
    status: 'new',
  })
}

export interface FindingGroup {
  primary: TranscriptFinding
  findings: TranscriptFinding[]
  evidence: string[]
  tokens: Set<string>
}

function groupFindings(findings: TranscriptFinding[]): FindingGroup[] {
  const groups: FindingGroup[] = []
  for (const finding of findings.sort(compareFindings)) {
    const tokens = findingTokens(finding)
    const existing = groups.find((group) =>
      areSimilarFindings(finding, tokens, group),
    )
    if (existing) {
      existing.findings.push(finding)
      existing.evidence = mergeEvidence(existing.evidence, finding.evidence)
      if (compareFindings(finding, existing.primary) < 0) {
        existing.primary = finding
      }
    } else {
      groups.push({
        primary: finding,
        findings: [finding],
        evidence: finding.evidence,
        tokens,
      })
    }
  }
  return groups.sort((a, b) => compareFindings(a.primary, b.primary))
}

function diversifyFindings(
  groups: FindingGroup[],
  maxPerAlphaType: number,
): FindingGroup[] {
  if (maxPerAlphaType <= 0) return groups
  const counts = new Map<string, number>()
  return groups.filter((group) => {
    const alphaType = asString(group.primary.metadata.alphaType) ?? 'unknown'
    const count = counts.get(alphaType) ?? 0
    if (count >= maxPerAlphaType) return false
    counts.set(alphaType, count + 1)
    return true
  })
}

function areSimilarFindings(
  finding: TranscriptFinding,
  tokens: Set<string>,
  group: FindingGroup,
): boolean {
  const findingType = asString(finding.metadata.alphaType)
  const groupType = asString(group.primary.metadata.alphaType)
  const sameType = findingType && groupType && findingType === groupType
  const sameCategory = finding.category === group.primary.category
  const concept = conceptKey(finding)
  return (
    (concept !== null && concept === conceptKey(group.primary)) ||
    normalizeText(finding.lesson) === normalizeText(group.primary.lesson) ||
    ((sameType || sameCategory) && jaccard(tokens, group.tokens) >= 0.78)
  )
}

function compareFindings(
  left: TranscriptFinding,
  right: TranscriptFinding,
): number {
  return findingValue(right) - findingValue(left)
}

function findingValue(finding: TranscriptFinding): number {
  const alphaScore = asNumber(finding.metadata.alphaScore) ?? 0
  const evidenceBonus = Math.min(finding.evidence.length, 3) * 0.03
  return alphaScore * 2 + finding.confidence + evidenceBonus
}

function findingTokens(finding: TranscriptFinding): Set<string> {
  return new Set(
    normalizeText(
      [
        finding.lesson,
        finding.whyNonObvious,
        asString(finding.metadata.mistakeToAvoid),
        asString(finding.metadata.examplePrompt),
        asString(finding.metadata.alphaType),
      ]
        .filter(Boolean)
        .join(' '),
    )
      .split(' ')
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  )
}

function conceptKey(finding: TranscriptFinding): string | null {
  const text = normalizeText(
    [
      finding.lesson,
      finding.whyNonObvious,
      asString(finding.metadata.mistakeToAvoid),
      asString(finding.metadata.examplePrompt),
    ]
      .filter(Boolean)
      .join(' '),
  )
  if (
    hasAny(text, [
      'robotic',
      'robot',
      'human',
      'ai tell',
      'model fingerprint',
    ]) &&
    hasAny(text, ['ban list', 'banlist', 'tells', 'grep', 'strip'])
  ) {
    return 'writing-tell-ban-list'
  }
  if (
    hasAny(text, ['guess', 'unknown', 'don t know', 'doesn t know']) &&
    hasAny(text, ['confident', 'fact', 'number', 'date', 'source'])
  ) {
    return 'admit-unknowns'
  }
  if (
    hasAny(text, ['current', 'training data', 'live source', 'verify']) &&
    hasAny(text, ['price', 'product', 'rule', 'feature'])
  ) {
    return 'verify-current-facts'
  }
  if (
    hasAny(text, [
      'vague quantity',
      'vague quantities',
      'abstract',
      'placeholder',
    ]) &&
    hasAny(text, [
      'actual figure',
      'concrete number',
      'real number',
      'real numbers',
      'specific figure',
      'specific figures',
      'specific number',
      'worked example',
    ])
  ) {
    return 'concrete-specifics'
  }
  if (
    hasAny(text, ['tone', 'voice', 'vibe']) &&
    hasAny(text, ['anti vibe', 'avoid', 'not hype', 'negative constraint'])
  ) {
    return 'tone-plus-anti-tone'
  }
  return null
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle))
}

function mergeEvidence(left: string[], right: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of [...left, ...right]) {
    const key = normalizeText(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged.slice(0, 5)
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function whyInterestingFromFinding(finding: TranscriptFinding): string {
  return (
    finding.whyNonObvious ??
    finding.evidence[0] ??
    'A reusable lesson from AI-assisted product work.'
  )
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function titleFromLesson(lesson: string, alphaType: string | null): string {
  const clean = lesson.replace(/\s+/g, ' ').trim()
  if (clean) return clean
  return alphaType ? humanizeAlphaType(alphaType) : 'Transcript finding'
}

function humanizeAlphaType(value: string): string {
  return value
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

const STOP_WORDS = new Set([
  'about',
  'accept',
  'after',
  'again',
  'against',
  'agent',
  'before',
  'being',
  'better',
  'each',
  'from',
  'give',
  'have',
  'into',
  'just',
  'make',
  'more',
  'only',
  'output',
  'prompt',
  'should',
  'that',
  'their',
  'them',
  'then',
  'there',
  'this',
  'what',
  'when',
  'where',
  'with',
  'without',
  'write',
  'writes',
  'writing',
  'your',
])
