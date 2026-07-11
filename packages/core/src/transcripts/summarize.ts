import type Database from 'better-sqlite3'
import type {
  SessionSummary,
  TranscriptChunk,
  TranscriptProvider,
} from '../schemas.js'
import {
  getDb,
  hasSessionSummary,
  listChunksForSession,
  listSessionSummaries,
  listTranscriptSessionsInWindow,
  nowIso,
  upsertSessionSummary,
} from '../storage/database.js'
import type { TranscriptAuditModel } from './audit.js'

export interface SummarizeSessionsOptions {
  model: TranscriptAuditModel
  days?: number
  project?: string
  provider?: TranscriptProvider
  limit?: number
  force?: boolean
  now?: number
  maxPromptTokens?: number
  concurrency?: number
  database?: Database.Database
  onProgress?: (event: SummarizeProgressEvent) => void
}

export interface SummarizeProgressEvent {
  sessionId: string
  index: number
  total: number
  status: 'started' | 'summarized' | 'skipped' | 'failed'
  reason?: string
}

export interface SummarizeResult {
  sessionsConsidered: number
  summarized: number
  skipped: number
  failed: number
  summaries: SessionSummary[]
}

export async function summarizeSessions(
  options: SummarizeSessionsOptions,
): Promise<SummarizeResult> {
  const database = options.database ?? getDb()
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const limit = Math.max(1, Math.min(options.limit ?? 50, 1000))
  const maxPromptTokens = Math.max(
    1000,
    Math.min(options.maxPromptTokens ?? 10_000, 40_000),
  )
  const sessions = listTranscriptSessionsInWindow(database, {
    sinceMs: now - days * 86_400_000,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.project ? { project: options.project } : {}),
    limit: 5000,
  })

  const summaries: SessionSummary[] = []
  let summarized = 0
  let skipped = 0
  let failed = 0
  let considered = 0

  type PendingSession = {
    session: (typeof sessions)[number]
    chunks: ReturnType<typeof listChunksForSession>
  }
  const pending: PendingSession[] = []
  for (const session of sessions) {
    if (pending.length >= limit) break
    considered += 1
    const progress = {
      sessionId: session.id,
      index: considered,
      total: sessions.length,
    }
    if (!options.force && hasSessionSummary(database, session.id)) {
      skipped += 1
      options.onProgress?.({ ...progress, status: 'skipped', reason: 'exists' })
      continue
    }
    const chunks = listChunksForSession(database, session.id)
    if (chunks.length === 0) {
      skipped += 1
      options.onProgress?.({
        ...progress,
        status: 'skipped',
        reason: 'no-chunks',
      })
      continue
    }
    pending.push({ session, chunks })
  }

  // Model calls run through a bounded worker pool. Each summary is written
  // the moment its call completes, so a killed run still resumes cleanly.
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= pending.length) return
      const entry = pending[index]
      if (!entry) return
      const { session, chunks } = entry
      const progress = {
        sessionId: session.id,
        index: index + 1,
        total: pending.length,
      }
      options.onProgress?.({ ...progress, status: 'started' })
      try {
        const prompt = summarizePrompt(session, chunks, maxPromptTokens)
        const output = await options.model.complete(prompt)
        const summary = summaryFromResponse(session, chunks.length, output)
        upsertSessionSummary(database, summary)
        summaries.push(summary)
        summarized += 1
        options.onProgress?.({ ...progress, status: 'summarized' })
      } catch (error) {
        failed += 1
        options.onProgress?.({
          ...progress,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, () =>
      worker(),
    ),
  )

  return {
    sessionsConsidered: considered,
    summarized,
    skipped,
    failed,
    summaries,
  }
}

