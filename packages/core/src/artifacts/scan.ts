import { spawnSync } from 'node:child_process'
import {
  type Dirent,
  existsSync,
  readdirSync,
  type Stats,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { type Signal, signalSchema } from '../schemas.js'
import {
  completeSourceRun,
  createSourceRun,
  getDb,
  insertSignals,
  stableId,
} from '../storage/database.js'

export type ArtifactKind =
  | 'git-repo-active'
  | 'new-repo'
  | 'skill'
  | 'sandbox-project'

export interface Artifact {
  kind: ArtifactKind
  path: string
  name: string
  firstChangeMs: number | null
  lastChangeMs: number | null
  detail: Record<string, unknown>
}

export interface ArtifactScanOptions {
  root?: string
  sandboxRoot?: string
  days?: number
  now?: number
  maxDepth?: number
  maxRepos?: number
}

export interface ArtifactScanResult {
  root: string
  sinceMs: number
  artifacts: Artifact[]
}

export interface StoreArtifactsResult extends ArtifactScanResult {
  runId: string
  signals: Signal[]
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  'vendor',
  'target',
  '.venv',
  'venv',
  '.astro',
  '.wrangler',
  'out',
  'tmp',
])

const GIT_UNIT_SEPARATOR = '\u001f'

export function defaultDevRoot(): string {
  return join(homedir(), 'dev')
}

export function scanArtifacts(
  options: ArtifactScanOptions = {},
): ArtifactScanResult {
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const sinceMs = now - days * 86_400_000
  const root = options.root ?? defaultDevRoot()
  const sandboxRoot = options.sandboxRoot ?? join(root, 'sandbox')
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 4, 8))
  const maxRepos = Math.max(1, Math.min(options.maxRepos ?? 300, 2000))

  const walk = walkDevTree(root, maxDepth)
  const artifacts: Artifact[] = []

  for (const repoDir of prioritizeByMtime(walk.repoDirs).slice(0, maxRepos)) {
    const repo = describeGitRepo(repoDir, sinceMs)
    if (repo) artifacts.push(repo)
  }

  for (const skill of walk.skillFiles) {
    const stat = safeStat(skill)
    if (!stat || stat.mtimeMs < sinceMs) continue
    artifacts.push({
      kind: 'skill',
      path: skill,
      name: skillName(skill),
      firstChangeMs: null,
      lastChangeMs: Math.trunc(stat.mtimeMs),
      detail: { file: skill },
    })
  }

  for (const project of scanSandboxProjects(sandboxRoot, sinceMs)) {
    artifacts.push(project)
  }

  return { root, sinceMs, artifacts: dedupeArtifacts(artifacts) }
}

