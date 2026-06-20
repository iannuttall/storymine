import { z } from 'zod'

export const sourceSchema = z.enum([
  'app-usage',
  'search-history',
  'transcript',
  'github',
  'producthunt',
  'submission',
])

export const privacyLevelSchema = z.enum([
  'public',
  'private',
  'sensitive',
  'redacted',
])

export const isoDateSchema = z
  .string()
  .datetime()
  .describe('ISO-8601 timestamp with timezone')

export const jsonRecordSchema = z.record(z.string(), z.unknown())

export const sourceRunSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  command: z.string().min(1),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.nullable().default(null),
  status: z.enum(['running', 'completed', 'failed']),
  itemCount: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
  options: jsonRecordSchema.default({}),
})

export const signalSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1).nullable().default(null),
  source: sourceSchema,
  signalType: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().nullable().default(null),
  summary: z.string().nullable().default(null),
  capturedAt: isoDateSchema,
  privacyLevel: privacyLevelSchema.default('private'),
  weight: z.number().min(0).max(1).default(0.5),
  metadata: jsonRecordSchema.default({}),
})

export const candidateTierSchema = z.enum(['proven', 'discovery'])

export const candidateSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  signalId: z.string().min(1).nullable().default(null),
  name: z.string().min(1),
  url: z.string().url().nullable().default(null),
  oneLiner: z.string().min(1),
  whyInteresting: z.string().min(1),
  tier: candidateTierSchema,
  metrics: jsonRecordSchema.default({}),
  provenance: jsonRecordSchema.default({}),
  capturedAt: isoDateSchema,
  score: z.number().min(0).max(10).nullable().default(null),
  status: z.enum(['new', 'shortlisted', 'rejected', 'used']).default('new'),
})

export const transcriptProviderSchema = z.enum(['claude', 'codex'])

export const transcriptFileSchema = z.object({
  id: z.string().min(1),
  provider: transcriptProviderSchema,
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative(),
  hash: z.string().nullable().default(null),
  indexedAt: isoDateSchema.nullable().default(null),
  status: z.enum(['pending', 'indexed', 'failed']).default('pending'),
  error: z.string().nullable().default(null),
})

export const transcriptSessionSchema = z.object({
  id: z.string().min(1),
  provider: transcriptProviderSchema,
  fileId: z.string().min(1),
  title: z.string().nullable().default(null),
  cwd: z.string().nullable().default(null),
  startedAt: isoDateSchema.nullable().default(null),
  updatedAt: isoDateSchema.nullable().default(null),
  messageCount: z.number().int().nonnegative().default(0),
  metadata: jsonRecordSchema.default({}),
})

export const transcriptChunkSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  provider: transcriptProviderSchema,
  sequence: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  textHash: z.string().min(1),
  redactedText: z.string().min(1),
  redactionCount: z.number().int().nonnegative().default(0),
  auditStatus: z.enum(['pending', 'audited', 'failed']).default('pending'),
  metadata: jsonRecordSchema.default({}),
})

export const transcriptFindingCategorySchema = z.enum([
  'prompting',
  'product',
  'security',
  'debugging',
  'agent-behaviour',
  'workflow',
])

export const transcriptFindingSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  chunkId: z.string().min(1).nullable().default(null),
  lesson: z.string().min(1),
  whyNonObvious: z.string().min(1).nullable().default(null),
  category: transcriptFindingCategorySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).min(1).max(5),
  candidateId: z.string().min(1).nullable().default(null),
  capturedAt: isoDateSchema,
  metadata: jsonRecordSchema.default({}),
})

export type Source = z.infer<typeof sourceSchema>
export type SourceRun = z.infer<typeof sourceRunSchema>
export type Signal = z.infer<typeof signalSchema>
export type Candidate = z.infer<typeof candidateSchema>
export type TranscriptProvider = z.infer<typeof transcriptProviderSchema>
export type TranscriptFile = z.infer<typeof transcriptFileSchema>
export type TranscriptSession = z.infer<typeof transcriptSessionSchema>
export type TranscriptChunk = z.infer<typeof transcriptChunkSchema>
export type TranscriptFinding = z.infer<typeof transcriptFindingSchema>
