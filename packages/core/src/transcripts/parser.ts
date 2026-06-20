import { createReadStream, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import {
  type TranscriptProvider,
  type TranscriptSession,
  transcriptSessionSchema,
} from '../schemas.js'
import { stableId } from '../storage/database.js'
import type { TranscriptMessage } from './chunking.js'

export interface ParseTranscriptInput {
  provider: TranscriptProvider
  path: string
  fileId: string
}

export interface ParsedTranscript {
  session: TranscriptSession
  messages: TranscriptMessage[]
}

export function parseTranscriptFile(
  input: ParseTranscriptInput,
): ParsedTranscript {
  const records = readJsonlSync(input.path)
  const sessionId = findSessionId(input.provider, input.path, records)
  const messages =
    input.provider === 'claude'
      ? parseClaudeMessages(records)
      : parseCodexMessages(records)
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    session: transcriptSessionSchema.parse({
      id: sessionId,
      provider: input.provider,
      fileId: input.fileId,
      title: findTitle(records) ?? basename(input.path),
      cwd: findCwd(records),
      startedAt: timestamps[0] ?? null,
      updatedAt: timestamps.at(-1) ?? null,
      messageCount: messages.length,
      metadata: { path: input.path },
    }),
    messages,
  }
}

export async function parseTranscriptFileAsync(
  input: ParseTranscriptInput,
): Promise<ParsedTranscript> {
  const records: unknown[] = []
  const stream = createReadStream(input.path, { encoding: 'utf8' })
  const lines = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of lines) {
    const parsed = parseJsonLine(line)
    if (parsed) records.push(parsed)
  }
  const sessionId = findSessionId(input.provider, input.path, records)
  const messages =
    input.provider === 'claude'
      ? parseClaudeMessages(records)
      : parseCodexMessages(records)
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((value): value is string => Boolean(value))
    .sort()
  return {
    session: transcriptSessionSchema.parse({
      id: sessionId,
      provider: input.provider,
      fileId: input.fileId,
      title: findTitle(records) ?? basename(input.path),
      cwd: findCwd(records),
      startedAt: timestamps[0] ?? null,
      updatedAt: timestamps.at(-1) ?? null,
      messageCount: messages.length,
      metadata: { path: input.path },
    }),
    messages,
  }
}

function readJsonlSync(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(parseJsonLine)
    .filter((value): value is unknown => Boolean(value))
}

function parseJsonLine(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function parseClaudeMessages(records: unknown[]): TranscriptMessage[] {
  return records.flatMap((record) => {
    const object = asRecord(record)
    const type = asString(object.type)
    if (!type || !['user', 'assistant', 'system'].includes(type)) return []
    const message = asRecord(object.message)
    const role = normalizeRole(asString(message.role) ?? type)
    const text = extractText(message.content)
    if (!text) return []
    return [{ role, text, timestamp: asString(object.timestamp) }]
  })
}

function parseCodexMessages(records: unknown[]): TranscriptMessage[] {
  return records.flatMap((record) => {
    const object = asRecord(record)
    if (asString(object.type) !== 'response_item') return []
    const payload = asRecord(object.payload)
    if (asString(payload.type) !== 'message') return []
    const role = normalizeRole(asString(payload.role))
    if (!['user', 'assistant'].includes(role)) return []
    const phase = asString(payload.phase)
    if (role === 'assistant' && phase && phase !== 'final_answer') return []
    const text =
      extractText(payload.content) ||
      extractText(payload.message) ||
      extractText(object.message)
    if (!isUsefulConversationText(role, text)) return []
    if (!text) return []
    return [
      {
        role,
        text,
        timestamp: asString(object.timestamp) ?? asString(payload.timestamp),
      },
    ]
  })
}

function isUsefulConversationText(
  role: TranscriptMessage['role'],
  text: string,
): boolean {
  if (!text) return false
  if (role === 'user') {
    const trimmed = text.trim()
    if (trimmed.startsWith('# AGENTS.md instructions')) return false
    if (trimmed.startsWith('<skill>')) return false
    if (trimmed.startsWith('<subagent_notification>')) return false
    if (trimmed.includes('<environment_context>')) return false
    if (trimmed.includes('<permissions instructions>')) return false
  }
  return true
}

function findSessionId(
  provider: TranscriptProvider,
  path: string,
  records: unknown[],
): string {
  for (const record of records) {
    const object = asRecord(record)
    const payload = asRecord(object.payload)
    const id =
      asString(object.sessionId) ??
      asString(payload.id) ??
      asString(payload.sessionId)
    if (id) return id
  }
  return stableId(['transcript-session', provider, path])
}

function findTitle(records: unknown[]): string | null {
  for (const record of records) {
    const object = asRecord(record)
    const title =
      asString(object.thread_name) ??
      asString(object.title) ??
      asString(asRecord(object.payload).title)
    if (title) return title
  }
  return null
}

function findCwd(records: unknown[]): string | null {
  for (const record of records) {
    const object = asRecord(record)
    const cwd = asString(object.cwd) ?? asString(asRecord(object.payload).cwd)
    if (cwd) return cwd
  }
  return null
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n').trim()
  }
  const object = asRecord(value)
  return (
    asString(object.text) ??
    asString(object.content) ??
    asString(object.input) ??
    ''
  ).trim()
}

function normalizeRole(value: string | null): TranscriptMessage['role'] {
  if (value === 'user') return 'user'
  if (value === 'assistant') return 'assistant'
  if (value === 'system') return 'system'
  if (value === 'tool') return 'tool'
  return 'unknown'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
