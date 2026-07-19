import { spawnSync } from 'node:child_process'
import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  type Stats,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { type Signal, signalSchema } from '../schemas.js'
import {
  completeSourceRun,
  createSourceRun,
  getDb,
  insertSignals,
  stableId,
} from '../storage/database.js'
import type Database from '../storage/sqlite.js'

export type ArtifactKind =
  | 'git-repo-active'
  | 'new-repo'
  | 'skill'
  | 'local-project'

export type ArtifactWorkType =
  | 'new-tool'
  | 'new-project'
  | 'new-feature'
  | 'active-project'

export interface ArtifactTopicSignal {
  topic: string
  score: number
  matches: string[]
}

export interface ArtifactLinks {
  repositoryUrl: string | null
  publicUrls: string[]
  packageName: string | null
  packagePrivate: boolean | null
}

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
  projectPaths?: string[]
  days?: number
  now?: number
  maxDepth?: number
  maxRepos?: number
  topics?: string[]
}

export interface ArtifactScanResult {
  root: string | null
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

export function defaultArtifactRoot(): string {
  return process.cwd()
}

export function scanArtifacts(
  options: ArtifactScanOptions = {},
): ArtifactScanResult {
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(options.days ?? 7, 365))
  const sinceMs = now - days * 86_400_000
  const fallbackRoot = options.root ?? defaultArtifactRoot()
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 4, 8))
  const maxRepos = Math.max(1, Math.min(options.maxRepos ?? 300, 2000))

  const projectsWereSelected = options.projectPaths !== undefined
  const explicitProjects = [...new Set(options.projectPaths ?? [])].filter(
    (path) => existsSync(path),
  )
  const root = projectsWereSelected ? null : fallbackRoot
  const walk = projectsWereSelected
    ? walkProjectPaths(explicitProjects, maxDepth)
    : walkDevTree(fallbackRoot, maxDepth)
  const artifacts: Artifact[] = []

  for (const repoDir of prioritizeByMtime(walk.repoDirs).slice(0, maxRepos)) {
    const repo = describeGitRepo(repoDir, sinceMs, options.topics ?? [])
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
      detail: {
        file: skill,
        workType: 'new-feature' satisfies ArtifactWorkType,
        toolSignals: [`skill:${skillName(skill)}`],
        topics: classifyArtifactTopics(
          [skillName(skill), skill],
          options.topics ?? [],
        ),
      },
    })
  }

  for (const projectPath of walk.localProjectDirs) {
    const project = describeLocalProject(
      projectPath,
      sinceMs,
      options.topics ?? [],
    )
    if (project) artifacts.push(project)
  }

  return { root, sinceMs, artifacts: dedupeArtifacts(artifacts) }
}

