import type { WorkPublication } from './artifacts/work.js'
import type { TranscriptFinding } from './schemas.js'
import { getDb, listTranscriptFindings } from './storage/database.js'
import type Database from './storage/sqlite.js'
import { redactText } from './transcripts/redaction.js'
import { reviewStatusForFinding } from './transcripts/review.js'
import { groupDuplicateStories } from './transcripts/story-dedupe.js'
import {
  isCompleteStoryFinding,
  storyFieldsFromMetadata,
} from './transcripts/story-ranking.js'

export type StoryIdeaStatus = 'new' | 'approved' | 'rejected' | 'needs-work'

export interface StoryIdea {
  id: string
  title: string
  project: string | null
  topics: string[]
  publication: WorkPublication
  problem: string
  failedApproaches: string
  nonObviousMove: string
  recipe: string
  evidence: string
  confidence: number
  status: StoryIdeaStatus
  capturedAt: string
  supportingFindings: number
}

export interface ListStoryIdeasOptions {
  status?: StoryIdeaStatus | 'all'
  limit?: number
}

export function listStoryIdeas(
  options: ListStoryIdeasOptions = {},
  database: Database.Database = getDb(),
): StoryIdea[] {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200))
  const status = options.status ?? 'new'
  return groupDuplicateStories(
    listTranscriptFindings(database, { limit: 1000 }).filter(
      (finding) =>
        finding.category === 'story' && isCompleteStoryFinding(finding),
    ),
  )
    .map((group) => {
      const primary = group[0] as TranscriptFinding
      const support = group.reduce(
        (total, finding) => total + supportingFindingCount(finding),
        0,
      )
      return storyIdeaFromFinding(primary, support)
    })
    .filter((idea) => status === 'all' || idea.status === status)
    .slice(0, limit)
}

export function storyIdeaFromFinding(
  finding: TranscriptFinding,
  supportingFindings = supportingFindingCount(finding),
): StoryIdea {
  const fields = storyFieldsFromMetadata(finding.metadata)
  const project = asString(finding.metadata.project)
  const reviewStatus = reviewStatusForFinding(finding)
  const status: StoryIdeaStatus =
    reviewStatus === 'approved' ||
    reviewStatus === 'rejected' ||
    reviewStatus === 'needs-work'
      ? reviewStatus
      : 'new'
  return {
    id: finding.id,
    title: safe(finding.lesson),
    project: project ? safe(project) : null,
    topics: stringArray(finding.metadata.topics).map(safe),
    publication: publicationValue(finding.metadata.publication),
    problem: safe(fields.concreteProblem),
    failedApproaches: safe(fields.failedApproaches),
    nonObviousMove: safe(fields.nonObviousMove),
    recipe: safe(fields.reusableRecipe),
    evidence: safe(fields.evidence),
    confidence: finding.confidence,
    status,
    capturedAt: finding.capturedAt,
    supportingFindings,
  }
}

function supportingFindingCount(finding: TranscriptFinding): number {
  const value = finding.metadata.supportingFindings
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 1
}

export function renderStoryIdeasMarkdown(ideas: StoryIdea[]): string {
  if (ideas.length === 0) return 'No story ideas found. Run `storymine scan`.\n'
  const lines = ['# Story ideas', '']
  for (const idea of ideas) {
    lines.push(`## ${idea.title}`, '')
    lines.push(`- ID: ${idea.id}`)
    lines.push(`- Status: ${idea.status}`)
    if (idea.project) lines.push(`- Project: ${idea.project}`)
    if (idea.topics.length > 0)
      lines.push(`- Topics: ${idea.topics.join(', ')}`)
    if (idea.publication.repository) {
      lines.push(
        `- Repository: ${idea.publication.repository.url} (visibility not checked)`,
      )
    }
    for (const url of idea.publication.declaredPublicUrls) {
      lines.push(`- Declared public URL: ${url}`)
    }
    if (idea.publication.package) {
      lines.push(`- Package: ${idea.publication.package.name}`)
    }
    lines.push(`- Confidence: ${idea.confidence.toFixed(2)}`, '')
    if (idea.supportingFindings > 1) {
      lines.push(`- Supporting findings: ${idea.supportingFindings}`, '')
    }
    lines.push(`**Problem:** ${idea.problem}`, '')
    lines.push(`**What failed:** ${idea.failedApproaches}`, '')
    lines.push(`**Non-obvious move:** ${idea.nonObviousMove}`, '')
    lines.push(`**Reusable recipe:** ${idea.recipe}`, '')
    lines.push(`**Evidence:** ${idea.evidence}`, '')
  }
  return `${lines.join('\n').trim()}\n`
}

function safe(value: string): string {
  return redactText(value).text
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function publicationValue(value: unknown): WorkPublication {
  const empty: WorkPublication = {
    repository: null,
    declaredPublicUrls: [],
    package: null,
  }
  if (!value || typeof value !== 'object') return empty
  const publication = value as Record<string, unknown>
  const repository = publication.repository
  const packageValue = publication.package
  return {
    repository:
      repository &&
      typeof repository === 'object' &&
      typeof (repository as Record<string, unknown>).url === 'string'
        ? {
            url: safe(String((repository as Record<string, unknown>).url)),
            visibility: 'unknown',
          }
        : null,
    declaredPublicUrls: stringArray(publication.declaredPublicUrls).map(safe),
    package:
      packageValue &&
      typeof packageValue === 'object' &&
      typeof (packageValue as Record<string, unknown>).name === 'string'
        ? {
            name: safe(String((packageValue as Record<string, unknown>).name)),
            private:
              typeof (packageValue as Record<string, unknown>).private ===
              'boolean'
                ? Boolean((packageValue as Record<string, unknown>).private)
                : null,
          }
        : null,
  }
}
