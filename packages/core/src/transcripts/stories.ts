import { basename } from 'node:path'
import { type Artifact, scanArtifacts } from '../artifacts/scan.js'
import {
  publicationFromArtifacts,
  publicationOf,
  topicsOf,
} from '../artifacts/work.js'
import type { TranscriptFinding, TranscriptProvider } from '../schemas.js'
import {
  getDb,
  hasStoryFinding,
  insertTranscriptFindings,
  listChunksForSession,
  listSessionSummaries,
  listTranscriptFindings,
  nowIso,
  stableId,
  upsertSessionSummary,
} from '../storage/database.js'
import type Database from '../storage/sqlite.js'
import type { TranscriptAuditModel } from './audit.js'
import { redactText } from './redaction.js'
import { areDuplicateStories } from './story-dedupe.js'
import {
  type RankedStorySession,
  rankStorySessions,
  type StoryFields,
  storyProjectKey,
  validateStoryFields,
} from './story-ranking.js'
import { boundedTranscriptText } from './summarize.js'

export interface MineStoriesOptions {
  model: TranscriptAuditModel
  days?: number
  limit?: number
  maxStories?: number
  provider?: TranscriptProvider
  project?: string
  topics?: string[]
  now?: number
  maxPromptTokens?: number
  maxPerProject?: number
  retryRejected?: boolean
  concurrency?: number
  artifacts?: Artifact[]
  artifactRoot?: string
  database?: Database.Database
  onProgress?: (event: MineStoriesProgressEvent) => void
}

export interface MineStoriesProgressEvent {
  sessionId: string
  index: number
  total: number
  status: 'started' | 'accepted' | 'rejected' | 'failed'
  reason?: string
}

export interface StoryRejection {
  sessionId: string
  reasons: string[]
}

export interface MineStoriesResult {
  ranked: RankedStorySession[]
  attempted: number
  storiesCreated: number
  rejected: number
  findings: TranscriptFinding[]
  rejections: StoryRejection[]
}

export async function mineStories(
  options: MineStoriesOptions,
): Promise<MineStoriesResult> {
  const database = options.database ?? getDb()
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50))
  const maxStories = Math.max(
    1,
    Math.min(options.maxStories ?? options.limit ?? 10, 50),
  )
  const maxPromptTokens = Math.max(
    1000,
    Math.min(options.maxPromptTokens ?? 12_000, 40_000),
  )
  const projectNeedles = (options.project ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const summaries = listSessionSummaries(database, {
    sinceMs: now - days * 86_400_000,
    limit: 5000,
  }).filter((summary) => {
    if (options.provider && summary.provider !== options.provider) return false
    if (projectNeedles.length === 0) return true
    const haystack = `${summary.cwd ?? ''} ${summary.title ?? ''}`.toLowerCase()
    return projectNeedles.some((needle) => haystack.includes(needle))
  })
  const artifacts =
    options.artifacts ??
    scanArtifacts({
      days,
      now,
      ...(options.artifactRoot
        ? { root: options.artifactRoot }
        : {
            projectPaths: summaries
              .map((summary) => summary.cwd)
              .filter((cwd): cwd is string => Boolean(cwd)),
          }),
    }).artifacts
  const ranked = rankStorySessions(summaries, artifacts, options.topics ?? [])
  // One project can dominate the ranking and repeat the same story across
  // several sessions. Default to one deep pass per project; callers can raise
  // the cap when they intentionally want more depth from one codebase.
  const perProjectCap = Math.max(1, Math.min(options.maxPerProject ?? 1, 5))
  const perProject = new Map<string, number>()
  const top: RankedStorySession[] = []
  for (const entry of ranked) {
    if (top.length >= limit) break
    if (entry.score <= 0) continue
    if (hasStoryFinding(database, entry.summary.sessionId)) continue
    if (!options.retryRejected && hasCurrentStoryRejection(entry.summary)) {
      continue
    }
    const projectKey = storyProjectKey(entry.summary.cwd)
    const used = perProject.get(projectKey) ?? 0
    if (used >= perProjectCap) continue
    perProject.set(projectKey, used + 1)
    top.push(entry)
  }

  const findingByIndex: Array<TranscriptFinding | undefined> = []
  const rejectionByIndex: Array<StoryRejection | undefined> = []
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 8))
  let cursor = 0
  let attempted = 0
  let accepted = 0
  const knownStories = listTranscriptFindings(database, { limit: 1000 }).filter(
    (finding) => finding.category === 'story',
  )
  const worker = async (): Promise<void> => {
    while (true) {
      if (accepted >= maxStories) return
      const index = cursor
      cursor += 1
      if (index >= top.length) return
      const entry = top[index]
      if (!entry) return
      const progress = {
        sessionId: entry.summary.sessionId,
        index: index + 1,
        total: top.length,
      }
      options.onProgress?.({ ...progress, status: 'started' })
      attempted += 1
      try {
        const chunks = listChunksForSession(database, entry.summary.sessionId)
        const prompt = storyPrompt(
          entry,
          chunks,
          maxPromptTokens,
          options.topics ?? [],
        )
        const output = await options.model.complete(prompt)
        const parsed = parseStoryResponse(output)
        if (!parsed) {
          rejectionByIndex[index] = {
            sessionId: entry.summary.sessionId,
            reasons: ['model did not return a valid story object'],
          }
          options.onProgress?.({
            ...progress,
            status: 'rejected',
            reason: 'invalid-json',
          })
          if (/"title"\s*:\s*"none"/i.test(output)) {
            markStoryRejected(database, entry.summary, ['model found no story'])
          }
          continue
        }
        const validation = validateStoryFields(parsed.fields, parsed.title)
        if (!validation.ok) {
          rejectionByIndex[index] = {
            sessionId: entry.summary.sessionId,
            reasons: validation.reasons,
          }
          options.onProgress?.({
            ...progress,
            status: 'rejected',
            reason: validation.reasons[0] ?? 'incomplete',
          })
          markStoryRejected(database, entry.summary, validation.reasons)
          continue
        }
        if (accepted >= maxStories) return
        const finding = storyFinding(entry, parsed)
        const duplicate = knownStories.find((existing) =>
          areDuplicateStories(existing, finding),
        )
        if (duplicate) {
          const reasons = ['duplicate of an existing story idea']
          duplicate.metadata = {
            ...duplicate.metadata,
            supportingFindings: supportingFindingCount(duplicate.metadata) + 1,
          }
          insertTranscriptFindings(database, [duplicate])
          rejectionByIndex[index] = {
            sessionId: entry.summary.sessionId,
            reasons,
          }
          markStoryRejected(database, entry.summary, reasons)
          options.onProgress?.({
            ...progress,
            status: 'rejected',
            reason: 'duplicate',
          })
          continue
        }
        accepted += 1
        knownStories.push(finding)
        insertTranscriptFindings(database, [finding])
        findingByIndex[index] = finding
        options.onProgress?.({ ...progress, status: 'accepted' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        rejectionByIndex[index] = {
          sessionId: entry.summary.sessionId,
          reasons: [reason],
        }
        options.onProgress?.({ ...progress, status: 'failed', reason })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, top.length) }, () => worker()),
  )

  const findings = findingByIndex.filter(
    (finding): finding is TranscriptFinding => finding !== undefined,
  )
  const rejections = rejectionByIndex.filter(
    (rejection): rejection is StoryRejection => rejection !== undefined,
  )

  return {
    ranked: top,
    attempted,
    storiesCreated: findings.length,
    rejected: rejections.length,
    findings,
    rejections,
  }
}