export function storeArtifactSignals(
  options: ArtifactScanOptions = {},
): StoreArtifactsResult {
  const database = getDb()
  const scan = scanArtifacts(options)
  const run = createSourceRun(database, {
    source: 'artifact',
    command: 'research me artifacts',
    options: { root: scan.root, sinceMs: scan.sinceMs },
  })
  try {
    const signals = scan.artifacts.map((artifact) =>
      artifactToSignal(artifact, run.id),
    )
    insertSignals(database, signals)
    completeSourceRun(database, run.id, {
      status: 'completed',
      itemCount: signals.length,
    })
    return { ...scan, runId: run.id, signals }
  } catch (error) {
    completeSourceRun(database, run.id, {
      status: 'failed',
      itemCount: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function artifactToSignal(artifact: Artifact, runId: string): Signal {
  const capturedMs =
    artifact.lastChangeMs ?? artifact.firstChangeMs ?? Date.now()
  return signalSchema.parse({
    id: stableId(['artifact', artifact.kind, artifact.path]),
    runId,
    source: 'artifact',
    signalType: artifact.kind,
    title: artifact.name,
    url: null,
    summary: artifactSummary(artifact),
    capturedAt: new Date(capturedMs).toISOString(),
    privacyLevel: 'private',
    weight: weightForKind(artifact.kind),
    metadata: {
      path: artifact.path,
      kind: artifact.kind,
      firstChangeMs: artifact.firstChangeMs,
      lastChangeMs: artifact.lastChangeMs,
      ...artifact.detail,
    },
  })
}

function artifactSummary(artifact: Artifact): string {
  const subjects = artifact.detail.subjects
  if (Array.isArray(subjects) && subjects.length > 0) {
    return `${artifact.kind}: ${subjects.slice(0, 3).join('; ')}`
  }
  return `${artifact.kind} at ${artifact.path}`
}

function weightForKind(kind: ArtifactKind): number {
  if (kind === 'new-repo') return 0.9
  if (kind === 'sandbox-project') return 0.85
  if (kind === 'skill') return 0.8
  return 0.6
}

interface DevTreeWalk {
  repoDirs: string[]
  skillFiles: string[]
}

function walkDevTree(root: string, maxDepth: number): DevTreeWalk {
  const repoDirs: string[] = []
  const skillFiles: string[] = []
  if (!existsSync(root)) return { repoDirs, skillFiles }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: Dirent[]
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    if (entries.some((entry) => entry.isDirectory() && entry.name === '.git')) {
      repoDirs.push(current.dir)
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        if (current.depth + 1 <= maxDepth) {
          stack.push({
            dir: join(current.dir, entry.name),
            depth: current.depth + 1,
          })
        }
      } else if (entry.isFile() && isSkillFile(current.dir, entry.name)) {
        skillFiles.push(join(current.dir, entry.name))
      }
    }
  }
  return { repoDirs, skillFiles }
}

function isSkillFile(dir: string, name: string): boolean {
  if (name === 'SKILL.md') return true
  return name.endsWith('.md') && /(^|\/)skills(\/|$)/.test(dir.toLowerCase())
}

function skillName(file: string): string {
  const dir =
    basename(file) === 'SKILL.md' ? basename(dirnameOf(file)) : basename(file)
  return dir.replace(/\.md$/, '')
}

function dirnameOf(file: string): string {
  const index = file.lastIndexOf('/')
  return index === -1 ? file : file.slice(0, index)
}

function describeGitRepo(repoDir: string, sinceMs: number): Artifact | null {
  const sinceIso = new Date(sinceMs).toISOString()
  const log = runGit(repoDir, [
    'log',
    `--since=${sinceIso}`,
    '--no-merges',
    `--format=%cI${GIT_UNIT_SEPARATOR}%s`,
  ])
  if (log === null) return null
  const lines = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  const dates: number[] = []
  const subjects: string[] = []
  for (const line of lines) {
    const [iso, subject] = line.split(GIT_UNIT_SEPARATOR)
    const ms = iso ? Date.parse(iso) : Number.NaN
    if (Number.isFinite(ms)) dates.push(ms)
    if (subject) subjects.push(subject)
  }
  dates.sort((a, b) => a - b)
  const rootIso = runGit(repoDir, ['log', '--max-parents=0', '--format=%cI'])
  const rootMs = rootIso
    ? Date.parse(rootIso.split('\n')[0]?.trim() ?? '')
    : Number.NaN
  const isNew = Number.isFinite(rootMs) && rootMs >= sinceMs
  return {
    kind: isNew ? 'new-repo' : 'git-repo-active',
    path: repoDir,
    name: basename(repoDir),
    firstChangeMs: dates[0] ?? null,
    lastChangeMs: dates.at(-1) ?? null,
    detail: {
      commitCount: lines.length,
      subjects: subjects.slice(0, 5),
      ...(isNew && Number.isFinite(rootMs) ? { rootCommitMs: rootMs } : {}),
    },
  }
}

function scanSandboxProjects(sandboxRoot: string, sinceMs: number): Artifact[] {
  if (!existsSync(sandboxRoot)) return []
  let entries: Dirent[]
  try {
    entries = readdirSync(sandboxRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const artifacts: Artifact[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(sandboxRoot, entry.name)
    const lastMs = latestMtimeMs(dir, 2)
    if (lastMs === null || lastMs < sinceMs) continue
    artifacts.push({
      kind: 'sandbox-project',
      path: dir,
      name: entry.name,
      firstChangeMs: null,
      lastChangeMs: lastMs,
      detail: { project: entry.name },
    })
  }
  return artifacts
}

function latestMtimeMs(dir: string, maxDepth: number): number | null {
  let latest: number | null = null
  const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: Dirent[]
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const path = join(current.dir, entry.name)
      const stat = safeStat(path)
      if (!stat) continue
      const ms = Math.trunc(stat.mtimeMs)
      if (latest === null || ms > latest) latest = ms
      if (entry.isDirectory() && current.depth + 1 <= maxDepth) {
        stack.push({ dir: path, depth: current.depth + 1 })
      }
    }
  }
  return latest
}

function prioritizeByMtime(dirs: string[]): string[] {
  return dirs
    .map((dir) => ({ dir, ms: safeStat(dir)?.mtimeMs ?? 0 }))
    .sort((a, b) => b.ms - a.ms)
    .map((item) => item.dir)
}

function dedupeArtifacts(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>()
  const result: Artifact[] = []
  for (const artifact of artifacts.sort(
    (a, b) => (b.lastChangeMs ?? 0) - (a.lastChangeMs ?? 0),
  )) {
    const key = `${artifact.kind}:${artifact.path}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(artifact)
  }
  return result
}

function runGit(repoDir: string, args: string[]): string | null {
  try {
    const result = spawnSync('git', ['-C', repoDir, ...args], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') return null
    return result.stdout
  } catch {
    return null
  }
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}
