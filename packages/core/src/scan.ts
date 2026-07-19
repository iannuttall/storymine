import { type StoryIdea, storyIdeaFromFinding } from './ideas.js'
import type { TranscriptProvider } from './schemas.js'
import { getDb } from './storage/database.js'
import type Database from './storage/sqlite.js'
import type { TranscriptAuditModel } from './transcripts/audit.js'
import { mineStories } from './transcripts/stories.js'
import { selectStorySessions } from './transcripts/story-selection.js'
import { summarizeSessions } from './transcripts/summarize.js'
import {
  collectRecentWorkEvidence,
  type RecentWorkScanResult,
} from './work-scan.js'

export type StoryScanPhase =
  | 'artifacts'
  | 'index'
  | 'parse'
  | 'select'
  | 'summarize'
  | 'mine'

export interface StoryScanProgress {
  phase: StoryScanPhase
  status: 'started' | 'completed' | 'item'
  message: string
  current?: number
  total?: number
}

export interface StoryScanOptions {
  model: TranscriptAuditModel
  days?: number
  project?: string
  provider?: TranscriptProvider
  topics?: string[]
  ideaLimit?: number
  summaryLimit?: number
  concurrency?: number
  now?: number
  artifactRoot?: string
  claudeRoot?: string
  codexRoot?: string
  database?: Database.Database
  onProgress?: (event: StoryScanProgress) => void
}

export interface StoryScanResult extends RecentWorkScanResult {
  selectedSessions: number
  summaries: {
    created: number
    skipped: number
    failed: number
    failures: Array<{ sessionId: string; reason: string }>
  }
  mining: {
    attempted: number
    created: number
    rejected: number
    rejections: Array<{ reasons: string[] }>
  }
  ideas: StoryIdea[]
}

export async function runStoryScan(
  options: StoryScanOptions,
): Promise<StoryScanResult> {
  const database = options.database ?? getDb()
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const ideaLimit = Math.max(1, Math.min(options.ideaLimit ?? 5, 20))
  const summaryLimit = Math.max(
    ideaLimit,
    Math.min(options.summaryLimit ?? Math.max(8, ideaLimit * 2), 40),
  )
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  const work = collectRecentWorkEvidence({
    days,
    now,
    database,
    topics: options.topics ?? [],
    ...(options.project ? { project: options.project } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {}),
    ...(options.claudeRoot ? { claudeRoot: options.claudeRoot } : {}),
    ...(options.codexRoot ? { codexRoot: options.codexRoot } : {}),
    onProgress: (event) =>
      progress(options, event.phase, event.status, event.message),
  })

  progress(options, 'select', 'started', 'Ranking sessions locally')
  const selected = selectStorySessions({
    days,
    now,
    limit: summaryLimit,
    maxPerProject: 2,
    artifacts: work.rawArtifacts,
    topics: options.topics ?? [],
    database,
    ...(options.project ? { project: options.project } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  })
  progress(
    options,
    'select',
    'completed',
    `Selected ${selected.length} sessions for summary`,
  )

  progress(options, 'summarize', 'started', 'Summarizing selected sessions')
  const summarized = await summarizeSessions({
    model: options.model,
    days,
    now,
    limit: summaryLimit,
    concurrency,
    sessionIds: selected.map((entry) => entry.session.id),
    database,
    ...(options.project ? { project: options.project } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    onProgress: (event) => {
      progress(
        options,
        'summarize',
        'item',
        event.status === 'failed'
          ? `Summary ${event.index}/${event.total} failed`
          : `Summary ${event.index}/${event.total}: ${event.status}`,
        event.index,
        event.total,
      )
    },
  })
  progress(
    options,
    'summarize',
    'completed',
    `Created ${summarized.summarized} session summaries`,
  )

  progress(options, 'mine', 'started', 'Mining the strongest story ideas')
  const storyCandidateLimit = Math.min(
    summaryLimit,
    Math.max(ideaLimit + 2, ideaLimit * 2),
  )
  const mined = await mineStories({
    model: options.model,
    days,
    now,
    limit: storyCandidateLimit,
    maxStories: ideaLimit,
    concurrency: Math.min(concurrency, 3),
    maxPerProject: options.project ? Math.min(storyCandidateLimit, 6) : 2,
    artifacts: work.rawArtifacts,
    database,
    topics: options.topics ?? [],
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.project ? { project: options.project } : {}),
    onProgress: (event) => {
      progress(
        options,
        'mine',
        'item',
        `Story ${event.index}/${event.total}: ${event.status}`,
        event.index,
        event.total,
      )
    },
  })
  progress(
    options,
    'mine',
    'completed',
    `Created ${mined.storiesCreated} story ideas`,
  )

  return {
    days: work.days,
    artifacts: work.artifacts,
    recentWork: work.recentWork,
    transcripts: work.transcripts,
    selectedSessions: selected.length,
    summaries: {
      created: summarized.summarized,
      skipped: summarized.skipped,
      failed: summarized.failed,
      failures: summarized.failures,
    },
    mining: {
      attempted: mined.attempted,
      created: mined.storiesCreated,
      rejected: mined.rejected,
      rejections: mined.rejections.map((rejection) => ({
        reasons: rejection.reasons,
      })),
    },
    ideas: mined.findings.map(storyIdeaFromFinding),
  }
}

function progress(
  options: StoryScanOptions,
  phase: StoryScanPhase,
  status: StoryScanProgress['status'],
  message: string,
  current?: number,
  total?: number,
): void {
  options.onProgress?.({
    phase,
    status,
    message,
    ...(current !== undefined ? { current } : {}),
    ...(total !== undefined ? { total } : {}),
  })
}
