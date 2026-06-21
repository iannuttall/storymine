import { spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import {
  type TranscriptChunk,
  type TranscriptFinding,
  type TranscriptProvider,
  transcriptFindingCategorySchema,
} from '../schemas.js'
import {
  getDb,
  insertTranscriptFindings,
  markTranscriptChunkAuditStatus,
  nowIso,
  stableId,
} from '../storage/database.js'
import { searchTranscriptChunks } from './search.js'

export interface TranscriptAuditModel {
  complete(prompt: string): Promise<string>
}

export interface AuditTranscriptOptions {
  limit?: number
  model: TranscriptAuditModel
  query?: string
  provider?: TranscriptProvider
  project?: string
  status?: 'pending' | 'audited' | 'failed'
  includeDuplicates?: boolean
  database?: Database.Database
  onProgress?: (event: TranscriptAuditProgressEvent) => void
}

export interface AuditTranscriptResult {
  chunksAudited: number
  chunksFailed: number
  findings: number
}

export interface TranscriptAuditProgressEvent {
  chunkId: string
  sessionId: string
  sequence: number
  index: number
  total: number
  status: 'started' | 'audited' | 'failed'
  findings?: number
}

interface ParsedFinding {
  lesson: string
  whyNonObvious: string | null
  category: TranscriptFinding['category']
  confidence: number
  evidence: string[]
  actionForAgent: string
  reusableRule: string | null
  mistakeToAvoid: string | null
  examplePrompt: string | null
  alphaScore: number
  alphaType: string | null
}

export function createCommandAuditModel(
  command: string,
  options: { timeoutMs?: number } = {},
): TranscriptAuditModel {
  return {
    complete: (prompt) => runCommandWithPrompt(command, prompt, options),
  }
}

export async function auditPendingTranscriptChunks(
  options: AuditTranscriptOptions,
): Promise<AuditTranscriptResult> {
  const database = options.database ?? getDb()
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const chunks = selectTranscriptChunksForAudit(
    {
      limit,
      ...(options.query ? { query: options.query } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.project ? { project: options.project } : {}),
      status: options.status ?? 'pending',
      ...(options.includeDuplicates !== undefined
        ? { includeDuplicates: options.includeDuplicates }
        : {}),
    },
    database,
  )
  let findingsCount = 0
  let failedCount = 0

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk) continue
    const baseProgress = {
      chunkId: chunk.id,
      sessionId: chunk.sessionId,
      sequence: chunk.sequence,
      index: index + 1,
      total: chunks.length,
    }
    options.onProgress?.({ ...baseProgress, status: 'started' })
    try {
      const output = await options.model.complete(auditPromptForChunk(chunk))
      const parsed = parseAuditResponse(output)
      const findings = parsed.map((finding) => findingToRecord(chunk, finding))
      insertTranscriptFindings(database, findings)
      markTranscriptChunkAuditStatus(database, chunk.id, 'audited')
      findingsCount += findings.length
      options.onProgress?.({
        ...baseProgress,
        status: 'audited',
        findings: findings.length,
      })
    } catch {
      markTranscriptChunkAuditStatus(database, chunk.id, 'failed')
      failedCount += 1
      options.onProgress?.({ ...baseProgress, status: 'failed' })
    }
  }

  return {
    chunksAudited: chunks.length,
    chunksFailed: failedCount,
    findings: findingsCount,
  }
}

export function selectTranscriptChunksForAudit(
  options: {
    limit?: number
    query?: string
    provider?: TranscriptProvider
    project?: string
    status?: 'pending' | 'audited' | 'failed'
    includeDuplicates?: boolean
  } = {},
  database: Database.Database = getDb(),
): TranscriptChunk[] {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const searchLimit = options.includeDuplicates ? limit : limit * 3
  const result = searchTranscriptChunks(
    {
      ...(options.query ? { query: options.query } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.project ? { project: options.project } : {}),
      status: options.status ?? 'pending',
      limit: searchLimit,
    },
    database,
  )
  if (options.includeDuplicates) return result.hits.slice(0, limit)

  const seenHashes = new Set<string>()
  const selected: TranscriptChunk[] = []
  for (const chunk of result.hits) {
    if (seenHashes.has(chunk.textHash)) continue
    seenHashes.add(chunk.textHash)
    selected.push(chunk)
    if (selected.length >= limit) break
  }
  return selected
}

