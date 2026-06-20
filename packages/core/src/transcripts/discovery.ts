import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
      if (files.length >= limit) return sortByModified(files)
      const stat = statSync(path)
      if (options.since && stat.mtime < options.since) continue
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

  return sortByModified(files)
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
