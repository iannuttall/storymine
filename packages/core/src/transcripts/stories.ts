import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import { scanArtifacts } from '../artifacts/scan.js'
import type { TranscriptFinding, TranscriptProvider } from '../schemas.js'
import {
  getDb,
  insertTranscriptFindings,
  listChunksForSession,
  listSessionSummaries,
  nowIso,
  stableId,
} from '../storage/database.js'
import type { TranscriptAuditModel } from './audit.js'
import {
  type RankedStorySession,
  rankStorySessions,
  type StoryFields,
  validateStoryFields,
} from './story-ranking.js'

export interface MineStoriesOptions {
  model: TranscriptAuditModel
  days?: number
  limit?: number
  provider?: TranscriptProvider
  now?: number
  maxPromptTokens?: number
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
  const maxPromptTokens = Math.max(
    1000,
    Math.min(options.maxPromptTokens ?? 12_000, 40_000),
  )
  const summaries = listSessionSummaries(database, {
    sinceMs: now - days * 86_400_000,
    limit: 5000,
  }).filter((summary) =>
    options.provider ? summary.provider === options.provider : true,
  )
  const artifacts = scanArtifacts({ days, now }).artifacts
  const ranked = rankStorySessions(summaries, artifacts)
  const top = ranked.filter((entry) => entry.score > 0).slice(0, limit)

  const findings: TranscriptFinding[] = []
  const rejections: StoryRejection[] = []

  for (let index = 0; index < top.length; index += 1) {
    const entry = top[index]
    if (!entry) continue
    const progress = {
      sessionId: entry.summary.sessionId,
      index: index + 1,
      total: top.length,
    }
    options.onProgress?.({ ...progress, status: 'started' })
    try {
      const chunks = listChunksForSession(database, entry.summary.sessionId)
      const prompt = storyPrompt(entry, chunks, maxPromptTokens)
      const output = await options.model.complete(prompt)
      const parsed = parseStoryResponse(output)
      if (!parsed) {
        rejections.push({
          sessionId: entry.summary.sessionId,
          reasons: ['model did not return a valid story object'],
        })
        options.onProgress?.({
          ...progress,
          status: 'rejected',
          reason: 'invalid-json',
        })
        continue
      }
      const validation = validateStoryFields(parsed.fields)
      if (!validation.ok) {
        rejections.push({
          sessionId: entry.summary.sessionId,
          reasons: validation.reasons,
        })
        options.onProgress?.({
          ...progress,
          status: 'rejected',
          reason: validation.reasons[0] ?? 'incomplete',
        })
        continue
      }
      const finding = storyFinding(entry, parsed)
      insertTranscriptFindings(database, [finding])
      findings.push(finding)
      options.onProgress?.({ ...progress, status: 'accepted' })
    } catch (error) {
      rejections.push({
        sessionId: entry.summary.sessionId,
        reasons: [error instanceof Error ? error.message : String(error)],
      })
      options.onProgress?.({
        ...progress,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    ranked: top,
    storiesCreated: findings.length,
    rejected: rejections.length,
    findings,
    rejections,
  }
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
): string {
  const summary = entry.summary
  return [
    'You are mining one AI coding session for a single strong, concrete story worth writing about.',
    'This is NOT a prompting-tips task. Do not produce generic advice. Find the real, hard-won build story.',
    '',
    'A good story has all five of these, each specific and grounded in what actually happened:',
    '1. concreteProblem: the exact problem the person hit, with real detail (files, formats, tools).',
    '2. failedApproaches: what standard or obvious approaches were tried and did not work.',
    '3. nonObviousMove: the non-obvious move or insight that unlocked progress.',
    '4. reusableRecipe: the reusable recipe someone else could follow to do the same thing.',
    '5. evidence: concrete evidence it worked (a metric, a passing check, a shipped artifact, a file).',
    '',
    'Hard rule: if the tip could be written by someone who never did this work, it is worthless. Reject vague advice.',
    'Every field must name real files, tools, commands, formats, or measurements from the transcript.',
    '',
    'Context from a prior summary of this session:',
    `- Built: ${summary.built ?? 'unknown'}`,
    `- Problems: ${summary.problems ?? 'unknown'}`,
    `- Failed approaches: ${summary.failedApproaches.join('; ') || 'none recorded'}`,
    `- What worked: ${summary.whatWorked ?? 'unknown'}`,
    `- Tools created: ${summary.toolsCreated.join('; ') || 'none recorded'}`,
    `- Matched artifacts: ${
      entry.matchedArtifacts
        .map((artifact) => `${artifact.kind} ${artifact.name}`)
        .join(', ') || 'none'
    }`,
    '',
    'Return JSON only with this shape:',
    '{"title":"direct headline naming the concrete achievement","concreteProblem":"...","failedApproaches":"...","nonObviousMove":"...","reusableRecipe":"...","evidence":"...","confidence":0.0}',
    '',
    'Rules:',
    '- Fill every field with specific, transcript-grounded detail. No placeholders.',
    '- If the session has no real story (routine edits, config, chit-chat), return {"title":"none","confidence":0}.',
    '- Do not include secrets or long verbatim code.',
    '- confidence is 0 to 1 for how strong and real this story is.',
    '',
    `Provider: ${summary.provider}`,
    `Session: ${summary.sessionId}`,
    ...(summary.cwd ? [`Project: ${summary.cwd}`] : []),
    '',
    'Transcript excerpts:',
    boundedChunkText(chunks, maxPromptTokens),
  ].join('\n')
}

function boundedChunkText(
  chunks: Array<{ redactedText: string; tokenEstimate: number }>,
  maxPromptTokens: number,
): string {
  const selected: string[] = []
  let tokens = 0
  for (const chunk of chunks) {
    if (tokens + chunk.tokenEstimate > maxPromptTokens && selected.length > 0) {
      break
    }
    selected.push(chunk.redactedText)
    tokens += chunk.tokenEstimate
  }
  return selected.join('\n\n')
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
      cwd: summary.cwd,
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
      matchedArtifacts: entry.matchedArtifacts.map((artifact) => ({
        kind: artifact.kind,
        path: artifact.path,
      })),
    },
  }
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
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
