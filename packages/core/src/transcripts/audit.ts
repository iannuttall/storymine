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
    'You are auditing a redacted transcript chunk from AI-assisted product building.',
    '',
    'Extract useful, non-obvious lessons for founders, marketers, and operators who want to get better at using AI agents without blindly following them.',
    '',
    'Look for:',
    '- security concerns or privacy risks that were caught',
    '- agent mistakes and how the human corrected them',
    '- product-quality lessons',
    '- debugging patterns',
    '- workflow rules worth reusing',
    '',
    'Return JSON only with this shape:',
    '{"findings":[{"lesson":"...","whyNonObvious":"...","category":"prompting|product|security|debugging|agent-behaviour|workflow","confidence":0.0,"actionForAgent":"...","reusableRule":"...","evidence":["short paraphrased evidence"]}]}',
    '',
    'Rules:',
    '- Only include lessons that would change how a competent builder uses agents or ships product.',
    '- Reject generic lessons like "write tests", "check errors", or "be clear" unless the transcript shows a specific reusable tactic.',
    '- actionForAgent must be an imperative instruction another coding agent could follow.',
    '- reusableRule should be a short rule of thumb the human could add to AGENTS.md, or null.',
    '- Evidence must be short paraphrases, not long transcript quotes.',
    '- Do not include secrets, credentials, private client details, or raw code.',
    '- Return an empty findings array if there is no useful lesson.',
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
    const lesson = asString(object.lesson)
    const confidence = asNumber(object.confidence)
    const actionForAgent = asString(object.actionForAgent)
    const evidence = Array.isArray(object.evidence)
      ? object.evidence
          .map(asString)
          .filter((value): value is string => Boolean(value))
      : []
    if (
      !lesson ||
      !category.success ||
      confidence === null ||
      !actionForAgent ||
      evidence.length === 0
    ) {
      return []
    }
    return [
      {
        lesson,
        whyNonObvious: asString(object.whyNonObvious),
        category: category.data,
        confidence: Math.max(0, Math.min(confidence, 1)),
        actionForAgent,
        reusableRule: asString(object.reusableRule),
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
