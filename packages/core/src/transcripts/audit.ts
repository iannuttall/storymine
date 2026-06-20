import { spawn } from 'node:child_process'
import {
  type TranscriptChunk,
  type TranscriptFinding,
  transcriptFindingCategorySchema,
} from '../schemas.js'
import {
  getDb,
  insertTranscriptFindings,
  listTranscriptChunks,
  markTranscriptChunkAuditStatus,
  nowIso,
  stableId,
} from '../storage/database.js'

export interface TranscriptAuditModel {
  complete(prompt: string): Promise<string>
}

export interface AuditTranscriptOptions {
  limit?: number
  model: TranscriptAuditModel
}

export interface AuditTranscriptResult {
  chunksAudited: number
  chunksFailed: number
  findings: number
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
  const database = getDb()
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const chunks = listTranscriptChunks(database, { status: 'pending', limit })
  let findingsCount = 0
  let failedCount = 0

  for (const chunk of chunks) {
    try {
      const output = await options.model.complete(auditPromptForChunk(chunk))
      const parsed = parseAuditResponse(output)
      const findings = parsed.map((finding) => findingToRecord(chunk, finding))
      insertTranscriptFindings(database, findings)
      markTranscriptChunkAuditStatus(database, chunk.id, 'audited')
      findingsCount += findings.length
    } catch {
      markTranscriptChunkAuditStatus(database, chunk.id, 'failed')
      failedCount += 1
    }
  }

  return {
    chunksAudited: chunks.length,
    chunksFailed: failedCount,
    findings: findingsCount,
  }
}

export function auditPromptForChunk(chunk: TranscriptChunk): string {
  return [
    'You are auditing a redacted transcript chunk from someone using an AI coding agent.',
    '',
    'Your job is to find AI-usage alpha: short, practical tips that help a broad audience get better output from ChatGPT, Claude, Codex, or other AI assistants.',
    '',
    'The audience does not care about this repo, product, codebase, or implementation detail. They care about the reusable human move that improved the AI interaction.',
    '',
    'Look for high-alpha moments like:',
    '- the human stopped the AI from blindly implementing the wrong thing',
    '- the human asked to inspect real data/output before coding from assumptions',
    '- the human forced the AI to narrow scope, define acceptance criteria, or produce a plan first',
    '- the human caught an agent failure mode: cargo-culting, overbuilding, hallucinated certainty, weak defaults, hidden privacy risk, or shallow validation',
    '- the human used a prompt pattern others could copy tomorrow',
    '- the human turned a messy transcript/result into a clearer rule, checklist, or review loop',
    '',
    'Reject low-alpha material:',
    '- product-specific architecture choices',
    '- implementation notes that only matter in this repo',
    '- generic advice such as "write tests", "be clear", "check errors", or "review output"',
    '- summaries of what happened without a reusable behaviour change',
    '- tips that require knowing private context, file names, or project details',
    '',
    'Return JSON only with this shape:',
    '{"findings":[{"quickTip":"...","whyItWorks":"...","mistakeToAvoid":"...","betterMove":"...","examplePrompt":"...","alphaType":"course-correction|prompt-pattern|verification-loop|scope-control|agent-failure|privacy-safety|context-management","alphaScore":0.0,"category":"prompting|product|security|debugging|agent-behaviour|workflow","confidence":0.0,"evidence":["short paraphrased evidence"]}]}',
    '',
    'Rules:',
    '- Return at most 3 findings. Prefer 0 good findings over 5 weak ones.',
    '- alphaScore is audience value from 0 to 1. Only include findings with alphaScore >= 0.7.',
    '- quickTip must be useful to someone using AI tomorrow, even if they are not building this product.',
    '- Write quickTip as a general tip, not as "in this project..." or "for this repo...".',
    '- betterMove must be the concrete human move that improves the AI interaction.',
    '- examplePrompt should be a short prompt or instruction the human could actually paste into an AI chat.',
    '- mistakeToAvoid should name the bad habit or trap.',
    '- Keep each field concise, punchy, and newsletter-friendly.',
    '- Translate concrete project details into general AI-use advice.',
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
