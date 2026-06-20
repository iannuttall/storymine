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

export interface PromoteFindingsOptions {
  minConfidence?: number
  limit?: number
  force?: boolean
}

export interface PromoteFindingsResult {
  promoted: number
  candidates: Candidate[]
}

export function promoteTranscriptFindings(
  options: PromoteFindingsOptions = {},
): PromoteFindingsResult {
  const database = getDb()
  const findings = dedupeFindings(
    listTranscriptFindings(database, {
      minConfidence: options.minConfidence ?? 0.7,
      withoutCandidate: !options.force,
      limit: options.limit ?? 25,
    }),
  )
  const candidates = findings.map(candidateFromFinding)
  insertCandidates(database, candidates)
  for (let index = 0; index < findings.length; index += 1) {
    const finding = findings[index]
    const candidate = candidates[index]
    if (finding && candidate) {
      attachCandidateToFinding(database, finding.id, candidate.id)
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
    lines.push(`- Summary: ${candidate.oneLiner}`)
    lines.push(`- Why this matters: ${candidate.whyInteresting}`)
    const actionForAgent = asString(candidate.provenance.actionForAgent)
    if (actionForAgent) lines.push(`- Action for agent: ${actionForAgent}`)
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

export function candidateFromFinding(finding: TranscriptFinding): Candidate {
  const actionForAgent = asString(finding.metadata.actionForAgent)
  const reusableRule = asString(finding.metadata.reusableRule)
  return candidateSchema.parse({
    id: stableId(['candidate', 'transcript', finding.id]),
    source: 'transcript',
    signalId: null,
    name: titleFromLesson(finding.lesson),
    url: null,
    oneLiner: finding.lesson,
    whyInteresting: whyInterestingFromFinding(finding),
    tier: 'discovery',
    metrics: {
      confidence: finding.confidence,
    },
    provenance: {
      findingId: finding.id,
      sessionId: finding.sessionId,
      chunkId: finding.chunkId,
      category: finding.category,
      evidence: finding.evidence,
      ...(actionForAgent ? { actionForAgent } : {}),
      ...(reusableRule ? { reusableRule } : {}),
    },
    capturedAt: nowIso(),
    score: null,
    status: 'new',
  })
}

function dedupeFindings(findings: TranscriptFinding[]): TranscriptFinding[] {
  const byKey = new Map<string, TranscriptFinding>()
  for (const finding of findings) {
    const key = normalizeLesson(finding.lesson)
    const existing = byKey.get(key)
    if (!existing || finding.confidence > existing.confidence) {
      byKey.set(key, finding)
    }
  }
  return [...byKey.values()]
}

function normalizeLesson(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|to|for|of|and|or|with|by)\b/g, ' ')
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

function titleFromLesson(lesson: string): string {
  const clean = lesson.replace(/\s+/g, ' ').trim()
  if (clean.length <= 70) return clean
  return `${clean.slice(0, 67).trim()}...`
}