export function auditPromptForChunk(chunk: TranscriptChunk): string {
  return [
    'You are auditing a redacted transcript chunk from someone using an AI coding agent.',
    '',
    'Your job is to find prompting alpha: high-agency, non-obvious tips that help a broad audience prompt ChatGPT, Claude, Codex, or other AI assistants better.',
    '',
    'The audience does not care about this repo, product, codebase, or implementation detail. They care about the reusable prompting move, review loop, constraint, or correction that improved the AI interaction.',
    '',
    'The hook is: lessons you only learn by building with AI every day. Prefer sharp prompting habits over generic productivity advice.',
    '',
    'Look for high-alpha moments like:',
    '- the human used exact words or constraints that made the AI produce better work',
    '- the human stopped the AI from blindly implementing the wrong thing',
    '- the human interrupted, corrected, or redirected the AI after it started drifting',
    '- the human pushed back on a weak answer, lazy assumption, generic framing, or incomplete plan',
    '- the human reminded the AI of a standing rule, product principle, style preference, or workflow constraint',
    '- the human asked the AI to inspect real data/output before coding from assumptions',
    '- the human forced the AI to narrow scope, define acceptance criteria, or produce a plan first',
    '- the human caught an agent failure mode: cargo-culting, overbuilding, hallucinated certainty, weak defaults, hidden privacy risk, generic copy, or shallow validation',
    '- the human gave examples, anti-examples, do-not-do lists, or acceptance criteria the AI could actually follow',
    '- the human turned a messy transcript/result into a reusable prompt, checklist, review loop, or correction pattern',
    '',
    'Reject low-alpha material:',
    '- product-specific architecture choices',
    '- implementation notes that only matter in this repo',
    '- product-building advice that is not really about prompting or steering an AI agent',
    '- generic advice such as "write tests", "be clear", "check errors", or "review output"',
    '- summaries of what happened without a reusable behaviour change',
    '- tips that require knowing private context, file names, or project details',
    '- obvious beginner advice unless the transcript shows a sharper prompt pattern behind it',
    '',
    'Return JSON only with this shape:',
    '{"findings":[{"quickTip":"...","whyItWorks":"...","mistakeToAvoid":"...","betterMove":"...","examplePrompt":"...","alphaType":"course-correction|prompt-pattern|verification-loop|scope-control|agent-failure|privacy-safety|context-management","alphaScore":0.0,"category":"prompting|product|security|debugging|agent-behaviour|workflow","confidence":0.0,"evidence":["short paraphrased evidence"]}]}',
    '',
    'Rules:',
    '- Return at most 3 findings. Prefer 0 good findings over 5 weak ones.',
    '- alphaScore is audience value from 0 to 1. Only include findings with alphaScore >= 0.7.',
    '- quickTip must be useful to someone using AI tomorrow, even if they are not building this product.',
    '- Write quickTip as a general tip, not as "in this project..." or "for this repo...".',
    '- betterMove must be the concrete prompting move that improves the AI interaction.',
    '- examplePrompt should be a short prompt or instruction the human could actually paste into an AI chat.',
    '- mistakeToAvoid should name the bad habit or trap.',
    '- Keep each field concise, punchy, and newsletter-friendly.',
    '- Translate concrete project details into general AI-prompting advice.',
    '- Prefer alphaType "prompt-pattern", "course-correction", "verification-loop", "scope-control", or "context-management" unless another type is clearly stronger.',
    '- Evidence must be short paraphrases, not long transcript quotes.',
    '- Do not include secrets, credentials, private client details, or raw code.',
    '- Return an empty findings array if there is no useful lesson.',
    '',
    'Bad quickTip: "Use an incremental indexer for transcript processing."',
    'Good quickTip: "Before asking AI to process a pile of data, make it measure the pile first."',
    '',
    'Bad quickTip: "Keep CLI wrappers thin."',
    'Good quickTip: "When AI copies a pattern from another project, ask it to justify why that pattern fits this one."',
    '',
    'Bad quickTip: "Improve landing page copy."',
    'Good quickTip: "When AI writes generic copy, make it inspect the real screen or data before rewriting."',
    '',
    'Bad quickTip: "The agent made a mistake."',
    'Good quickTip: "When an AI drifts from your standard, stop it immediately and restate the rule in reusable terms."',
    '',
    'Bad quickTip: "Use semantic search for logs."',
    'Good quickTip: "Before asking AI to audit a big chat archive, make it search for exact past examples and read only the relevant parts."',
    '',
    `Provider: ${chunk.provider}`,
    `Session: ${chunk.sessionId}`,
    `Chunk: ${chunk.sequence}`,
    '',
    chunk.redactedText,
  ].join('\n')
}

