import type { TranscriptChunk, TranscriptProvider } from '../schemas.js'
import { stableId } from '../storage/database.js'
import { redactText } from './redaction.js'

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown'
  text: string
  timestamp?: string | null
}

export interface ChunkTranscriptOptions {
  provider: TranscriptProvider
  sessionId: string
  messages: TranscriptMessage[]
  maxTokens?: number
}

export function chunkTranscriptMessages(
  options: ChunkTranscriptOptions,
): TranscriptChunk[] {
  const maxTokens = Math.max(200, Math.min(options.maxTokens ?? 3500, 12_000))
  const chunks: TranscriptChunk[] = []
  let buffer: string[] = []
  let tokenEstimate = 0
  let redactionCount = 0
  let sequence = 0

  const flush = (): void => {
    const redactedText = buffer.join('\n\n').trim()
    if (!redactedText) return
    chunks.push({
      id: stableId(['transcript-chunk', options.sessionId, sequence]),
      sessionId: options.sessionId,
      provider: options.provider,
      sequence,
      tokenEstimate,
      textHash: stableId(['chunk-text', redactedText]),
      redactedText,
      redactionCount,
      auditStatus: 'pending',
      metadata: {},
    })
    sequence += 1
    buffer = []
    tokenEstimate = 0
    redactionCount = 0
  }

  for (const message of options.messages) {
    for (const part of splitLongText(message.text, maxTokens * 4)) {
      const redacted = redactText(`[${message.role}] ${part}`)
      const partTokens = estimateTokens(redacted.text)
      if (buffer.length > 0 && tokenEstimate + partTokens > maxTokens) {
        flush()
      }
      buffer.push(redacted.text)
      tokenEstimate += partTokens
      redactionCount += redacted.count
    }
  }

  flush()
  return chunks
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  for (let index = 0; index < text.length; index += maxChars) {
    parts.push(text.slice(index, index + maxChars))
  }
  return parts
}
