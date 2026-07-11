import {
  deleteTranscriptChunksForSession,
  getDb,
  listTranscriptFiles,
  markTranscriptFileFailed,
  markTranscriptFileIndexed,
  upsertTranscriptChunks,
  upsertTranscriptSession,
} from '../storage/database.js'
import { chunkTranscriptMessages } from './chunking.js'
import { parseTranscriptFile } from './parser.js'

export interface ProcessTranscriptOptions {
  limit?: number
  maxTokens?: number
  provider?: 'claude' | 'codex'
  force?: boolean
}

export interface ProcessTranscriptResult {
  filesProcessed: number
  sessions: number
  chunks: number
  failed: number
}

export function processTranscriptFiles(
  options: ProcessTranscriptOptions = {},
): ProcessTranscriptResult {
  const database = getDb()
  const limit = Math.max(1, Math.min(options.limit ?? 20, 1000))
  const files = listTranscriptFiles(database, {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.force ? {} : { status: 'pending' }),
    limit,
  })
  let sessions = 0
  let chunks = 0
  let failed = 0

  for (const file of files) {
    // A file can vanish between indexing and parsing (deleted worktrees,
    // cleaned-up agent workspaces). Mark it failed and keep going.
    try {
      const parsed = parseTranscriptFile({
        provider: file.provider,
        path: file.path,
        fileId: file.id,
      })
      const transcriptChunks = chunkTranscriptMessages({
        provider: file.provider,
        sessionId: parsed.session.id,
        messages: parsed.messages,
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      })
      upsertTranscriptSession(database, parsed.session)
      deleteTranscriptChunksForSession(database, parsed.session.id)
      upsertTranscriptChunks(database, transcriptChunks)
      markTranscriptFileIndexed(database, file.id)
      sessions += 1
      chunks += transcriptChunks.length
    } catch (error) {
      failed += 1
      markTranscriptFileFailed(
        database,
        file.id,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return { filesProcessed: files.length, sessions, chunks, failed }
}