export function listStoredSessionSummaries(
  options: { days?: number; limit?: number; now?: number } = {},
  database: Database.Database = getDb(),
): SessionSummary[] {
  const now = options.now ?? Date.now()
  return listSessionSummaries(database, {
    ...(options.days ? { sinceMs: now - options.days * 86_400_000 } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  })
}

export function summarizePrompt(
  session: {
    id: string
    provider: string
    cwd: string | null
    title: string | null
  },
  chunks: TranscriptChunk[],
  maxPromptTokens: number,
): string {
  const body = boundedChunkText(chunks, maxPromptTokens)
  return [
    'You are summarizing one AI coding session so it can be mined for newsletter stories later.',
    'The transcript is already redacted. Do not invent details. Only use what the transcript shows.',
    '',
    'Write a compact, factual summary that captures the shape of the work, not prompting advice.',
    'Focus on: what was being built, concrete problems hit, approaches that were tried and failed,',
    'what actually worked, any tool/skill/script that was created, and any opinions or complaints the',
    'human repeated (for example frustration with a specific model, tool, or workflow).',
    '',
    'Pay special attention to FRICTION: moments where the human interrupted or aborted a turn,',
    'said no/stop/wrong, reversed the AI, or where the AI did significant work that was never asked',
    'for (unrequested refactors, scope creep). Friction moments are the most valuable part of the',
    'session for later mining. A feature list that omits them is a failed summary.',
    '',
    'Return JSON only with this shape:',
    '{"summary":"5-10 line plain summary","built":"what was being built","problems":"main problems hit","failedApproaches":["approach that did not work"],"whatWorked":"what actually solved it","toolsCreated":["tool or skill or script created"],"opinions":["repeated complaint or strong opinion, quoted plainly"],"friction":["interruption, correction, or unrequested work, with what triggered it"]}',
    '',
    'Rules:',
    '- Keep summary concrete and specific. Name real files, tools, commands, and error types when the transcript shows them.',
    '- failedApproaches, toolsCreated, opinions, and friction are arrays. Use an empty array if there is nothing real to add.',
    '- opinions should capture repeated frustrations or preferences (for example "GPT-5.6 keeps overengineering"), not generic advice.',
    '- friction entries should say what the AI was doing and how the human reacted, close to verbatim.',
    '- Do not include secrets, credentials, or long verbatim code.',
    '- If the session is thin or off-topic, still return valid JSON with a short summary and empty arrays.',
    '',
    `Provider: ${session.provider}`,
    `Session: ${session.id}`,
    ...(session.cwd ? [`Project: ${session.cwd}`] : []),
    ...(session.title ? [`Title: ${session.title}`] : []),
    '',
    'Transcript:',
    body,
  ].join('\n')
}

// User pushback markers. Chunks matching these must survive truncation:
// the middle of a long session is exactly where "no no no, stop" lives.
const FRICTION_PATTERN =
  /<turn_aborted>|\bno no\b|\bstop\b|\bdon'?t\b|\bdo not\b|\bwrong\b|\brevert\b|\bundo\b|why (?:did|are|would) you|too (?:much|far)|over the top|overboard|overengineer|didn'?t ask|unprompted/i

function isFrictionChunk(chunk: TranscriptChunk): boolean {
  return (
    chunk.redactedText.includes('[user]') &&
    FRICTION_PATTERN.test(chunk.redactedText)
  )
}

function boundedChunkText(
  chunks: TranscriptChunk[],
  maxPromptTokens: number,
): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0)
  if (total <= maxPromptTokens) {
    return chunks.map((chunk) => chunk.redactedText).join('\n\n')
  }

  const selected = new Set<number>()
  const frictionBudget = Math.floor(maxPromptTokens * 0.3)
  let frictionTokens = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk || !isFrictionChunk(chunk)) continue
    if (
      frictionTokens + chunk.tokenEstimate > frictionBudget &&
      frictionTokens > 0
    )
      break
    selected.add(index)
    frictionTokens += chunk.tokenEstimate
  }

  const remaining = maxPromptTokens - frictionTokens
  const headBudget = Math.floor(remaining * 0.6)
  const tailBudget = remaining - headBudget
  let headTokens = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk) break
    if (selected.has(index)) continue
    if (headTokens + chunk.tokenEstimate > headBudget && headTokens > 0) break
    selected.add(index)
    headTokens += chunk.tokenEstimate
  }
  let tailTokens = 0
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    if (!chunk || selected.has(index)) continue
    if (tailTokens + chunk.tokenEstimate > tailBudget && tailTokens > 0) break
    selected.add(index)
    tailTokens += chunk.tokenEstimate
  }

  const ordered = Array.from(selected).sort((a, b) => a - b)
  const parts: string[] = []
  let previous = -1
  for (const index of ordered) {
    const chunk = chunks[index]
    if (!chunk) continue
    if (previous !== -1 && index > previous + 1) {
      parts.push('[... part of session omitted for length ...]')
    }
    parts.push(chunk.redactedText)
    previous = index
  }
  return parts.join('\n\n')
}

function summaryFromResponse(
  session: {
    id: string
    provider: string
    cwd: string | null
    title: string | null
  },
  chunkCount: number,
  output: string,
): SessionSummary {
  const object = parseJsonObject(output)
  const summaryText =
    asString(object.summary) ?? 'No summary was produced for this session.'
  return {
    sessionId: session.id,
    provider: session.provider as TranscriptProvider,
    cwd: session.cwd,
    title: session.title,
    summary: summaryText,
    built: asString(object.built),
    problems: asString(object.problems),
    failedApproaches: asStringArray(object.failedApproaches),
    whatWorked: asString(object.whatWorked),
    toolsCreated: asStringArray(object.toolsCreated),
    opinions: asStringArray(object.opinions),
    model: null,
    chunkCount,
    createdAt: nowIso(),
    metadata: { friction: asStringArray(object.friction) },
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null)
    .slice(0, 8)
}