function supportingFindingCount(metadata: Record<string, unknown>): number {
  const value = metadata.supportingFindings
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 1
}

const STORY_AUDIT_VERSION = 1

function hasCurrentStoryRejection(
  summary: RankedStorySession['summary'],
): boolean {
  const audit = summary.metadata.storyAudit
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return false
  const value = audit as Record<string, unknown>
  return value.status === 'rejected' && value.version === STORY_AUDIT_VERSION
}

function markStoryRejected(
  database: Database.Database,
  summary: RankedStorySession['summary'],
  reasons: string[],
): void {
  upsertSessionSummary(database, {
    ...summary,
    metadata: {
      ...summary.metadata,
      storyAudit: {
        status: 'rejected',
        version: STORY_AUDIT_VERSION,
        reasons,
        updatedAt: nowIso(),
      },
    },
  })
}

interface ParsedStory {
  title: string
  fields: StoryFields
  confidence: number
}

export function storyPrompt(
  entry: RankedStorySession,
  chunks: Array<{ redactedText: string; tokenEstimate: number }>,
  maxPromptTokens: number,
  interests: string[] = [],
): string {
  const summary = entry.summary
  return [
    'You are mining one AI coding session for a single strong, concrete blog idea.',
    'Prefer a hard-won build story. An evidence-backed marketing, SEO, product, or AI-coding observation is also valid when the session really supports it.',
    'Do not default to generic prompting advice. A prompting or workflow lesson needs a concrete human intervention and an observable outcome.',
    '',
    'A good story has all five of these, each specific and grounded in what actually happened:',
    '1. concreteProblem: the exact problem the person hit, with real detail (files, formats, tools).',
    '2. failedApproaches: what standard or obvious approaches were tried and did not work.',
    '3. nonObviousMove: the non-obvious move or insight that unlocked progress.',
    '4. reusableRecipe: the reusable recipe someone else could follow to do the same thing.',
    '5. evidence: concrete evidence it worked (a metric, a passing check, a shipped artifact, a file).',
    '',
    'Hard rule: if the idea could be written by someone who never did this work, it is worthless. Reject vague advice.',
    'Every field must name real files, tools, commands, formats, or measurements from the transcript.',
    'User interests are ranking hints only. Do not force the story to fit one.',
    '',
    'Context from a prior summary of this session:',
    `- Built: ${summary.built ?? 'unknown'}`,
    `- Problems: ${summary.problems ?? 'unknown'}`,
    `- Failed approaches: ${summary.failedApproaches.join('; ') || 'none recorded'}`,
    `- What worked: ${summary.whatWorked ?? 'unknown'}`,
    `- Tools created: ${summary.toolsCreated.join('; ') || 'none recorded'}`,
    `- User interests: ${interests.join(', ') || 'none configured'}`,
    `- Deterministic topic matches: ${entry.topicMatches.map((topic) => topic.topic).join(', ') || 'none'}`,
    `- Recent work evidence: ${
      entry.matchedArtifacts.map(describeArtifactForPrompt).join(', ') || 'none'
    }`,
    '',
    'Return JSON only with this shape:',
    '{"title":"plain 6-16 word headline naming the exact achievement or observation","concreteProblem":"...","failedApproaches":"...","nonObviousMove":"...","reusableRecipe":"...","evidence":"...","confidence":0.0}',
    '',
    'Rules:',
    '- Fill every field with specific, transcript-grounded detail. No placeholders.',
    '- If the session has no real story (routine edits, config, chit-chat), return {"title":"none","confidence":0}.',
    '- Do not include secrets or long verbatim code.',
    '- Repository remotes and configured site URLs are declared links, not proof that they are publicly reachable.',
    '- confidence is 0 to 1 for how strong and real this story is.',
    '',
    `Provider: ${summary.provider}`,
    `Session: ${summary.sessionId}`,
    ...(summary.cwd ? [`Project: ${redactText(summary.cwd).text}`] : []),
    '',
    'Transcript excerpts:',
    boundedTranscriptText(chunks, maxPromptTokens),
  ].join('\n')
}