export function storeArtifactSignals(
  options: ArtifactScanOptions = {},
  database: Database.Database = getDb(),
): StoreArtifactsResult {
  const scan = scanArtifacts(options)
  const run = createSourceRun(database, {
    source: 'artifact',
    command: 'storymine me artifacts',
    options: {
      root: scan.root,
      projectCount: options.projectPaths?.length ?? 0,
      sinceMs: scan.sinceMs,
    },
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
  if (kind === 'local-project') return 0.85
  if (kind === 'skill') return 0.8
  return 0.6
}

interface DevTreeWalk {
  repoDirs: string[]
  skillFiles: string[]
  localProjectDirs: string[]
}

function walkDevTree(root: string, maxDepth: number): DevTreeWalk {
  const repoDirs: string[] = []
  const skillFiles: string[] = []
  const localProjectDirs: string[] = []
  if (!existsSync(root)) return { repoDirs, skillFiles, localProjectDirs }

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
  return { repoDirs, skillFiles, localProjectDirs }
}

function walkProjectPaths(paths: string[], maxDepth: number): DevTreeWalk {
  const repoDirs = new Set<string>()
  const skillFiles = new Set<string>()
  const localProjectDirs = new Set<string>()
  for (const path of paths) {
    const gitRoot = runGit(path, ['rev-parse', '--show-toplevel'])
      ?.trim()
      .split('\n')[0]
    const projectRoot = gitRoot && existsSync(gitRoot) ? gitRoot : path
    if (gitRoot) repoDirs.add(projectRoot)
    else localProjectDirs.add(projectRoot)
    const walked = walkDevTree(projectRoot, maxDepth)
    for (const skill of walked.skillFiles) skillFiles.add(skill)
  }
  return {
    repoDirs: [...repoDirs],
    skillFiles: [...skillFiles],
    localProjectDirs: [...localProjectDirs],
  }
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

function describeGitRepo(
  repoDir: string,
  sinceMs: number,
  interests: string[],
): Artifact | null {
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
  const recentFiles = recentCreatedFiles(repoDir, sinceIso)
  const createdFiles = recentFiles.files
  const packageInfo = readPackageInfo(repoDir)
  const repositoryUrl =
    normalizeRepositoryUrl(runGit(repoDir, ['remote', 'get-url', 'origin'])) ??
    normalizeRepositoryUrl(packageInfo.repositoryUrl)
  const publicUrls = configuredPublicUrls(repoDir, packageInfo.homepage)
  const toolSignals = detectToolSignals(createdFiles, packageInfo.binNames)
  const topics = classifyArtifactTopics(
    [
      basename(repoDir),
      ...subjects,
      ...createdFiles,
      packageInfo.description ?? '',
      ...packageInfo.keywords,
    ],
    interests,
  )
  const looksLikeTool =
    toolSignals.length > 0 ||
    /(^|\/)cli(\/|$)/i.test(repoDir) ||
    createdFiles.some((file) =>
      /(^|\/)(?:scripts?|skills?|bin|commands?)(\/|$)/i.test(file),
    )
  const hasFeatureCommit = subjects.some((subject) =>
    /^(?:feat|build)(?:\([^)]*\))?:|\b(?:add|build|create|launch|ship)\b/i.test(
      subject,
    ),
  )
  const workType: ArtifactWorkType = isNew
    ? looksLikeTool
      ? 'new-tool'
      : 'new-project'
    : hasFeatureCommit
      ? 'new-feature'
      : 'active-project'
  return {
    kind: isNew ? 'new-repo' : 'git-repo-active',
    path: repoDir,
    name: basename(repoDir),
    firstChangeMs: dates[0] ?? null,
    lastChangeMs: dates.at(-1) ?? null,
    detail: {
      commitCount: lines.length,
      subjects: subjects.slice(0, 5),
      createdFiles,
      createdFileCount: recentFiles.total,
      toolSignals,
      workType,
      topics,
      links: {
        repositoryUrl,
        publicUrls,
        packageName: packageInfo.name,
        packagePrivate: packageInfo.private,
      } satisfies ArtifactLinks,
      ...(isNew && Number.isFinite(rootMs) ? { rootCommitMs: rootMs } : {}),
    },
  }
}

interface PackageInfo {
  name: string | null
  description: string | null
  homepage: string | null
  repositoryUrl: string | null
  private: boolean | null
  binNames: string[]
  keywords: string[]
}

function readPackageInfo(repoDir: string): PackageInfo {
  const empty: PackageInfo = {
    name: null,
    description: null,
    homepage: null,
    repositoryUrl: null,
    private: null,
    binNames: [],
    keywords: [],
  }
  const path = join(repoDir, 'package.json')
  const stat = safeStat(path)
  if (!stat || stat.size > 512 * 1024) return empty
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >
    const repository = value.repository
    const repositoryUrl =
      typeof repository === 'string'
        ? repository
        : repository && typeof repository === 'object'
          ? textValue((repository as Record<string, unknown>).url)
          : null
    return {
      name: textValue(value.name),
      description: textValue(value.description),
      homepage: textValue(value.homepage),
      repositoryUrl,
      private: typeof value.private === 'boolean' ? value.private : null,
      binNames: packageBinNames(value.name, value.bin),
      keywords: Array.isArray(value.keywords)
        ? value.keywords.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
    }
  } catch {
    return empty
  }
}

function packageBinNames(name: unknown, bin: unknown): string[] {
  if (typeof bin === 'string') {
    const packageName = textValue(name)
    return packageName ? [packageName.replace(/^@[^/]+\//, '')] : ['cli']
  }
  if (!bin || typeof bin !== 'object' || Array.isArray(bin)) return []
  return Object.keys(bin as Record<string, unknown>).slice(0, 20)
}

function detectToolSignals(
  createdFiles: string[],
  binNames: string[],
): string[] {
  const files = createdFiles.flatMap((file) => {
    const skill = file.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i)
    if (skill?.[1]) return [`skill:${skill[1]}`]
    const command = file.match(
      /(?:^|\/)(?:commands?|scripts?|bin)\/([^/]+?)(?:\.[a-z0-9]+)?$/i,
    )
    if (command?.[1]) return [`file:${command[1]}`]
    return []
  })
  return [
    ...new Set([...binNames.map((name) => `command:${name}`), ...files]),
  ].slice(0, 20)
}

function recentCreatedFiles(
  repoDir: string,
  sinceIso: string,
): { files: string[]; total: number } {
  const value = runGit(repoDir, [
    'log',
    `--since=${sinceIso}`,
    '--diff-filter=A',
    '--name-only',
    '--format=',
  ])
  if (!value) return { files: [], total: 0 }
  const files = [
    ...new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort()
  return { files: files.slice(0, 30), total: files.length }
}

function normalizeRepositoryUrl(value: string | null): string | null {
  const raw = value?.trim().split('\n')[0]?.trim()
  if (!raw) return null
  const ssh = raw.match(/^git@([^:]+):(.+)$/)
  const normalized = ssh
    ? `https://${ssh[1]}/${ssh[2]}`
    : raw.replace(/^git\+/, '').replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/')
  if (!/^https?:\/\//i.test(normalized)) return null
  try {
    const url = new URL(normalized.replace(/\.git\/?$/, ''))
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function configuredPublicUrls(
  repoDir: string,
  packageHomepage: string | null,
): string[] {
  const urls = new Set<string>()
  const homepage = publicHttpUrl(packageHomepage)
  if (homepage) urls.add(homepage)

  const cname = readSmallFile(join(repoDir, 'CNAME'), 4096)?.trim()
  if (cname && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cname)) {
    urls.add(`https://${cname.toLowerCase()}`)
  }

  for (const file of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
    const value = readSmallFile(join(repoDir, file), 256 * 1024)
    if (!value) continue
    const pattern = /["']?(?:pattern|route)["']?\s*[:=]\s*["']([^"']+)["']/gi
    for (const match of value.matchAll(pattern)) {
      const candidate = (match[1] ?? '').replace(/\/\*.*$/, '')
      const url = publicHttpUrl(
        /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
      )
      if (url) urls.add(url)
    }
  }
  return [...urls]
}

function publicHttpUrl(value: string | null): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function readSmallFile(path: string, maxBytes: number): string | null {
  const stat = safeStat(path)
  if (!stat || stat.size > maxBytes) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const TOPIC_ALIASES: Record<string, string[]> = {
  marketing: [
    'marketing',
    'newsletter',
    'campaign',
    'landing page',
    'copywriting',
    'conversion',
    'brand',
    'social',
    'email',
  ],
  seo: [
    'seo',
    'search console',
    'sitemap',
    'robots',
    'structured data',
    'organic',
    'keyword',
    'crawler',
    'indexing',
    'serp',
    'llms.txt',
  ],
  'ai coding': [
    'ai coding',
    'codex',
    'claude',
    'agent',
    'prompt',
    'mcp',
    'llm',
    'transcript',
    'skill',
  ],
  'product building': [
    'cli',
    'app',
    'tool',
    'package',
    'extension',
    'ios',
    'android',
    'saas',
    'product',
    'workflow',
  ],
}

export function classifyArtifactTopics(
  values: string[],
  interests: string[],
): ArtifactTopicSignal[] {
  const text = values.join(' ').toLowerCase()
  const signals: ArtifactTopicSignal[] = []
  const uniqueInterests = [
    ...new Map(
      interests
        .map((interest) => interest.trim())
        .filter(Boolean)
        .map((interest) => [interest.toLowerCase(), interest]),
    ).values(),
  ]
  for (const topic of uniqueInterests) {
    const key = topic.toLowerCase().replace(/[-_]+/g, ' ')
    const fallbackTerms = [
      key,
      ...key.split(/[^a-z0-9]+/).filter((term) => term.length >= 3),
    ]
    const terms = [...new Set(TOPIC_ALIASES[key] ?? fallbackTerms)]
    const matches = terms.filter((term) =>
      new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, 'i').test(
        text,
      ),
    )
    if (matches.length > 0) {
      signals.push({
        topic,
        score: Math.min(1, Number((0.45 + matches.length * 0.15).toFixed(2))),
        matches,
      })
    }
  }
  return signals.sort(
    (left, right) =>
      right.score - left.score || left.topic.localeCompare(right.topic),
  )
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function describeLocalProject(
  projectPath: string,
  sinceMs: number,
  interests: string[],
): Artifact | null {
  const projectStat = safeStat(projectPath)
  if (!projectStat?.isDirectory()) return null
  const markers = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'Package.swift',
    'go.mod',
    'Gemfile',
  ].filter((file) => existsSync(join(projectPath, file)))
  if (markers.length === 0) return null
  const lastMs = latestMtimeMs(projectPath, 2)
  if (lastMs === null || lastMs < sinceMs) return null
  const createdMs = Number.isFinite(projectStat.birthtimeMs)
    ? Math.trunc(projectStat.birthtimeMs)
    : null
  const isNew = createdMs !== null && createdMs >= sinceMs
  return {
    kind: 'local-project',
    path: projectPath,
    name: basename(projectPath),
    firstChangeMs: createdMs,
    lastChangeMs: lastMs,
    detail: {
      project: basename(projectPath),
      workType: (isNew
        ? 'new-project'
        : 'active-project') satisfies ArtifactWorkType,
      markers,
      topics: classifyArtifactTopics(
        [basename(projectPath), ...markers],
        interests,
      ),
    },
  }
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
