import { type Artifact, storeArtifactSignals } from './artifacts/scan.js'
import {
  type RecentWorkItem,
  recentWorkFromArtifacts,
} from './artifacts/work.js'
import type { TranscriptProvider } from './schemas.js'
import { getDb, listTranscriptSessionsInWindow } from './storage/database.js'
import type Database from './storage/sqlite.js'
import { indexTranscriptFiles } from './transcripts/discovery.js'
import { processTranscriptFiles } from './transcripts/processing.js'

export type RecentWorkScanPhase = 'index' | 'parse' | 'artifacts'

export interface RecentWorkScanProgress {
  phase: RecentWorkScanPhase
  status: 'started' | 'completed'
  message: string
}

export interface RecentWorkScanOptions {
  days?: number
  project?: string
  provider?: TranscriptProvider
  topics?: string[]
  now?: number
  artifactRoot?: string
  claudeRoot?: string
  codexRoot?: string
  database?: Database.Database
  onProgress?: (event: RecentWorkScanProgress) => void
}

export interface RecentWorkScanResult {
  days: number
  artifacts: { found: number }
  recentWork: RecentWorkItem[]
  transcripts: {
    filesFound: number
    filesProcessed: number
    filesFailed: number
    sessionsFound: number
    sessionsParsed: number
    chunksParsed: number
  }
}

export interface CollectedRecentWork extends RecentWorkScanResult {
  rawArtifacts: Artifact[]
}

export function runRecentWorkScan(
  options: RecentWorkScanOptions = {},
): RecentWorkScanResult {
  const { rawArtifacts: _, ...result } = collectRecentWorkEvidence(options)
  return result
}

export function collectRecentWorkEvidence(
  options: RecentWorkScanOptions = {},
): CollectedRecentWork {
  const database = options.database ?? getDb()
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))

  progress(options, 'index', 'started', 'Finding Claude and Codex sessions')
  const indexed = indexTranscriptFiles(
    {
      providers: options.provider ? [options.provider] : ['claude', 'codex'],
      since: new Date(now - days * 86_400_000),
      limit: 10_000,
      ...(options.project ? { projectIncludes: [options.project] } : {}),
      ...(options.claudeRoot ? { claudeRoot: options.claudeRoot } : {}),
      ...(options.codexRoot ? { codexRoot: options.codexRoot } : {}),
    },
    database,
  )
  progress(
    options,
    'index',
    'completed',
    `Found ${indexed.files.length} session files`,
  )

  progress(options, 'parse', 'started', 'Parsing and redacting new sessions')
  const parsed = processTranscriptFiles(
    {
      limit: 1000,
      ...(options.provider ? { provider: options.provider } : {}),
    },
    database,
  )
  progress(
    options,
    'parse',
    'completed',
    `Parsed ${parsed.sessions} sessions into ${parsed.chunks} chunks`,
  )

  const sessions = listTranscriptSessionsInWindow(database, {
    sinceMs: now - days * 86_400_000,
    ...(options.project ? { project: options.project } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    limit: 5000,
  })
  const projectPaths = [
    ...new Set(
      sessions
        .map((session) => session.cwd)
        .filter((cwd): cwd is string => Boolean(cwd)),
    ),
  ]

  progress(options, 'artifacts', 'started', 'Inspecting recent chat projects')
  const artifactResult = storeArtifactSignals(
    {
      days,
      now,
      topics: options.topics ?? [],
      ...(options.artifactRoot
        ? { root: options.artifactRoot }
        : { projectPaths }),
    },
    database,
  )
  progress(
    options,
    'artifacts',
    'completed',
    `Found ${artifactResult.artifacts.length} recent work artifacts`,
  )

  return {
    days,
    artifacts: { found: artifactResult.artifacts.length },
    recentWork: recentWorkFromArtifacts(artifactResult.artifacts, 20),
    transcripts: {
      filesFound: indexed.files.length,
      filesProcessed: parsed.filesProcessed,
      filesFailed: parsed.failed,
      sessionsFound: sessions.length,
      sessionsParsed: parsed.sessions,
      chunksParsed: parsed.chunks,
    },
    rawArtifacts: artifactResult.artifacts,
  }
}

function progress(
  options: RecentWorkScanOptions,
  phase: RecentWorkScanPhase,
  status: RecentWorkScanProgress['status'],
  message: string,
): void {
  options.onProgress?.({ phase, status, message })
}