export function parseAuditResponse(output: string): ParsedFinding[] {
  const parsed = parseJsonObject(output)
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : []
  return rawFindings.flatMap((item) => {
    const object = asRecord(item)
    const category = transcriptFindingCategorySchema.safeParse(object.category)
    const lesson = asString(object.quickTip) ?? asString(object.lesson)
    const confidence = asNumber(object.confidence)
    const alphaScore = asNumber(object.alphaScore)
    const actionForAgent =
      asString(object.betterMove) ?? asString(object.actionForAgent)
    const evidence = Array.isArray(object.evidence)
      ? object.evidence
          .map(asString)
          .filter((value): value is string => Boolean(value))
      : []
    if (
      !lesson ||
      !category.success ||
      confidence === null ||
      alphaScore === null ||
      alphaScore < 0.7 ||
      !actionForAgent ||
      evidence.length === 0
    ) {
      return []
    }
    return [
      {
        lesson,
        whyNonObvious:
          asString(object.whyItWorks) ?? asString(object.whyNonObvious),
        category: category.data,
        confidence: Math.max(0, Math.min(confidence, 1)),
        actionForAgent,
        reusableRule: asString(object.reusableRule) ?? lesson,
        mistakeToAvoid: asString(object.mistakeToAvoid),
        examplePrompt: asString(object.examplePrompt),
        alphaScore: Math.max(0, Math.min(alphaScore, 1)),
        alphaType: asString(object.alphaType),
        evidence: evidence.slice(0, 5),
      },
    ]
  })
}

function findingToRecord(
  chunk: TranscriptChunk,
  finding: ParsedFinding,
): TranscriptFinding {
  return {
    id: stableId([
      'transcript-finding',
      chunk.id,
      finding.lesson,
      finding.category,
    ]),
    sessionId: chunk.sessionId,
    chunkId: chunk.id,
    lesson: finding.lesson,
    whyNonObvious: finding.whyNonObvious,
    category: finding.category,
    confidence: finding.confidence,
    evidence: finding.evidence,
    candidateId: null,
    capturedAt: nowIso(),
    metadata: {
      provider: chunk.provider,
      chunkSequence: chunk.sequence,
      actionForAgent: finding.actionForAgent,
      reusableRule: finding.reusableRule,
      mistakeToAvoid: finding.mistakeToAvoid,
      examplePrompt: finding.examplePrompt,
      alphaScore: finding.alphaScore,
      alphaType: finding.alphaType,
    },
  }
}

function runCommandWithPrompt(
  command: string,
  prompt: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Model command timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `Model command exited with ${code}`))
      }
    })
    child.stdin.end(prompt)
  })
}

function parseJsonObject(value: string): Record<string, unknown> {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return {}
  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