export function parseStoryResponse(output: string): ParsedStory | null {
  const object = parseJsonObject(output)
  const title = asString(object.title)
  if (!title || title.toLowerCase() === 'none') return null
  const fields: StoryFields = {
    concreteProblem: asString(object.concreteProblem) ?? '',
    failedApproaches: asString(object.failedApproaches) ?? '',
    nonObviousMove: asString(object.nonObviousMove) ?? '',
    reusableRecipe: asString(object.reusableRecipe) ?? '',
    evidence: asString(object.evidence) ?? '',
  }
  const confidence =
    typeof object.confidence === 'number' && Number.isFinite(object.confidence)
      ? Math.max(0, Math.min(object.confidence, 1))
      : 0.8
  if (confidence < 0.7) return null
  return { title, fields, confidence }
}

function storyFinding(
  entry: RankedStorySession,
  parsed: ParsedStory,
): TranscriptFinding {
  const summary = entry.summary
  const projectName = summary.cwd ? basename(summary.cwd) : summary.sessionId
  return {
    id: stableId(['story-finding', summary.sessionId, parsed.title]),
    sessionId: summary.sessionId,
    chunkId: null,
    lesson: parsed.title,
    whyNonObvious: parsed.fields.nonObviousMove,
    category: 'story',
    confidence: parsed.confidence,
    evidence: [parsed.fields.evidence],
    candidateId: null,
    capturedAt: nowIso(),
    metadata: {
      findingKind: 'story',
      project: projectName,
      cwd: summary.cwd ? redactText(summary.cwd).text : null,
      concreteProblem: parsed.fields.concreteProblem,
      failedApproaches: parsed.fields.failedApproaches,
      nonObviousMove: parsed.fields.nonObviousMove,
      reusableRecipe: parsed.fields.reusableRecipe,
      evidenceItWorked: parsed.fields.evidence,
      actionForAgent: parsed.fields.reusableRecipe,
      reusableRule: parsed.fields.reusableRecipe,
      mistakeToAvoid: parsed.fields.failedApproaches,
      examplePrompt: parsed.fields.reusableRecipe,
      alphaType: 'story',
      alphaScore: Math.max(parsed.confidence, Math.min(entry.score / 6, 1)),
      storyScore: entry.score,
      storyReasons: entry.reasons,
      topics: entry.topicMatches.map((topic) => topic.topic),
      publication: publicationFromArtifacts(entry.matchedArtifacts),
      matchedArtifacts: entry.matchedArtifacts.map((artifact) => ({
        kind: artifact.kind,
        path: redactText(artifact.path).text,
        name: artifact.name,
        workType: artifact.detail.workType ?? null,
      })),
    },
  }
}

function describeArtifactForPrompt(artifact: Artifact): string {
  const publication = publicationOf(artifact)
  const topics = topicsOf(artifact).map((topic) => topic.topic)
  const createdFiles = Array.isArray(artifact.detail.createdFiles)
    ? artifact.detail.createdFiles
        .filter((file): file is string => typeof file === 'string')
        .slice(0, 8)
    : []
  return JSON.stringify({
    name: artifact.name,
    kind: artifact.kind,
    workType: artifact.detail.workType ?? null,
    commitCount: artifact.detail.commitCount ?? null,
    createdFiles,
    toolSignals: Array.isArray(artifact.detail.toolSignals)
      ? artifact.detail.toolSignals
      : [],
    topics,
    publication,
  })
}

function parseJsonObject(value: string): Record<string, unknown> {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return {}
  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return redactText(value.trim()).text
}
