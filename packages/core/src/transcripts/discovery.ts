import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  type TranscriptFile,
  type TranscriptProvider,
  transcriptFileSchema,
} from '../schemas.js'
import {
  completeSourceRun,
  createSourceRun,
  getDb,
  stableId,
  upsertTranscriptFiles,
} from '../storage/database.js'

export interface TranscriptDiscoveryOptions {
  claudeRoot?: string
  codexRoot?: string
  providers?: TranscriptProvider[]
  since?: Date
  limit?: number
  projectIncludes?: string[]
  includeAuxiliary?: boolean
}

export interface TranscriptIndexResult {
  runId: string
  files: TranscriptFile[]
}

export function defaultClaudeRoot(): string {
  return join(homedir(), '.claude')
}

export function defaultCodexRoot(): string {
  return join(homedir(), '.codex')
}

export function discoverTranscriptFiles(
  options: TranscriptDiscoveryOptions = {},
): TranscriptFile[] {
  const providers = options.providers ?? ['claude', 'codex']
  const limit = clampInt(options.limit ?? 10_000, 1, 100_000)
  const files: TranscriptFile[] = []

  for (const provider of providers) {
    const root =
      provider === 'claude'
        ? join(options.claudeRoot ?? defaultClaudeRoot(), 'projects')
        : join(options.codexRoot ?? defaultCodexRoot(), 'sessions')
    for (const path of walkJsonlFiles(root)) {
      if (!options.includeAuxiliary && isAuxiliaryTranscript(path)) continue
      const stat = statSync(path)
      if (options.since && stat.mtime < options.since) continue
      if (!matchesProject(path, options.projectIncludes)) continue
      files.push(
        transcriptFileSchema.parse({
          id: stableId(['transcript-file', provider, path]),
          provider,
          path,
          sizeBytes: stat.size,
          modifiedAtMs: Math.trunc(stat.mtimeMs),
          hash: stableId(['fingerprint', path, stat.size, stat.mtimeMs]),
          indexedAt: null,
          status: 'pending',
          error: null,
        }),
      )
    }
  }

  return sortByModified(files).slice(0, limit)
}

export function indexTranscriptFiles(
  options: TranscriptDiscoveryOptions = {},
): TranscriptIndexResult {
  const database = getDb()
  const run = createSourceRun(database, {
    source: 'transcript',
    command: 'research me transcripts index',
    options: {
      providers: options.providers ?? ['claude', 'codex'],
      since: options.since?.toISOString() ?? null,
      limit: options.limit ?? 10_000,
      projectIncludes: options.projectIncludes ?? [],
      includeAuxiliary: Boolean(options.includeAuxiliary),
    },
  })

  try {
    const files = discoverTranscriptFiles(options)
    upsertTranscriptFiles(database, files)
    completeSourceRun(database, run.id, {
      status: 'completed',
      itemCount: files.length,
    })
    return { runId: run.id, files }
  } catch (error) {
    completeSourceRun(database, run.id, {
      status: 'failed',
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function* walkJsonlFiles(root: string): Generator<string> {
  if (!existsSync(root)) return
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        yield path
      }
    }
  }
}

function sortByModified(files: TranscriptFile[]): TranscriptFile[] {
  return files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.trunc(value), max))
}

function matchesProject(path: string, includes: string[] = []): boolean {
  const needles = includes.map(normalizeMatchText).filter(Boolean)
  if (needles.length === 0) return true
  const pathText = normalizeMatchText(path)
  if (needles.some((needle) => pathText.includes(needle))) return true
  const metadata = readTranscriptMetadataPreview(path)
  return needles.some((needle) => metadata.includes(needle))
}

function readTranscriptMetadataPreview(path: string): string {
  const preview = readFileHead(path, 256 * 1024)
  const values: string[] = []
  for (const line of preview.split(/\r?\n/).slice(0, 200)) {
    const record = parseJsonLine(line)
    if (!record) continue
    const payload = asRecord(record.payload)
    pushString(values, record.cwd)
    pushString(values, payload.cwd)
    pushString(values, record.title)
    pushString(values, payload.title)
    pushString(values, record.thread_name)
  }
  return normalizeMatchText(values.join(' '))
}

function readFileHead(path: string, bytes: number): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return asRecord(JSON.parse(trimmed) as unknown)
  } catch {
    return null
  }
}

function pushString(values: string[], value: unknown): void {
  if (typeof value === 'string' && value.length > 0) values.push(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .trim()
}

function isAuxiliaryTranscript(path: string): boolean {
  return basename(path).startsWith('agent-')
}
