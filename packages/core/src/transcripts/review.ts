import type { TranscriptFinding } from '../schemas.js'
import {
  getDb,
  getTranscriptFinding,
  listTranscriptFindings,
  nowIso,
  updateTranscriptFindingMetadata,
} from '../storage/database.js'
import type Database from '../storage/sqlite.js'

export type TranscriptFindingReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'rejected'
  | 'needs-work'
  | 'all'

export interface ListTranscriptFindingReviewsOptions {
  status?: TranscriptFindingReviewStatus
  minConfidence?: number
  limit?: number
}

export interface ReviewTranscriptFindingOptions {
  id: string
  status: Exclude<TranscriptFindingReviewStatus, 'unreviewed' | 'all'>
  notes?: string
}

export function listTranscriptFindingReviews(
  options: ListTranscriptFindingReviewsOptions = {},
  database: Database.Database = getDb(),
): TranscriptFinding[] {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 1000))
  const status = options.status ?? 'unreviewed'
  const findings = listTranscriptFindings(database, {
    minConfidence: options.minConfidence ?? 0,
    limit: Math.max(limit, 100),
  }).filter((finding) => findingMatchesReviewStatus(finding, status))
  return findings.slice(0, limit)
}

export function reviewTranscriptFinding(
  options: ReviewTranscriptFindingOptions,
  database: Database.Database = getDb(),
): TranscriptFinding {
  const finding = getTranscriptFinding(database, options.id)
  if (!finding) throw new Error(`Transcript finding not found: ${options.id}`)
  const metadata = {
    ...finding.metadata,
    reviewStatus: options.status,
    reviewedAt: nowIso(),
    ...(options.notes ? { reviewNotes: options.notes } : {}),
  }
  updateTranscriptFindingMetadata(database, finding.id, metadata)
  const updated = getTranscriptFinding(database, finding.id)
  if (!updated) throw new Error(`Transcript finding not found: ${options.id}`)
  return updated
}

export function renderTranscriptFindingReviewsMarkdown(
  findings: TranscriptFinding[],
): string {
  if (findings.length === 0) return ''
  return findings
    .map((finding) =>
      [
        `## ${finding.lesson}`,
        '',
        `- Finding ID: ${finding.id}`,
        `- Review: ${reviewStatusForFinding(finding)}`,
        `- Category: ${finding.category}`,
        `- Confidence: ${finding.confidence.toFixed(2)}`,
        `- Session: ${finding.sessionId}`,
        ...(finding.chunkId ? [`- Chunk: ${finding.chunkId}`] : []),
        ...(asString(finding.metadata.alphaType)
          ? [`- Alpha type: ${asString(finding.metadata.alphaType)}`]
          : []),
        ...(asString(finding.metadata.interventionType)
          ? [
              `- Intervention type: ${asString(
                finding.metadata.interventionType,
              )}`,
            ]
          : []),
        ...(asString(finding.metadata.skillPotential)
          ? [`- Skill potential: ${asString(finding.metadata.skillPotential)}`]
          : []),
        ...(asString(finding.metadata.examplePrompt)
          ? [`- Example prompt: ${asString(finding.metadata.examplePrompt)}`]
          : []),
        ...(asString(finding.metadata.plainEnglishWhy)
          ? [`- Plain English: ${asString(finding.metadata.plainEnglishWhy)}`]
          : []),
        '',
        'Evidence:',
        ...finding.evidence.map((item) => `- ${item}`),
        '',
      ].join('\n'),
    )
    .join('\n')
}

export function reviewStatusForFinding(
  finding: TranscriptFinding,
): TranscriptFindingReviewStatus {
  const status = finding.metadata.reviewStatus
  if (
    status === 'approved' ||
    status === 'rejected' ||
    status === 'needs-work'
  ) {
    return status
  }
  return 'unreviewed'
}

function findingMatchesReviewStatus(
  finding: TranscriptFinding,
  status: TranscriptFindingReviewStatus,
): boolean {
  if (status === 'all') return true
  return reviewStatusForFinding(finding) === status
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
