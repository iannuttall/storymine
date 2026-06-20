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
}

export interface PromoteFindingsResult {
  promoted: number
  candidates: Candidate[]
}

export function promoteTranscriptFindings(
  options: PromoteFindingsOptions = {},
): PromoteFindingsResult {
  const database = getDb()
  const findings = listTranscriptFindings(database, {
    minConfidence: options.minConfidence ?? 0.7,
    withoutCandidate: true,
    limit: options.limit ?? 25,
  })
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
    lines.push(`- One-liner: ${candidate.oneLiner}`)
    lines.push(`- Why interesting: ${candidate.whyInteresting}`)
    if (Object.keys(candidate.provenance).length > 0) {
      lines.push(`- Provenance: ${JSON.stringify(candidate.provenance)}`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

export function candidateFromFinding(finding: TranscriptFinding): Candidate {
  return candidateSchema.parse({
    id: stableId(['candidate', 'transcript', finding.id]),
    source: 'transcript',
    signalId: null,
    name: titleFromLesson(finding.lesson),
    url: null,
    oneLiner: finding.lesson,
    whyInteresting:
      finding.whyNonObvious ??
      finding.evidence[0] ??
      'A reusable lesson from AI-assisted product work.',
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
    },
    capturedAt: nowIso(),
    score: null,
    status: 'new',
  })
}

function titleFromLesson(lesson: string): string {
  const clean = lesson.replace(/\s+/g, ' ').trim()
  if (clean.length <= 70) return clean
  return `${clean.slice(0, 67).trim()}...`
}
