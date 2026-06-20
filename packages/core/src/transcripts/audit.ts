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
  findings: number
}

interface ParsedFinding {
  lesson: string
  whyNonObvious: string | null
  category: TranscriptFinding['category']
  confidence: number
  evidence: string[]
}

export function createCommandAuditModel(command: string): TranscriptAuditModel {
  return {
    complete: (prompt) => runCommandWithPrompt(command, prompt),
  }
}

export async function auditPendingTranscriptChunks(
  options: AuditTranscriptOptions,
): Promise<AuditTranscriptResult> {
  const database = getDb()
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const chunks = listTranscriptChunks(database, { status: 'pending', limit })
  let findingsCount = 0

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
    }
  }

  return { chunksAudited: chunks.length, findings: findingsCount }
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
    '{"findings":[{"lesson":"...","whyNonObvious":"...","category":"prompting|product|security|debugging|agent-behaviour|workflow","confidence":0.0,"evidence":["short paraphrased evidence"]}]}',
    '',
    'Rules:',
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
    const evidence = Array.isArray(object.evidence)
      ? object.evidence
          .map(asString)
          .filter((value): value is string => Boolean(value))
      : []
    if (
      !lesson ||
      !category.success ||
      confidence === null ||
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
    },
  }
}

function runCommandWithPrompt(
  command: string,
  prompt: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
    child.on('error', reject)
    child.on('close', (code) => {
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
