import {
  getDb,
  listTranscriptFiles,
  markTranscriptFileIndexed,
  upsertTranscriptChunks,
  upsertTranscriptSession,
} from '../storage/database.js'
import { chunkTranscriptMessages } from './chunking.js'
import { parseTranscriptFile } from './parser.js'

export interface ProcessTranscriptOptions {
  limit?: number
  maxTokens?: number
}

export interface ProcessTranscriptResult {
  filesProcessed: number
  sessions: number
  chunks: number
}

export function processTranscriptFiles(
  options: ProcessTranscriptOptions = {},
): ProcessTranscriptResult {
  const database = getDb()
  const limit = Math.max(1, Math.min(options.limit ?? 20, 1000))
  const files = listTranscriptFiles(database, { status: 'pending', limit })
  let sessions = 0
  let chunks = 0

  for (const file of files) {
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
    upsertTranscriptChunks(database, transcriptChunks)
    markTranscriptFileIndexed(database, file.id)
    sessions += 1
    chunks += transcriptChunks.length
  }

  return { filesProcessed: files.length, sessions, chunks }
}
